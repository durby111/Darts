#!/usr/bin/env python3
"""DEV platform/browser contract tests; Firebase traffic is mocked, never live.

Run with the existing environment:
    /home/md/Documents/Darts/.venv/bin/python dev/tests/platform_test.py

If FIRESTORE_EMULATOR_HOST points at an existing localhost emulator, also compile
and exercise firestore.rules in an isolated demo project. Otherwise that group is
explicitly skipped. No emulator or dependency installation is performed.

--print-simulator-fixture emits the exact persisted 4-player/12-counter Chicago
fixture as SIMULATOR_FIXTURE=<JSON> for Firebase's real rules simulator. perPlayer
is a canonical JSON string on the wire; all platform APIs still return arrays.
"""
import ast
import asyncio
import base64
import functools
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".platform-test-runtime"
sys.dont_write_bytecode = True

APP = """
const apps = [{name:'[DEFAULT]'}];
export const getApps=()=>apps;
export const initializeApp=(config,name)=>{const app={name};apps.push(app);return app;};
"""

AUTH = """
const key='platform-test-auth';
const initial={uid:'verified_owner',email:'owner@example.com',emailVerified:true,isAnonymous:false};
const hydrate=user=>user&&({...user,getIdToken:async()=> 'verified'});
const auth={currentUser:hydrate(JSON.parse(localStorage.getItem(key)||JSON.stringify(initial)))};
const listeners=[];
const notify=user=>{auth.currentUser=hydrate(user);listeners.forEach(cb=>cb(auth.currentUser));};
globalThis.changeTestUser=user=>{localStorage.setItem(key,JSON.stringify(user));notify(user);};
addEventListener('storage',event=>{if(event.key===key)notify(JSON.parse(event.newValue));});
export const getAuth=app=>({...auth,app,get currentUser(){return auth.currentUser;}});
export const browserLocalPersistence='LOCAL';
export const setPersistence=async(auth,value)=>{globalThis.testPersistence={app:auth.app.name,value};};
export const onAuthStateChanged=(auth,cb)=>{listeners.push(cb);queueMicrotask(()=>cb(auth.currentUser));return()=>{};};
export const isSignInWithEmailLink=(auth,url)=>new URL(url).searchParams.has('oobCode');
export const sendSignInLinkToEmail=async(auth,email,settings)=>{globalThis.sentLink={email,settings};};
export const signInWithEmailLink=async(auth,email)=>{
 if(email!=='owner@example.com')throw Object.assign(Error('Invalid email for this link'),{code:'auth/invalid-email'});
 globalThis.changeTestUser(initial);return {user:hydrate(initial)};
};
export const signOut=async()=>globalThis.changeTestUser(null);
const fail=()=>{if(globalThis.authFailure)throw Object.assign(Error('Authentication request failed'),{code:globalThis.authFailure});};
export const createUserWithEmailAndPassword=async(auth,email,password)=>{
 fail();if(password.length<6)throw Error('Weak password');
 globalThis.changeTestUser({uid:'registered_user',email,emailVerified:false,isAnonymous:false});
 return {user:auth.currentUser};
};
export const signInWithEmailAndPassword=async(auth,email,password)=>{
 fail();if(password==='wrong-password')throw Object.assign(Error('Invalid credentials'),{code:'auth/invalid-credential'});
 globalThis.changeTestUser(email==='owner@example.com'?initial:{uid:'registered_user',email,emailVerified:false,isAnonymous:false});
 return {user:auth.currentUser};
};
export const sendEmailVerification=async(user,settings)=>{
 fail();globalThis.sentVerification={email:user.email,settings,count:(globalThis.sentVerification?.count||0)+1};
};
export const sendPasswordResetEmail=async(auth,email,settings)=>{
 fail();globalThis.sentReset={email,settings};
};
export const reload=async user=>{fail();globalThis.reloadCount=(globalThis.reloadCount||0)+1;if(globalThis.mockVerified)user.emailVerified=true;};
"""

