#!/usr/bin/env python3
"""Offline Worker tests: real Chrome WebCrypto + real SQLite, mocked providers.

Run: /home/md/Documents/Darts/.venv/bin/python dev/tests/email_worker_test.py
No credentials, production data, real email, Node install, or Cloudflare writes.
"""
import concurrent.futures
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import threading
import unittest

from playwright.sync_api import sync_playwright

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "dev/email-worker/worker.js"
SCHEMA = (WORKER.parent / "schema.sql").read_text()
SQL = re.search(r"export const RESERVE_SQL = `(.*?)`;", WORKER.read_text(), re.S)[1]
RUNTIME = ROOT / f".ew-{os.getpid()}"

FIXTURE = r"""
async () => {
  const pair = await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256'},
    true, ['sign','verify']);
  const jwk = {...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const serialize = object => encode(new TextEncoder().encode(JSON.stringify(object)));
  const pkcs8 = await crypto.subtle.exportKey('pkcs8',pair.privateKey);
  const pem = '-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...new Uint8Array(pkcs8)))+'\n-----END PRIVATE KEY-----';
  let sequence = 0;
  globalThis.fixture = async (options={}) => {
    const module = await import('/worker.js?fixture='+(++sequence));
    const dbId = 'db-'+sequence;
    const now = Math.floor(Date.now()/1000);
    const calls = [];
    const outbound = [];
    const logs = [];
    const redirectBodyReads = [];
    for(const level of ['log','info','warn','error','debug']) console[level]=(...args)=>logs.push({level,args});
    const claims = {aud:'blakeout',iss:'https://securetoken.google.com/blakeout',
      sub:'test-user',email:'owner@example.com',iat:now-100,exp:now+3500,auth_time:now-300,
      firebase:{sign_in_provider:'password'}, ...options.claims};
    const user = options.missing ? null : {localId:'test-user',email:'owner@example.com',
      emailVerified:false,disabled:false,validSince:String(now-600),
      providerUserInfo:[{providerId:'password',email:'owner@example.com'}],...options.user};
    const header = {alg:'RS256',kid:'test-key',...options.header};
    const unsigned = serialize(header)+'.'+serialize(claims);
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned)));
    if(options.badSignature) signature[0]^=255;
    const token = unsigned+'.'+encode(signature);
    const env = {
      RESEND_API_KEY:'re_fixture_only_resend_key_1234567890',
      FIREBASE_SERVICE_ACCOUNT:JSON.stringify({type:'service_account',project_id:'blakeout',
        client_email:'blakeout-dev-email@blakeout.iam.gserviceaccount.com',
        token_uri:'https://oauth2.googleapis.com/token',private_key:pem}),
      EMAIL_LIMITS:{prepare(sql){
        const execute=async(args=[null,null])=>{
          if(options.dbFailure || (options.healthSchemaFailure && sql.startsWith('SELECT'))) throw Error('sensitive database failure');
          return sqliteExecute(dbId,sql,args);
        };
        return {all:()=>execute(),bind(...args){return {all:()=>execute(args)}}};
      }}
    };
    Object.assign(env,options.env||{});
    const response = (body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
    globalThis.fetch = async (url,init={}) => {
      url=String(url);
      calls.push({url,init});
      if(init.redirect!=='manual') throw TypeError('Cloudflare provider fetch requires manual redirects');
      const stage={
        'https://oauth2.googleapis.com/token':'oauth',
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com':'jwks',
        'https://identitytoolkit.googleapis.com/v1/projects/blakeout/accounts:lookup':'account_lookup',
        'https://identitytoolkit.googleapis.com/v1/projects/blakeout/accounts:sendOobCode':'generate_link',
        'https://api.resend.com/emails':'resend'
      }[url];
      const override=options.providerResponses?.[stage];
      if(override){
        if(override.redirect){
          const result=new Response(null,{status:override.status,headers:{
            Location:'https://evil.example/?token=fixture-secret&email=owner@example.com'}});
          Object.defineProperty(result,'json',{value:async()=>{
            redirectBodyReads.push(stage);throw Error('private secret redirect body');
          }});
          return result;
        }
        if(override.network) throw Error('private secret fixture-access-token owner@example.com');
        if(override.raw!==undefined) return new Response(override.raw,{status:override.status||200});
        return response(override.body,override.status||200);
      }
      if(url==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'){
        if(options.jwksFailure) return response({error:'private error'},503);
        return response({keys:[jwk]},200,{'Cache-Control':'max-age=3600'});
      }
      if(url==='https://oauth2.googleapis.com/token'){
        const assertion=new URLSearchParams(init.body).get('assertion');
        const segments=assertion.split('.');
        const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        const oauth=JSON.parse(new TextDecoder().decode(decode(segments[1])));
        if(oauth.iss!=='blakeout-dev-email@blakeout.iam.gserviceaccount.com' ||
            oauth.aud!==url || oauth.scope!=='https://www.googleapis.com/auth/cloud-platform' ||
            oauth.exp-oauth.iat!==3600 ||
            !await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,decode(segments[2]),new TextEncoder().encode(segments.slice(0,2).join('.')))){
          throw Error('Invalid OAuth assertion');
        }
        return options.oauthFailure ? response({error:'private secret'},401) :
          response({access_token:'fixture-access-token',expires_in:3600});
      }
      if(url.startsWith('https://identitytoolkit.googleapis.com/v1/projects/blakeout/accounts:')){
        if(init.headers.Authorization!=='Bearer fixture-access-token' ||
            init.headers.Referer!=='https://blakeoutdarts.com/dev/accounts/') throw Error('Invalid Firebase authorization/referrer');
        const body=JSON.parse(init.body);
        if(url.endsWith(':lookup')){
          if(options.lookupFailure) return response({error:{message:'private secret'}},403);
          if(body.localId?.[0]!=='test-user' && body.email?.[0]!=='owner@example.com' && !options.anyEmail) return response({});
          return response({users:user?[user]:[]});
        }
        if(url.endsWith(':sendOobCode')){
          if(options.oobFailure) return response({error:{message:options.oobFailure}},400);
          if(body.returnOobLink!==true || body.continueUrl!=='https://blakeoutdarts.com/dev/accounts/' ||
              body.canHandleCodeInApp!==false || body.idToken || Object.keys(body).length!==5) throw Error('Unsafe link generation');
          const mode=body.requestType==='VERIFY_EMAIL'?'verifyEmail':'resetPassword';
          const link=new URL('https://blakeout.firebaseapp.com/__/auth/action');
          link.search=new URLSearchParams({mode,oobCode:'fixture-secret-action-code',apiKey:'fixture-public-api-key',
            continueUrl:'https://blakeoutdarts.com/dev/accounts/'}).toString();
          return response({oobLink:options.link||link.href});
        }
      }
      if(url==='https://api.resend.com/emails'){
        outbound.push(JSON.parse(init.body));
        if(init.headers.Authorization!=='Bearer re_fixture_only_resend_key_1234567890') throw Error('Invalid Resend authorization');
        if(options.networkFailure) throw Error('private network failure');
        return options.resendFailure ? response({message:'private provider error'},429) : response({id:'fixture-message'});
      }
      throw Error('Unexpected outbound URL: '+url);
    };
    const request = async (path='/verify-email',overrides={}) => {
      const headers={'Origin':'https://blakeoutdarts.com','Content-Type':'application/json',
        'CF-Connecting-IP':'192.0.2.1','Authorization':'Bearer '+token,...overrides.headers};
      for(const [key,value] of Object.entries(headers)) if(value===null) delete headers[key];
      const init={method:'POST',headers,body:path==='/reset-password'?JSON.stringify({email:'owner@example.com'}):'{}',...overrides,headers};
      if(['GET','HEAD','OPTIONS'].includes(init.method)) delete init.body;
      const incoming=new Request('https://worker.example'+path,init);
      // Browser Request strips forbidden Origin/preflight headers; Workers
      // receive them. Preserve the actual incoming-header semantics explicitly.
      Object.defineProperty(incoming,'headers',{value:new Headers(headers)});
      const result=await module.default.fetch(incoming,env);
      const text=await result.text();
      if(text.includes('fixture-secret') || text.includes('owner@example.com') ||
          text.includes('fixture-access-token') || text.includes('private ')) throw Error('Sensitive response');
      return {status:result.status,body:text?JSON.parse(text):null,headers:Object.fromEntries(result.headers)};
    };
    return {request,env,module,token,calls,outbound,logs,redirectBodyReads,dbId,now};
  };
}
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = WORKER.read_bytes() if self.path.startswith("/worker.js") else b"<!doctype html><title>Worker tests</title>"
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript" if self.path.startswith("/worker.js") else "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class WorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        RUNTIME.mkdir()
        cls.old_tmpdir = os.environ.get("TMPDIR")
        os.environ["TMPDIR"] = str(RUNTIME)
        cls.databases = {}
        cls.addClassCleanup(cls.cleanup)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=shutil.which("google-chrome") or shutil.which("chromium"),
            headless=True,
        )
        cls.page = cls.browser.new_page()
        cls.page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(
            f"http://127.0.0.1:{cls.server.server_port}/") else route.abort())
        cls.page.expose_function("sqliteExecute", cls.sqlite_execute)
        cls.page.goto(f"http://127.0.0.1:{cls.server.server_port}/")
        cls.page.evaluate(FIXTURE)

    @classmethod
    def sqlite_execute(cls, name, sql, args):
        if name not in cls.databases:
            cls.databases[name] = sqlite3.connect(":memory:", isolation_level=None)
            cls.databases[name].executescript(SCHEMA)
        cursor = cls.databases[name].execute(sql, {"1": args[0], "2": args[1]})
        return {"success": True, "results": [{"key": row[0]} for row in cursor.fetchall()]}

    @classmethod
    def cleanup(cls):
        if hasattr(cls, "browser"):
            cls.browser.close()
        if hasattr(cls, "playwright"):
            cls.playwright.stop()
        if hasattr(cls, "server"):
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join()
        for connection in cls.databases.values():
            connection.close()
        if cls.old_tmpdir is None:
            os.environ.pop("TMPDIR", None)
        else:
            os.environ["TMPDIR"] = cls.old_tmpdir
        shutil.rmtree(RUNTIME)

    def js(self, source):
        return self.page.evaluate("async () => {" + source + "}")

    def test_health_checks_credentials_and_schema_without_providers(self):
        result = self.js("""
          const f=await fixture(); const ok=await f.request('/health',{method:'GET'});
          f.env.EMAIL_LIMITS=undefined;
          return [ok,await f.request('/health',{method:'GET'}),f.calls.length];
        """)
        self.assertEqual(result[0]["status"], 200)
        self.assertEqual(result[0]["body"], {"status": "ready"})
        self.assertEqual(result[1]["status"], 503)
        self.assertEqual(result[1]["body"], {"status": "not-ready"})
        self.assertEqual(result[2], 0)

    def test_health_nonready_is_generic_for_invalid_credentials_or_schema(self):
        result = self.js("""
          const results=[];
          for(const options of [{env:{FIREBASE_SERVICE_ACCOUNT:'not-json'}},
              {env:{RESEND_API_KEY:'bad-key'}},{dbFailure:true},{healthSchemaFailure:true}]){
            const f=await fixture(options);
            results.push({response:await f.request('/health',{method:'GET'}),calls:f.calls.length});
          }
          const f=await fixture();const account=JSON.parse(f.env.FIREBASE_SERVICE_ACCOUNT);
          account.private_key='invalid';f.env.FIREBASE_SERVICE_ACCOUNT=JSON.stringify(account);
          results.push({response:await f.request('/health',{method:'GET'}),calls:f.calls.length});
          return results;
        """)
        for entry in result:
            self.assertEqual(entry["response"]["status"], 503)
            self.assertEqual(entry["response"]["body"], {"status": "not-ready"})
            self.assertEqual(entry["calls"], 0)

    def test_verification_sends_branded_html_and_text(self):
        result = self.js("""
          const f=await fixture();const result=await f.request();
          return {result,email:f.outbound[0],urls:f.calls.map(c=>c.url)};
        """)
        self.assertEqual(result["result"]["body"], {"status": "sent"})
        email = result["email"]
        self.assertEqual(email["from"], "BlakeOut <noreply@blakeoutdarts.com>")
        self.assertEqual(email["reply_to"], "DartsBlakeOut@gmail.com")
        self.assertEqual(email["to"], ["owner@example.com"])
        self.assertIn("https://blakeoutdarts.com/dev/assets/logo.png", email["html"])
        self.assertIn("mode=verifyEmail", email["text"])
        self.assertIn("&amp;oobCode=", email["html"])
        self.assertEqual(len(result["urls"]), 5)

    def test_reset_success_and_enumeration(self):
        result = self.js("""
          const outputs=[];
          for(const options of [{},{missing:true},{user:{disabled:true}},{user:{providerUserInfo:[]}},
              {user:{email:'changed@example.com'}}]){
            const f=await fixture(options);
            outputs.push({response:await f.request('/reset-password'),sent:f.outbound.length});
          }return outputs;
        """)
        for entry in result:
            self.assertEqual(entry["response"]["status"], 200)
            self.assertEqual(entry["response"]["body"], {"status": "accepted"})
        self.assertEqual([r["sent"] for r in result], [1, 0, 0, 0, 0])

    def test_reset_case_normalization_and_no_auth_needed(self):
        result = self.js("""
          const f=await fixture();return await f.request('/reset-password',{
            body:JSON.stringify({email:'  OWNER@EXAMPLE.COM  '}),headers:{Authorization:null,Origin:null}});
        """)
        self.assertEqual(result["body"], {"status": "accepted"})
        self.assertNotIn("access-control-allow-origin", result["headers"])

    def test_invalid_jwt_claims_and_signature(self):
        result = self.js("""
          const outputs=[];
          const now=Math.floor(Date.now()/1000);
          for(const options of [{badSignature:true},{claims:{aud:'other'}},{claims:{iss:'https://attacker.example'}},
              {claims:{exp:now-1}},{claims:{iat:now+60}},{claims:{auth_time:now+60}},
              {claims:{sub:''}},{claims:{firebase:{sign_in_provider:'anonymous'}}},
              {claims:{firebase:{sign_in_provider:'password',tenant:'other'}}},
              {header:{alg:'none'}},{header:{kid:'unknown'}}]){
            const f=await fixture(options);const response=await f.request();
            outputs.push({response,lookups:f.calls.filter(c=>c.url.endsWith(':lookup')).length,sent:f.outbound.length});
          }return outputs;
        """)
        for result in result:
            self.assertEqual(result["response"]["status"], 401)
            self.assertEqual(result["lookups"], 0)
            self.assertEqual(result["sent"], 0)

    def test_missing_token_origin_is_not_auth(self):
        result = self.js("const f=await fixture();return await f.request('/verify-email',{headers:{Authorization:null}});")
        self.assertEqual(result["status"], 401)

    def test_authoritative_account_changes_and_revocation(self):
        result = self.js("""
          const outputs=[];
          const now=Math.floor(Date.now()/1000);
          for(const options of [{missing:true},{user:{disabled:true}},{user:{email:'changed@example.com'}},
              {user:{validSince:String(now-10)}},{user:{validSince:'invalid'}},{user:{localId:'other'}},
              {user:{providerUserInfo:[]}}]){
            const f=await fixture(options);
            outputs.push({response:await f.request(),sent:f.outbound.length});
          }return outputs;
        """)
        for result in result:
            self.assertEqual(result["response"]["status"], 401)
            self.assertEqual(result["sent"], 0)

    def test_already_verified_does_not_send(self):
        result = self.js("const f=await fixture({user:{emailVerified:true}});return [await f.request(),f.outbound.length];")
        self.assertEqual(result[0]["status"], 409)
        self.assertEqual(result[1], 0)

    def test_configuration_and_database_fail_closed(self):
        result = self.js("""
          const results=[];
          for(const options of [{env:{EMAIL_LIMITS:null}},{env:{RESEND_API_KEY:''}},
              {env:{FIREBASE_SERVICE_ACCOUNT:'not-json'}},{dbFailure:true}]){
            const f=await fixture(options);results.push({response:await f.request(),sent:f.outbound.length});
          }return results;
        """)
        for entry in result:
            self.assertEqual(entry["response"]["status"], 503)
            self.assertEqual(entry["sent"], 0)

    def test_service_account_identity_is_pinned(self):
        result = self.js("""
          const results=[];
          for(const [key,value] of [['project_id','other'],['client_email','other@example.com'],
              ['token_uri','https://attacker.example/token']]){
            const f=await fixture();const account=JSON.parse(f.env.FIREBASE_SERVICE_ACCOUNT);
            account[key]=value;f.env.FIREBASE_SERVICE_ACCOUNT=JSON.stringify(account);
            results.push(await f.request());
          }return results;
        """)
        self.assertEqual([r["status"] for r in result], [503, 503, 503])

    def test_provider_failures_are_visible_and_sanitized(self):
        result = self.js("""
          const outputs=[];
          for(const options of [{oauthFailure:true},{jwksFailure:true},{lookupFailure:true},
              {oobFailure:'PERMISSION_DENIED private secret'},{resendFailure:true},{networkFailure:true}]){
            const f=await fixture(options);outputs.push(await f.request());
          }return outputs;
        """)
        self.assertEqual([r["status"] for r in result], [502] * 6)
        for entry in result:
            self.assertEqual(list(entry["body"]), ["error"])

    def test_reset_provider_failure_not_silent_and_deletion_race_safe(self):
        result = self.js("""
          const bad=await fixture({resendFailure:true});const failure=await bad.request('/reset-password');
          const race=await fixture({oobFailure:'EMAIL_NOT_FOUND'});return [failure,await race.request('/reset-password'),race.outbound.length];
        """)
        self.assertEqual(result[0]["status"], 502)
        self.assertEqual(result[1]["body"], {"status": "accepted"})
        self.assertEqual(result[2], 0)

    def test_diagnostic_stages_allowlist_reasons_without_sensitive_context(self):
        result = self.js("""
          const secret='private secret owner@example.com fixture-access-token https://evil.example/?oobCode=fixture-secret';
          const cases=[
            ['oauth',{status:400,body:{error:'invalid_grant',error_description:secret}},'invalid_grant'],
            ['account_lookup',{status:403,body:{error:{status:'PERMISSION_DENIED',message:secret,
              details:[{reason:'IAM_PERMISSION_DENIED',metadata:{resource:secret}}]}}},'IAM_PERMISSION_DENIED'],
            ['generate_link',{status:400,body:{error:{message:'UNAUTHORIZED_DOMAIN : '+secret}}},'UNAUTHORIZED_DOMAIN'],
            ['generate_link',{status:403,body:{error:{status:'PERMISSION_DENIED',message:secret}}},'PERMISSION_DENIED'],
            ['resend',{status:403,body:{name:'restricted_api_key',message:secret}},'restricted_api_key'],
            ['resend',{status:429,body:{name:'daily_quota_exceeded',message:secret}},'daily_quota_exceeded'],
            ['resend',{status:403,body:{name:secret,message:secret}},'unclassified_provider_error'],
            ['oauth',{status:400,body:{error:'invalid_grant '+secret,error_description:secret}},'unclassified_provider_error'],
            ['jwks',{status:503,body:{error:{message:secret}}},'unclassified_provider_error'],
          ];
          const results=[];
          for(const [stage,override,reason] of cases){
            const f=await fixture({providerResponses:{[stage]:override}});
            results.push({response:await f.request(),logs:f.logs,expected:{stage,httpStatus:override.status,reason}});
          }
          return results;
        """)
        for entry in result:
            self.assertEqual(entry["response"]["status"], 502)
            self.assertEqual(entry["response"]["body"]["error"]["code"], "email/unavailable")
            self.assertEqual(len(entry["logs"]), 1)
            self.assertEqual(entry["logs"][0]["level"], "warn")
            self.assertEqual(len(entry["logs"][0]["args"]), 1)
            self.assertEqual(json.loads(entry["logs"][0]["args"][0]), entry["expected"])
            for sensitive in ["private secret", "owner@example.com", "fixture-access-token", "https://", "oobCode"]:
                self.assertNotIn(sensitive, json.dumps(entry["logs"]))

    def test_diagnostic_transport_payload_and_link_failures_are_sanitized(self):
        result = self.js("""
          const secret='private secret owner@example.com fixture-access-token';
          const cases=[
            [{providerResponses:{resend:{network:true}}},'resend',0,'network_error'],
            [{providerResponses:{resend:{status:403,raw:'<html>'+secret+'</html>'}}},'resend',403,'invalid_json'],
            [{providerResponses:{oauth:{body:{unexpected:secret}}}},'oauth',200,'invalid_response'],
            [{providerResponses:{account_lookup:{body:{users:secret}}}},'account_lookup',200,'invalid_response'],
            [{providerResponses:{generate_link:{body:{unexpected:secret}}}},'validate_link',200,'missing_link'],
            [{link:'https://evil.example/action?oobCode=fixture-secret&email=owner@example.com'},'validate_link',200,'unexpected_handler'],
            [{providerResponses:{resend:{body:{unexpected:secret}}}},'resend',200,'invalid_response'],
            [{dbFailure:true},'runtime',0,'backend_failure'],
          ];
          const results=[];
          for(const [options,stage,httpStatus,reason] of cases){
            const f=await fixture(options);
            results.push({response:await f.request(),logs:f.logs,expected:{stage,httpStatus,reason}});
          }return results;
        """)
        for entry in result:
            self.assertIn(entry["response"]["status"], [502, 503])
            self.assertEqual(len(entry["logs"]), 1)
            self.assertEqual(entry["logs"][0]["level"], "warn")
            self.assertEqual(len(entry["logs"][0]["args"]), 1)
            self.assertEqual(json.loads(entry["logs"][0]["args"][0]), entry["expected"])

    def test_diagnostics_do_not_log_success_or_account_existence(self):
        result = self.js("""
          const results=[];
          for(const options of [{},{missing:true},{user:{disabled:true}},{oobFailure:'EMAIL_NOT_FOUND'}]){
            const f=await fixture(options);const response=await f.request('/reset-password');
            results.push({response,logs:f.logs});
          }
          const f=await fixture({env:{FIREBASE_SERVICE_ACCOUNT:'private secret'}});
          results.push({response:await f.request('/health',{method:'GET'}),logs:f.logs});
          return results;
        """)
        for entry in result:
            self.assertEqual(entry["logs"], [])

    def test_cloudflare_manual_redirects_fail_closed_before_body_parsing(self):
        result = self.js("""
          const results=[];
          for(const stage of ['oauth','jwks','account_lookup','generate_link','resend']){
            for(const status of [300,301,302,303,304,307,308,399]){
              const f=await fixture({providerResponses:{[stage]:{redirect:true,status}}});
              const response=await f.request();
              results.push({response,logs:f.logs,reads:f.redirectBodyReads,
                manual:f.calls.every(call=>call.init.redirect==='manual'),
                followed:f.calls.some(call=>call.url.includes('evil.example')),
                expected:{stage,httpStatus:status,reason:'redirect_rejected'}});
            }
          }return results;
        """)
        for entry in result:
            self.assertEqual(entry["response"]["status"], 502)
            self.assertEqual(entry["response"]["body"]["error"]["code"], "email/unavailable")
            self.assertTrue(entry["manual"])
            self.assertFalse(entry["followed"])
            self.assertEqual(entry["reads"], [])
            self.assertEqual(len(entry["logs"]), 1)
            self.assertEqual(json.loads(entry["logs"][0]["args"][0]), entry["expected"])
            self.assertNotIn("evil.example", json.dumps(entry["logs"]))
            self.assertNotIn("fixture-secret", json.dumps(entry["logs"]))

    def test_cors_methods_and_routes(self):
        result = self.js("""
          const f=await fixture();return [
            await f.request('/verify-email',{headers:{Origin:'https://evil.example'}}),
            await f.request('/verify-email',{headers:{Origin:'null'}}),
            await f.request('/verify-email',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}}),
            await f.request('/verify-email',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-evil'}}),
            await f.request('/verify-email',{method:'GET'}),
            await f.request('/health',{method:'POST'}),
            await f.request('/unknown'),
            await f.request('/verify-email?redirect=https://evil.example'),
          ];
        """)
        self.assertEqual([r["status"] for r in result], [403, 403, 204, 403, 405, 405, 404, 404])
        self.assertNotIn("access-control-allow-origin", result[0]["headers"])
        self.assertEqual(result[2]["headers"]["access-control-allow-origin"], "https://blakeoutdarts.com")

    def test_strict_json_and_email_input(self):
        result = self.js("""
          const f=await fixture();const results=[];
          for(const body of ['null','[]','"x"','{','{"email":42}','{"email":"a@example.com","from":"evil"}',
              '{"email":"bad\\n@example.com"}','{"email":"a@localhost"}','{"email":".a@example.com"}',
              '{"email":"a..b@example.com"}']){
            results.push(await f.request('/reset-password',{body}));
          }
          results.push(await f.request('/verify-email',{body:'{"email":"other@example.com"}'}));
          results.push(await f.request('/reset-password',{headers:{'Content-Type':'text/plain'}}));
          results.push(await f.request('/reset-password',{body:'x'.repeat(1025)}));
          results.push(await f.request('/verify-email',{headers:{'CF-Connecting-IP':null}}));
          return results;
        """)
        self.assertEqual([r["status"] for r in result], [400] * 11 + [415, 413, 503])

    def test_streaming_body_size_limit(self):
        result = self.js("""
          const f=await fixture();
          const stream=new ReadableStream({start(controller){
            controller.enqueue(new TextEncoder().encode('x'.repeat(800)));
            controller.enqueue(new TextEncoder().encode('x'.repeat(800)));controller.close();
          }});
          return await f.request('/reset-password',{body:stream,duplex:'half'});
        """)
        self.assertEqual(result["status"], 413)

    def test_action_link_rejects_arbitrary_redirects(self):
        result = self.js("""
          const good='https://blakeout.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=x&apiKey=y&continueUrl='+encodeURIComponent('https://blakeoutdarts.com/dev/accounts/');
          const results=[];
          for(const link of ['https://evil.example/?oobCode=x',good.replace('verifyEmail','resetPassword'),
              good.replace('blakeoutdarts.com%2Fdev','evil.example%2Fdev'),good+'&evil=1',
              good+'&mode=verifyEmail',good+'#bad',good.replace('/__/auth/action','/other'),
              good.replace('oobCode=x','oobCode=')]){
            const f=await fixture({link});results.push({response:await f.request(),sent:f.outbound.length});
          }return results;
        """)
        self.assertEqual([r["response"]["status"] for r in result], [502] * 8)
        self.assertEqual([r["sent"] for r in result], [0] * 8)

    def test_html_escaping_and_fixed_brand_assets(self):
        result = self.js("""
          const f=await fixture();
          const content=f.module.emailContent('https://blakeout.firebaseapp.com/__/auth/action?a=<script>"&b=\\'test\\'',true);
          const parser=new DOMParser();const doc=parser.parseFromString(content.html,'text/html');
          const logo=doc.querySelector('img');
          return {content,scripts:doc.querySelectorAll('script').length,
            logo:{width:logo.getAttribute('width'),height:logo.getAttribute('height'),
              maxWidth:logo.style.maxWidth,cssHeight:logo.style.height},
            images:[...doc.images].map(image=>image.src),anchors:[...doc.querySelectorAll('a')].map(a=>a.getAttribute('href'))};
        """)
        self.assertEqual(result["scripts"], 0)
        self.assertIn("&lt;script&gt;&quot;&amp;", result["content"]["html"])
        self.assertEqual(result["images"], ["https://blakeoutdarts.com/dev/assets/logo.png"])
        self.assertEqual(result["logo"], {"width": "176", "height": "96", "maxWidth": "100%", "cssHeight": "auto"})
        self.assertEqual(len(result["anchors"]), 2)
        self.assertIn("<script>", result["content"]["text"])

    def test_account_cooldown_shared_between_reset_and_verify(self):
        result = self.js("""
          const f=await fixture();
          return [await f.request('/reset-password'),await f.request(),await f.request('/reset-password'),f.outbound.length];
        """)
        self.assertEqual(result[0]["body"], {"status": "accepted"})
        self.assertEqual(result[1]["status"], 429)
        self.assertEqual(result[2]["body"], {"status": "accepted"})
        self.assertEqual(result[3], 1)

    def test_missing_account_also_consumes_cooldown(self):
        result = self.js("""
          const f=await fixture({missing:true});await f.request('/reset-password');await f.request('/reset-password');
          return {lookups:f.calls.filter(c=>c.url.endsWith(':lookup')).length,
            counters:await sqliteExecute(f.dbId,'SELECT key FROM email_limits WHERE count > 0', [null,null])};
        """)
        self.assertEqual(result["lookups"], 1)
        self.assertEqual(len(result["counters"]["results"]), 7)

    def test_ip_limit_and_invalid_tokens_consume_attempts(self):
        result = self.js("""
          const f=await fixture();const statuses=[];
          for(let i=0;i<11;i++) statuses.push((await f.request('/verify-email',{headers:{Authorization:null}})).status);
          return statuses;
        """)
        self.assertEqual(result, [401] * 10 + [429])

    def test_error_contract_and_exposed_retry_after(self):
        result = self.js("""
          const f=await fixture();await f.request();
          const limited=await f.request();
          const unauthenticated=await f.request('/verify-email',{headers:{Authorization:null}});
          const bad=await fixture({resendFailure:true});
          return [limited,unauthenticated,await bad.request()];
        """)
        self.assertEqual(result[0]["body"]["error"]["code"], "email/rate-limited")
        self.assertEqual(result[0]["headers"]["retry-after"], "60")
        self.assertEqual(result[0]["headers"]["access-control-expose-headers"], "Retry-After")
        self.assertEqual(result[1]["body"]["error"]["code"], "auth/requires-recent-login")
        self.assertEqual(result[2]["body"]["error"]["code"], "email/unavailable")
        for entry in result:
            self.assertEqual(set(entry["body"]["error"]), {"code", "message"})
            self.assertTrue(entry["body"]["error"]["message"])

    def test_worker_concurrent_global_reservations(self):
        result = self.js("""
          const f=await fixture({missing:true,anyEmail:true});
          const results=await Promise.all(Array.from({length:100},(_,i)=>
            f.request('/reset-password',{headers:{'CF-Connecting-IP':'192.0.2.'+(i+1)},body:JSON.stringify({email:'user'+i+'@example.com'})})));
          return {accepted:results.filter(r=>r.status===200).length,limited:results.filter(r=>r.status===429).length,
            tokens:f.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,sent:f.outbound.length};
        """)
        self.assertEqual(result, {"accepted": 80, "limited": 20, "tokens": 1, "sent": 0})

    def test_worker_signing_key_and_oauth_caches_expire(self):
        result = self.js("""
          const clock=Date.now;const base=clock();let elapsed=0;
          Date.now=()=>base+elapsed;
          try {
            const f=await fixture({claims:{exp:Math.floor(base/1000)+8000}});
            const statuses=[(await f.request()).status];
            elapsed=61000;statuses.push((await f.request()).status);
            const before=f.calls.map(c=>c.url);
            elapsed=3601000;statuses.push((await f.request()).status);
            return {statuses,
              beforeKeys:before.filter(url=>url.includes('/jwk/')).length,
              beforeOAuth:before.filter(url=>url==='https://oauth2.googleapis.com/token').length,
              afterKeys:f.calls.filter(c=>c.url.includes('/jwk/')).length,
              afterOAuth:f.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,
              lookups:f.calls.filter(c=>c.url.endsWith(':lookup')).length};
          } finally {Date.now=clock;}
        """)
        self.assertEqual(result, {"statuses": [200, 200, 200], "beforeKeys": 1,
                                 "beforeOAuth": 1, "afterKeys": 2, "afterOAuth": 2, "lookups": 3})

    def test_worker_account_hour_and_day_limits(self):
        result = self.js("""
          const clock=Date.now;const start=Math.ceil(clock()/86400000)*86400000+1000;let elapsed=0;
          Date.now=()=>start+elapsed;
          try {
            const f=await fixture({claims:{exp:Math.floor(start/1000)+10000}});
            const statuses=[];
            for(const seconds of [0,61,122,183,3601,3662,3723]){
              elapsed=seconds*1000;statuses.push((await f.request()).status);
            }
            return {statuses,sent:f.outbound.length};
          } finally {Date.now=clock;}
        """)
        self.assertEqual(result, {"statuses": [200, 200, 200, 429, 200, 200, 429], "sent": 5})

    def test_sql_atomic_parallel_connections_and_no_partial_increment(self):
        path = RUNTIME / "concurrency.sqlite"
        connection = sqlite3.connect(path)
        connection.executescript(SCHEMA)
        connection.close()

        def attempt(index):
            with sqlite3.connect(path, timeout=30) as db:
                counters = [["global:day", 80, 1000], [f"ip:{index}", 10, 1000]]
                return db.execute(SQL, {"1": json.dumps(counters), "2": 100}).fetchall()

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(attempt, range(160)))
        self.assertEqual(sum(bool(rows) for rows in results), 80)
        self.assertTrue(all(len(rows) in (0, 2) for rows in results))
        with sqlite3.connect(path) as db:
            self.assertEqual(db.execute("SELECT count FROM email_limits WHERE key='global:day'").fetchone()[0], 80)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM email_limits").fetchone()[0], 81)

    def test_sql_cooldown_hour_day_month_and_expiry(self):
        db = sqlite3.connect(":memory:", isolation_level=None)
        db.executescript(SCHEMA)
        for key, cap in [("cooldown", 1), ("account:hour", 3), ("account:day", 5),
                         ("ip:hour", 10), ("ip:day", 25), ("global:day", 80), ("global:month", 2400)]:
            params = {"1": json.dumps([[key, cap, 1000], ["shared:" + key, cap + 1, 1000]]), "2": 100}
            for _ in range(cap):
                self.assertEqual(len(db.execute(SQL, params).fetchall()), 2)
            self.assertEqual(db.execute(SQL, params).fetchall(), [])
            self.assertEqual(db.execute("SELECT count FROM email_limits WHERE key=?", ("shared:" + key,)).fetchone()[0], cap)
            params["2"] = 1000
            params["1"] = json.dumps([[key, cap, 2000], ["shared:" + key, cap + 1, 2000]])
            self.assertEqual(len(db.execute(SQL, params).fetchall()), 2)
            self.assertEqual(db.execute("SELECT count, expires FROM email_limits WHERE key=?", (key,)).fetchone(), (1, 2000))
        db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