STORE = """
export const getFirestore=()=>({});
const docs=new Map();
globalThis.testDocs=docs;
globalThis.testReadPaths=[];
const snap=ref=>({id:ref.id,exists:()=>docs.has(ref.path),data:()=>structuredClone(docs.get(ref.path))});
const online=()=>{if(globalThis.testOffline)throw Error('Offline');};
const readable=()=>{online();if(globalThis.denyReads)throw Object.assign(Error('Missing permissions'),{code:'permission-denied'});};
export const collection=(db,path)=>({path});
export const doc=(db,name,id)=>id?{path:name+'/'+id,id}:{path:db.path+'/generated-id',id:'generated-id'};
export const getDocFromServer=async ref=>{readable();testReadPaths.push(ref.path);return snap(ref);};
export const getDocsFromServer=async ref=>{
 readable();return {docs:[...docs].filter(([path,data])=>path.startsWith(ref.path+'/')
 &&(!ref.filter||data[ref.filter.field].includes(ref.filter.value)))
 .map(([path])=>snap({path,id:path.split('/')[1]}))};
};
export const query=(col,filter)=>({...col,filter});
export const where=(field,op,value)=>({field,op,value});
export const runTransaction=async(db,callback)=>{
 online();
 const attempt=async()=>{
   const writes=[];
   const result=await callback({get:async ref=>{
     if(writes.length)throw Error('Transaction reads after writes');testReadPaths.push(ref.path);return snap(ref);
   },set:(ref,value)=>writes.push([ref.path,structuredClone(value)])});
   return {writes,result};
 };
 if(globalThis.retryTransaction){globalThis.retryTransaction=false;await attempt();}
 const {writes,result}=await attempt();
 writes.forEach(([path,value])=>docs.set(path,value));return result;
};
"""

API_TESTS = r"""async () => {
 const p=await import('/dev/js/platform.js'), e=await import('/dev/js/brackets/engine.js');
 await p.initPlatform();
 const checks=[];
 const assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const reject=async(fn,label)=>{let error;try{await fn();}catch(e){error=e;}assert(!!error,label);};
 assert(testPersistence.app==='blakeout-dev-accounts'&&testPersistence.value==='LOCAL','secondary LOCAL auth');
 let calls=0;const unsub=p.subscribeAccount(()=>calls++);unsub();
 assert(calls===1,'immediate account subscription');
 assert(p.requireVerifiedAccount().uid==='verified_owner','verified UID access');
 await p.saveProfile('Zoë "Ace" \\ 🎯');
 assert(JSON.stringify(testDocs.get('blakeoutDevProfiles/verified_owner'))===JSON.stringify({name:'Zoë "Ace" \\ 🎯'}),'name-only Unicode profile');
 assert((await p.listProfiles())[0].id==='verified_owner','profile lookup returns stable UID');
 await reject(()=>p.saveProfile('someone@example.com'),'email never becomes a public profile name');
 let t=await p.createTournamentDocument(e.createTournament({id:'test_t',ownerId:'wrong_owner',title:'Unicode 🎯',date:'2026-09-07',gameType:'501',bestOf:3}));
 assert(t.ownerId==='verified_owner'&&t.revision===0,'owner and revision assigned by storage');
 await reject(()=>p.createTournamentDocument(t),'duplicate tournament ID');
 await reject(()=>p.updateTournament(t.id,9,x=>x),'stale revision');
 await reject(()=>p.updateTournament(t.id,0,x=>({...x,email:'private@example.com'})),'unknown/private document fields');
 await reject(()=>p.updateTournament(t.id,0,async x=>x),'async updater');
 let attempts=0;globalThis.retryTransaction=true;
 t=await p.updateTournament(t.id,0,x=>{attempts++;return {...x,title:'Retried'};});
 assert(attempts===2&&t.revision===1,'transaction retry commits one revision');
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,
 Array.from({length:64},(_,i)=>({id:'r'+i,playerId:i===0?'verified_owner':null,
 name:i===0?'Zoë "Ace" \\ 🎯':'Player '+i,tag:String(Math.floor(i/2)),
 paid:true,checkedIn:true,standby:false}))));
 const started=e.startTournament(t);
 t=await p.updateTournament(t.id,t.revision,()=>started);
 assert(t.teams.length===32&&t.registrations.length===64&&t.matches.length===63,'full32-team engine support');
 assert(typeof testDocs.get('blakeoutDevTournaments/test_t').matches==='string','packed wire format');
 assert(Array.isArray((await p.getTournament(t.id)).matches),'decoded API arrays');
 const publicWire=testDocs.get('blakeoutDevTournaments/test_t');
 assert(JSON.parse(publicWire.registrations).every(r=>!('paid' in r)&&!('checkedIn' in r)&&!('standby' in r)),'no private flags in public payload');
 const privateWire=structuredClone(testDocs.get('blakeoutDevRosterPrivate/test_t'));
 assert(privateWire.revision===t.revision&&JSON.parse(privateWire.registrations)[0].checkedIn,'atomic private roster revision and flags');
 assert((await p.getTournament(t.id)).registrations.every(r=>r.paid&&r.checkedIn),'owner get merges private flags');
 assert((await p.listTournaments())[0].registrations[0].checkedIn,'owner list merges private flags');
 changeTestUser({uid:'spectator',email:'spectator@example.com',emailVerified:true,isAnonymous:false});
 globalThis.testReadPaths=[];
 const spectator=await p.getTournament(t.id), spectatorList=await p.listTournaments();
 assert(spectator.registrations.every(r=>!r.paid&&!r.checkedIn&&!r.standby)&&!spectatorList[0].registrations[0].paid,'spectators receive redacted default flags');
 assert(!testReadPaths.some(path=>path.startsWith('blakeoutDevRosterPrivate/')),'spectator never requests owner-only metadata');
 await reject(()=>p.updateTournament(t.id,t.revision,()=>spectator),'spectator defaults cannot write');
 changeTestUser({uid:'verified_owner',email:'owner@example.com',emailVerified:true,isAnonymous:false});
 await reject(()=>p.updateTournament(t.id,t.revision,x=>({...x,registrations:x.registrations.map((r,i)=>i?r:{...r,playerId:'missing_profile'})})),'linked player requires existing verified profile read');
 testDocs.delete('blakeoutDevRosterPrivate/test_t');
 await reject(()=>p.getTournament(t.id),'owner read rejects missing private metadata');
 await reject(()=>p.updateTournament(t.id,t.revision,x=>x),'owner writes never use spectator defaults when metadata missing');
 testDocs.set('blakeoutDevRosterPrivate/test_t',privateWire);
 testDocs.set('blakeoutDevRosterPrivate/test_t',{...privateWire,revision:privateWire.revision-1});
 await reject(()=>p.updateTournament(t.id,t.revision,x=>x),'owner writes reject out-of-sync private revision');
 testDocs.set('blakeoutDevRosterPrivate/test_t',privateWire);
 await reject(()=>p.updateTournament(t.id,t.revision,x=>({...x,registrations:x.registrations.map((r,i)=>i?r:{...r,unknown:'no'})})),'unknown nested write schema');
 const goodWire=structuredClone(testDocs.get('blakeoutDevTournaments/test_t'));
 const badWire=structuredClone(goodWire), entries=JSON.parse(badWire.registrations);
 entries[0].unknown='no';badWire.registrations=JSON.stringify(entries);
 testDocs.set('blakeoutDevTournaments/test_t',badWire);
 await reject(()=>p.getTournament(t.id),'unknown nested read schema');
 testDocs.set('blakeoutDevTournaments/test_t',goodWire);
 await reject(()=>p.updateTournament(t.id,t.revision,x=>({...x,registrations:x.registrations.map((r,i)=>i?r:{...r,name:'🎯'.repeat(26000)})})),'UTF8 payload size bound');
 const match=t.matches.find(m=>m.status==='ready'&&[m.teamA,m.teamB].some(id=>t.teams.find(team=>team.id===id).memberIds.includes('r0')));
 const result={matchId:match.id,gameType:'501',participantIds:['verified_owner'],
 perPlayer:[{playerId:'verified_owner',gameType:'501',points:501,darts:21,marks:0}],
 legScores:[],winnerId:match.teamA,scoreA:2,scoreB:0,records:{id:'record',legs:[]}};
 const updater=current=>e.recordResult(current,match.id,result);
 await reject(()=>p.saveMatchResult(t.id,t.revision,'bad_guest',{...result,participantIds:['verified_owner',null]},updater),'guest participant rejected');
 await reject(()=>p.saveMatchResult(t.id,t.revision,'bad_counter',{...result,perPlayer:[{playerId:'unrelated'}]},updater),'unrelated stats rejected');
 assert(!testDocs.has('blakeoutDevResults/bad_guest')&&(await p.getTournament(t.id)).revision===t.revision,'failed save atomicity');
 globalThis.testOffline=true;
 await reject(()=>p.saveMatchResult(t.id,t.revision,'offline',result,updater),'offline save rejects rather than fake success');
 globalThis.testOffline=false;
 const next=await p.saveMatchResult(t.id,t.revision,'result_one',result,updater);
 assert(next.revision===t.revision+1&&testDocs.has('blakeoutDevResults/result_one'),'atomic tournament/result save');
 assert(typeof testDocs.get('blakeoutDevResults/result_one').perPlayer==='string','counter wire payload is canonical JSON');
 assert(Array.isArray((await p.listMyResults())[0].perPlayer),'result API decodes counter arrays');
 const immutable=JSON.stringify(testDocs.get('blakeoutDevResults/result_one'));
 const duplicate=await p.saveMatchResult(t.id,t.revision,'result_one',result,()=>{throw Error('Must not run');});
 assert(duplicate.revision===next.revision&&immutable===JSON.stringify(testDocs.get('blakeoutDevResults/result_one')),'immutable dedup before stale check');
 await reject(()=>p.saveMatchResult(t.id,next.revision,'result_two',result,updater),'new result ID cannot duplicate completed match');
 assert((await p.listMyResults()).length===1,'own results query');
 testDocs.set('blakeoutDevTournaments/other',{...goodWire,id:'other',ownerId:'other_owner'});
 await reject(()=>p.updateTournament('other',goodWire.revision,x=>x),'nonowner mutation rejected');
 await p.sendAccountLink('owner@example.com');
 assert(new URL(sentLink.settings.url).pathname==='/dev/accounts/'&&sentLink.settings.handleCodeInApp,'canonical email return URL');
 await p.signOutAccount();
 await reject(()=>p.listProfiles(),'signed-out profile lookup rejected');
 await reject(()=>p.listMyResults(),'signed-out result query rejected');
 changeTestUser({uid:'unverified',email:'unverified@example.com',emailVerified:false,isAnonymous:false});
 await reject(()=>p.listProfiles(),'entered unverified email never grants profile lookup');
 changeTestUser({uid:'anonymous',emailVerified:true,isAnonymous:true});
 await reject(()=>p.listProfiles(),'anonymous identity rejected');
 await p.signOutAccount();
 await reject(()=>p.signInAccount('owner@example.com','wrong-password'),'incorrect password rejected');
 await reject(()=>p.registerAccount('new@example.com','short'),'weak password rejected before SDK');
 const registered=await p.registerAccount('new@example.com','TestOnlyPassword123!');
 assert(registered.uid==='registered_user'&&!registered.emailVerified,'password registration creates unverified Firebase UID');
 assert(sentVerification.email==='new@example.com'&&new URL(sentVerification.settings.url).pathname==='/dev/accounts/','signup sends verification with canonical return URL');
 await reject(()=>p.saveProfile('New player'),'unverified password account cannot create public profile');
 await reject(()=>p.listProfiles(),'unverified password account cannot inspect profiles');
 assert(!document.querySelector('#accountControls').hidden&&document.querySelector('#profilePanel').hidden,'unverified signout visible while private UI locked');
 await p.sendAccountVerification();
 assert(sentVerification.count===2,'verification resend supported');
 await p.resetAccountPassword('new@example.com');
 assert(sentReset.email==='new@example.com','password reset supported');
 assert(!Object.values(localStorage).some(value=>value.includes('TestOnlyPassword123!')),'password never saved to localStorage');
 globalThis.mockVerified=true;
 await p.refreshAccount();
 assert(p.requireVerifiedAccount().uid==='registered_user'&&reloadCount>0,'reload verifies same UID and unlocks account');
 globalThis.mockVerified=false;
 await p.signOutAccount();
 await p.signInAccount('owner@example.com','TestOnlyPassword123!');
 assert(p.getAccount().uid==='verified_owner','password signin preserves existing verified UID');
 const worstIds=['counter_a1','counter_a2','counter_b1','counter_b2'];
 worstIds.forEach(id=>testDocs.set('blakeoutDevProfiles/'+id,{name:id}));
 let chicago=await p.createTournamentDocument(e.createTournament({id:'chicago_worst',ownerId:'verified_owner',title:'12 counters',date:'2026-09-07',gameType:'chicago',bestOf:3}));
 chicago=await p.updateTournament(chicago.id,0,current=>e.saveRoster(current,worstIds.map((id,i)=>({
 id:'chicago_r'+i,playerId:id,name:id,tag:i<2?'A':'B',paid:true,checkedIn:true,standby:false}))));
 const chicagoStarted=e.startTournament(chicago);
 chicago=await p.updateTournament(chicago.id,chicago.revision,()=>chicagoStarted);
 const worstMatch=chicago.matches.find(m=>m.status==='ready');
 const worstCounters=worstIds.flatMap(playerId=>['301','501','cricket'].map(gameType=>({playerId,gameType,points:501,darts:21,marks:3})));
 const worstResult={matchId:worstMatch.id,gameType:'chicago',participantIds:worstIds,
 perPlayer:worstCounters,legScores:[],winnerId:worstMatch.teamA,scoreA:2,scoreB:1};
 const worstUpdater=current=>e.recordResult(current,worstMatch.id,worstResult);
 for(const [value,label] of [[NaN,'NaN'],[Infinity,'Infinity'],[-1,'negative'],[1e12,'oversized']]){
 await reject(()=>p.saveMatchResult(chicago.id,chicago.revision,'bad_'+label,
 {...worstResult,perPlayer:[{...worstCounters[0],points:value}]},worstUpdater),'invalid '+label+' counters rejected');
 }
 await reject(()=>p.saveMatchResult(chicago.id,chicago.revision,'too_many',
 {...worstResult,perPlayer:[...worstCounters,worstCounters[0]]},worstUpdater),'13th counter rejected');
 const counterFixture={ownerId:'verified_owner',publicLive:structuredClone(testDocs.get('blakeoutDevTournaments/chicago_worst')),
 privateLive:structuredClone(testDocs.get('blakeoutDevRosterPrivate/chicago_worst'))};
 await p.saveMatchResult(chicago.id,chicago.revision,'chicago_worst_result',worstResult,worstUpdater);
 counterFixture.publicComplete=testDocs.get('blakeoutDevTournaments/chicago_worst');
 counterFixture.privateComplete=testDocs.get('blakeoutDevRosterPrivate/chicago_worst');
 counterFixture.result=testDocs.get('blakeoutDevResults/chicago_worst_result');
 assert(JSON.parse(counterFixture.result.perPlayer).length===12,'all4players times3Chicago games stored');
 changeTestUser({uid:'counter_a1',email:'counter-a1@example.com',emailVerified:true,isAnonymous:false});
 assert((await p.listMyResults())[0].perPlayer.length===12,'12-entry counter result decoded for participant');
 changeTestUser({uid:'verified_owner',email:'owner@example.com',emailVerified:true,isAnonymous:false});
 return {checks,wire:testDocs.get('blakeoutDevTournaments/test_t'),privateWire:testDocs.get('blakeoutDevRosterPrivate/test_t'),counterFixture};
}"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def grammar_checks(wire, private_wire):
    """Exercise the exact checked-in grammar strings, not copies of the regexes."""
    rules = (ROOT / "firestore.rules").read_text()
    count = 0
    for function, field in [
        ("devRegistrationPayload", "registrations"),
        ("devTeamPayload", "teams"), ("devMatchPayload", "matches"),
        ("devPrivateRosterPayload", "privateRegistrations")
    ]:
        body = rules.split(f"function {function}(", 1)[1].split("\n    }", 1)[0]
        values = {}

        def expression(source):
            def visit(node):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    return node.value
                if isinstance(node, ast.Name):
                    return values[node.id]
                if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                    return visit(node.left) + visit(node.right)
                raise AssertionError(f"Unexpected grammar expression: {source}")
            return visit(ast.parse(" ".join(source.splitlines()).strip(), mode="eval").body)

        for name, value in re.findall(r"let (\w+) = (.*?);", body, flags=re.S):
            values[name] = expression(value)
        pattern = expression(re.search(r"return value.matches\((.*?)\);", body, flags=re.S)[1])
        regex = re.compile(pattern)
        packed = private_wire["registrations"] if field == "privateRegistrations" else wire[field]
        assert regex.fullmatch(packed), f"{field}: actual Unicode32-team payload rejected"
        entries = json.loads(packed)
        entries[0]["unknown"] = "no"
        assert not regex.fullmatch(json.dumps(entries, ensure_ascii=False, separators=(",", ":")))
        del entries[0]["unknown"]
        string_field = "name" if field in {"registrations", "teams"} else "id"
        for label in ['Zoë 🎯 東京', 'Ace "Quoted"', r"Back\slash", "line\nbreak", r"literal\u0040"]:
            entries[0][string_field] = label
            assert regex.fullmatch(json.dumps(entries, ensure_ascii=False, separators=(",", ":"))), label
            count += 1
        entries[0][string_field] = "secret@example.com"
        email = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        assert not regex.fullmatch(email)
        assert not regex.fullmatch(email.replace("@", r"\u0040")), "escaped email bypass"
        assert not regex.fullmatch("not-json"), "invalid JSON accepted"
        entries[0][string_field] = "line\nbreak"
        escaped = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        assert not regex.fullmatch(escaped.replace(r"\n", "\n")), "unescaped JSON control character accepted"
        if field == "registrations":
            entries[0]["paid"] = True
            assert not regex.fullmatch(json.dumps(entries, ensure_ascii=False, separators=(",", ":"))), "private flag allowed in public schema"
        count += 6
    print(f"PASS packed schema grammar ({count} checks; Python regex, not emulator)")

def result_grammar_checks(result):
    rules = (ROOT / "firestore.rules").read_text()
    body = rules.split("function devResultCounters(", 1)[1].split("\n    }", 1)[0]
    values = {"players": "|".join(result["participantIds"])}

    def expression(source):
        def visit(node):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                return node.value
            if isinstance(node, ast.Name):
                return values[node.id]
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                return visit(node.left) + visit(node.right)
            raise AssertionError(f"Unexpected counter grammar expression: {source}")
        return visit(ast.parse(" ".join(source.splitlines()).strip(), mode="eval").body)

    for name, value in re.findall(r"let (\w+) = (.*?);", body, flags=re.S):
        if name != "players":
            values[name] = expression(value)
    regex = re.compile(expression(re.search(r"value.matches\((.*?)\)\)\);", body, flags=re.S)[1]))
    assert regex.fullmatch(result["perPlayer"]), "12-entry Chicago counter fixture rejected"
    entries = json.loads(result["perPlayer"])
    pack = lambda data: json.dumps(data, separators=(",", ":"))
    assert len(entries) == 12 and len(set(entry["playerId"] for entry in entries)) == 4
    assert not regex.fullmatch(pack(entries + [entries[0]])), "13 counters accepted"
    for changes in [{"playerId": "unrelated"}, {"gameType": "unknown"}, {"unknown": True},
                    {"points": -1}, {"darts": 1.5}, {"marks": None}, {"points": 1000000000000}]:
        assert not regex.fullmatch(pack([{**entries[0], **changes}])), changes
    for value in [0, 0.5, 0.0000012345678901234567, 1.23456789e-200, 5e-324, 999999999999]:
        assert regex.fullmatch(pack([{**entries[0], "points": value, "marks": value}])), value
    assert not regex.fullmatch(result["perPlayer"].replace('"counter_a1"', '"counter_\\u00611"')), "escaped UID accepted"
    print("PASS result counter grammar (12-entry Chicago, membership, bounds, decimals, unknown fields)")


def emulator_checks(wire, private_wire):
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        print("SKIP Firestore emulator: FIRESTORE_EMULATOR_HOST unset; rules not deployed/compiled")
        return
    if host.split(":")[0] not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("Tests only allow a localhost Firestore emulator, never a live project.")
    project = f"demo-blakeout-platform-{os.getpid()}"
    base = f"http://{host}"

    def request(method, path, data=None, user=None):
        headers = {"Content-Type": "application/json"}
        if user:
            encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
            claims = {"sub": user, "user_id": user, "aud": project, "iss": f"https://securetoken.google.com/{project}",
                      "email": f"{user}@example.com", "email_verified": user != "unverified",
                      "firebase": {"sign_in_provider": "password"}, "iat": 0, "exp": 4102444800}
            headers["Authorization"] = f"Bearer {encode({'alg': 'none', 'typ': 'JWT'})}.{encode(claims)}."
        req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(),
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()

    def fields(value):
        if value is None:
            return {"nullValue": None}
        if isinstance(value, bool):
            return {"booleanValue": value}
        if isinstance(value, int):
            return {"integerValue": str(value)}
        if isinstance(value, str):
            return {"stringValue": value}
        if isinstance(value, list):
            return {"arrayValue": {"values": [fields(item) for item in value]}}
        return {"mapValue": {"fields": {key: fields(item) for key, item in value.items()}}}

    def put(path, data, user="verified_owner"):
        return request("PATCH", f"/v1/projects/{project}/databases/(default)/documents/{path}",
                       {"fields": {key: fields(item) for key, item in data.items()}}, user)

    prefix = f"projects/{project}/databases/(default)/documents/"

    def commit(documents, user="verified_owner"):
        writes = [{"update": {"name": prefix + path, "fields": {key: fields(value) for key, value in data.items()}}}
                  for path, data in documents]
        return request("POST", f"/v1/projects/{project}/databases/(default)/documents:commit",
                       {"writes": writes}, user)

    code, text = request("PUT", f"/emulator/v1/projects/{project}:securityRules",
                         {"rules": {"files": [{"name": "firestore.rules", "content": (ROOT / "firestore.rules").read_text()}]}})
    assert code == 200, f"Rules compilation failed: {code} {text}"
    assert put("blakeoutDevProfiles/verified_owner", {"name": 'Zoë "Ace" \\ 🎯'})[0] == 200
    assert put("blakeoutDevProfiles/other", {"name": "Imposter"})[0] == 403
    assert put("blakeoutDevProfiles/unverified", {"name": "Unverified"}, "unverified")[0] == 403
    assert put("blakeoutDevProfiles/verified_owner", {"name": "Owner", "email": "private@example.com"})[0] == 403
    document = {**wire, "id": "emulator", "revision": 0, "status": "registration", "gameType": "chicago"}
    metadata = {**private_wire, "tournamentId": "emulator", "revision": 0}
    assert put("blakeoutDevTournaments/emulator", document)[0] == 403, "unpaired public creation"
    code, text = commit([("blakeoutDevTournaments/emulator", document), ("blakeoutDevRosterPrivate/emulator", metadata)])
    assert code == 200, f"Atomic tournament/private roster creation denied: {code} {text}"
    assert request("GET", f"/v1/projects/{project}/databases/(default)/documents/blakeoutDevTournaments/emulator")[0] == 200
    private_path = f"/v1/{prefix}blakeoutDevRosterPrivate/emulator"
    assert request("GET", private_path, user="verified_owner")[0] == 200
    for user in ["other", "unverified", None]:
        assert request("GET", private_path, user=user)[0] == 403, "private roster disclosed"
    assert put("blakeoutDevTournaments/emulator", {**document, "revision": 1}, "other")[0] == 403
    assert put("blakeoutDevTournaments/emulator", {**document, "revision": 1})[0] == 403, "unpaired public update"
    assert put("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 1})[0] == 403, "unpaired private update"
    assert put("blakeoutDevTournaments/emulator", {**document, "revision": 2})[0] == 403
    invalid = json.loads(document["registrations"])
    invalid[0]["name"] = "secret@example.com"
    invalid_flags = json.loads(document["registrations"])
    invalid_flags[0]["paid"] = True
    for payload in [json.dumps(invalid, separators=(",", ":")),
                    json.dumps(invalid, separators=(",", ":")).replace("@", r"\u0040"),
                    json.dumps(invalid_flags, separators=(",", ":"))]:
        assert commit([("blakeoutDevTournaments/emulator", {**document, "revision": 1, "registrations": payload}),
                       ("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 1})])[0] == 403
    assert put("blakeoutDevUnknown/doc", {"name": "Unknown schema"})[0] == 403
    participants = ["verified_owner", "verified_participant", "counter_third", "counter_fourth"]
    for participant in participants[1:]:
        assert put(f"blakeoutDevProfiles/{participant}", {"name": participant}, participant)[0] == 200
    result = {"ownerId": "verified_owner", "tournamentId": "emulator",
              "participantIds": participants,
              "perPlayer": json.dumps([{"playerId": player, "gameType": game, "points": 501, "darts": 21, "marks": 0}
                                      for player in participants for game in ["301", "501", "cricket"]], separators=(",", ":")),
              "gameType": "chicago", "matchId": "W1.1", "legScores": [], "createdAt": 1788792400000}
    assert put("blakeoutDevResults/result", result)[0] == 403, "result must be accompanied by tournament revision"
    code, text = commit([("blakeoutDevTournaments/emulator", {**document, "revision": 1}),
                         ("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 1}),
                         ("blakeoutDevResults/result", result)])
    assert code == 200, f"Atomic result denied: {code} {text}"
    result_path = f"/v1/{prefix}blakeoutDevResults/result"
    for user, expected in [("verified_owner", 200), ("verified_participant", 200),
                           ("unrelated", 403), ("unverified", 403), (None, 403)]:
        assert request("GET", result_path, user=user)[0] == expected, user
    assert put("blakeoutDevResults/result", result)[0] == 403, "immutable result update"
    assert request("DELETE", result_path, user="verified_owner")[0] == 403, "immutable result deletion"
    print("PASS actual Firestore emulator compilation/access/privacy checks")


async def run():
    RUNTIME.mkdir(exist_ok=True)
    os.environ["TMPDIR"] = str(RUNTIME)
    import tempfile
    tempfile.tempdir = str(RUNTIME)
    from playwright.async_api import async_playwright
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path=shutil.which("google-chrome"), headless=True,
                                               args=["--no-sandbox", "--disable-dev-shm-usage"])
            context = await browser.new_context(service_workers="block", accept_downloads=True)

            async def route(request):
                url = request.request.url
                modules = {"firebase-app.js": APP, "firebase-auth.js": AUTH, "firebase-firestore.js": STORE}
                filename = url.rsplit("/", 1)[-1]
                if filename in modules:
                    await request.fulfill(content_type="text/javascript", body=modules[filename])
                elif url.startswith(base):
                    await request.continue_()
                else:
                    await request.abort()
            await context.route("**/*", route)
            page = await context.new_page()
            await page.goto(base + "/dev/accounts/")
            output = await page.evaluate(API_TESTS)
            print(f"PASS platform APIs ({len(output['checks'])} assertions)")
            grammar_checks(output["wire"], output["privateWire"])
            result_grammar_checks(output["counterFixture"]["result"])
            if "--print-simulator-fixture" in sys.argv:
                print("SIMULATOR_FIXTURE=" + json.dumps(output["counterFixture"], ensure_ascii=False, separators=(",", ":")))
            await page.locator("#refreshRecords").click()
            await page.wait_for_function("document.querySelector('#lifetimeSummary').textContent.includes('23.86 PPD')")
            async with page.expect_download() as download_event:
                await page.locator("#exportRecords").click()
            download = await download_event.value
            export = RUNTIME / "records.json"
            await download.save_as(export)
            data = json.loads(export.read_text())
            assert data["playerId"] == "verified_owner" and len(data["results"]) == 1
            await page.set_viewport_size({"width": 390, "height": 844})
            assert await page.evaluate("document.documentElement.scrollWidth <= 390")
            assert await page.locator('nav a[href="../brackets/"]').count() == 1
            other = await context.new_page()
            await other.goto(base + "/dev/accounts/")
            await other.locator("#signOut").click()
            await page.wait_for_function("document.querySelector('#profilePanel').hidden")
            await page.goto(base + "/dev/accounts/?oobCode=mock-link")
            await page.locator("#linkEmail").fill("owner@example.com")
            await page.locator("#completeLink").click()
            await page.wait_for_function("document.querySelector('#profilePanel').hidden === false")
            assert "oobCode" not in page.url
            await page.evaluate("globalThis.denyReads=true")
            await page.locator("#refreshRecords").click()
            await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('permission-denied')")
            print("PASS account UI (records/export, mobile, route, shared signout, email completion, permission errors)")
            await page.evaluate("globalThis.denyReads=false")
            await page.locator("#signOut").click()
            await page.locator("#accountEmail").fill("new@example.com")
            await page.locator("#accountPassword").fill("BrowserTestPassword123!")
            await page.locator("#passwordRegister").click()
            await page.wait_for_function("document.querySelector('#verificationPanel').hidden === false")
            await page.wait_for_function("document.querySelector('#accountPassword').value === ''")
            assert await page.locator("#signOut").is_visible()
            assert await page.locator("#profilePanel").is_hidden()
            await page.evaluate("globalThis.authFailure='auth/too-many-requests'")
            await page.locator("#sendVerification").click()
            await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('auth/too-many-requests')")
            await page.evaluate("globalThis.authFailure=null;globalThis.mockVerified=true;dispatchEvent(new Event('focus'))")
            await page.wait_for_function("document.querySelector('#profilePanel').hidden === false")
            assert await page.evaluate("!Object.values(localStorage).some(value=>value.includes('BrowserTestPassword123!'))")
            await page.locator("#signOut").click()
            await page.locator("#passwordReset").click()
            await page.wait_for_function("globalThis.sentReset?.email === 'new@example.com'")
            await page.locator("#accountEmail").fill("owner@example.com")
            await page.locator("#accountPassword").fill("wrong-password")
            await page.locator("#passwordSignIn").click()
            await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('auth/invalid-credential')")
            assert await page.locator("#profilePanel").is_hidden()
            await page.locator("#accountPassword").fill("BrowserTestPassword123!")
            await page.locator("#passwordSignIn").click()
            await page.wait_for_function("document.querySelector('#profilePanel').hidden === false")
            print("PASS password UI (register, verification gate, unverified signout, quota errors, return reload, reset, sign-in)")
            await context.route("**/firebase-config.js", lambda request: request.abort())
            await page.reload()
            await page.wait_for_function("document.querySelector('#accountStatus').getAttribute('role') === 'alert'")
            assert await page.locator("#sendLink").is_disabled()
            assert await page.locator("#passwordSignIn").is_disabled()
            print("PASS missing Firebase config visibly surfaced")
            await context.close()
            await browser.close()
            emulator_checks(output["wire"], output["privateWire"])
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(RUNTIME, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(run())
