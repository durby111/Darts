#!/usr/bin/env python3
"""Local-only isolation contracts. SDK/provider traffic is mocked; no live data/mail."""
import asyncio,functools,threading,json
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
from platform_test import APP,AUTH,STORE
from feature_test_helpers import enable_future_features
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/workspace/scratch/isolated-backend-20261016')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def main():
 OUT.mkdir(parents=True,exist_ok=True);server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium')
   # Ordinary DEV never loads Firebase SDK or touches old roster/account continuation.
   c=await browser.new_context(service_workers='block');external=[]
   async def ordinary(route):
    if route.request.url.startswith(base):await route.continue_()
    else:external.append(route.request.url);await route.abort()
   await c.route('**/*',ordinary);page=await c.new_page();await page.goto(base+'/dev/manifest.json')
   sentinels={'blakeout_roster_id':'0123456789abcdef0123456789abcdef','blakeout_dev_email_link':'old@example.com','blakeout_dev_provider_return':'old-provider-state','blakeout_active_game':'production-save'}
   await page.evaluate('(s)=>Object.entries(s).forEach(([k,v])=>localStorage.setItem(k,v))',sentinels)
   await page.goto(base+'/dev/');await page.select_option('#gameType','minnesota');await page.check('#minnesotaCutthroat');await page.click('#startGameBtn');await page.wait_for_selector('#cricketMain',state='visible')
   await page.locator('[data-target="20"][data-multiplier="3"]').click();await page.click('#enterBtn');await page.reload();await page.click('#resumeGameBtn')
   assert await page.evaluate("async()=>{const {game}=await import('./js/state.js');return game.players[0].cricketData['20'].marks===3}")
   assert not external,external
   assert await page.evaluate('(s)=>Object.entries(s).every(([k,v])=>localStorage.getItem(k)===v)',sentinels)
   print('PASS ordinary DEV local scoring/reload; zero SDK/provider requests; production save and old identity keys unchanged',flush=True)
   await c.close()
   # Real page/adapter code with Firebase modules replaced solely by test fixtures.
   c=await browser.new_context(service_workers='block');requests=[]
   async def route(r):
    url=r.request.url;name=url.rsplit('/',1)[-1];modules={'firebase-app.js':APP,'firebase-auth.js':AUTH,'firebase-firestore.js':STORE}
    if name in modules:await r.fulfill(content_type='text/javascript',body=modules[name])
    elif url.startswith(base):await r.continue_()
    else:requests.append(url);await r.abort()
   await c.route('**/*',route);await enable_future_features(c);await c.tracing.start(screenshots=True,snapshots=True)
   page=await c.new_page();await page.goto(base+'/dev/manifest.json')
   before=await page.evaluate('''async()=>{
    const p=await import('/dev/js/platform.js'),apps=await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
    const before=apps.getApps().length;let failures=0;
    for(const f of [()=>p.saveCasualResult('old',{}),()=>p.saveMatchResult('old',0,'old',{},()=>{}),()=>p.saveCasualResult('old',{}, {backendKey:'blakeout'}),()=>p.joinTournamentAsGuest('old','Guest'),()=>p.completeAccountLink('old@example.com')]){
     try{await f();}catch(e){failures++;}
    }
    return {failures,before,after:apps.getApps().length};
   }''');assert before['failures']==5 and before['before']==before['after'],before
   await page.evaluate('''async()=>{
    const p=await import('/dev/js/platform.js');await p.initPlatform();
    const apps=(await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js')).getApps();
    const added=apps.filter(a=>a.name!=='[DEFAULT]');
    if(added.length!==1||added[0].name!=='blakeout-darts-dev-accounts'||added[0].options.projectId!=='blakeout-darts-dev'||added[0].options.appId!=='1:901185136996:web:89d4f413520e66ff773271')throw Error('wrong app isolation');
    localStorage.blakeout_dev_email_link='old@example.com';localStorage.blakeout_dev_provider_return='old-state';
    if(p.pendingAccountEmail())throw Error('old email identity reused');
    changeTestUser({uid:'new',email:'new@example.com',emailVerified:false,isAnonymous:false});
    await p.sendAccountVerification();await p.resetAccountPassword('new@example.com');
    if(sentVerification.email!=='new@example.com'||!sentReset)throw Error('Firebase built-in mail not called');
    if(new URL(sentVerification.settings.url).pathname!=='/dev/accounts/')throw Error('wrong return URL');
   }''')
   assert not requests,requests
   print('PASS adapter refuses missing/old origin and unsupported guest/link paths before init; dedicated new project app; built-in verification/reset mocks; old identity keys ignored; no Worker calls',flush=True)
   # Guard the UI before any network read or pending-result mutation.
   await page.goto(base+'/dev/');await page.select_option('#gameType','501');await page.click('#startGameBtn')
   await page.evaluate('''async()=>{
    const {game,saveActiveGame}=await import('./js/state.js');
    game.recording={source:'casual',resultId:'old-result',ownerId:'new',gameType:'501',bestOf:1,legWins:[1,0],legComplete:true,status:'pending',teams:[{id:'a',name:'A',members:[]},{id:'b',name:'B',members:[]}],pendingResult:{old:'immutable'}};
    game.scoringRecords={id:'old-result',legs:[]};saveActiveGame();
    globalThis.oldSnapshot=JSON.stringify(game.recording);
    await (await import('./js/casual-recording.js')).saveCasualResult();
    if(JSON.stringify(game.recording)!==oldSnapshot)throw Error('old casual result changed');
    game.tournament={...game.recording,matchId:'old-match',tournamentId:'old-event'};game.recording=null;
    const old=JSON.stringify(game.tournament);await (await import('./js/tournament-bridge.js')).saveTournamentResult();
    if(JSON.stringify(game.tournament)!==old)throw Error('old tournament result changed');
   }''')
   assert not requests
   print('PASS legacy casual/tournament UI saves rejected without rewriting pending payload or deleting recoverable game',flush=True)
   await c.tracing.stop(path=str(OUT/'isolation-trace.zip'));await c.close()
   # A preexisting app with the candidate name but a production config fails closed.
   c=await browser.new_context(service_workers='block')
   async def wrong(r):
    if r.request.url.endswith('/firebase-app.js'):await r.fulfill(content_type='text/javascript',body=APP.replace("[{name:'[DEFAULT]'}]","[{name:'blakeout-darts-dev-accounts',options:{projectId:'blakeout'}}]"))
    elif r.request.url.rsplit('/',1)[-1] in {'firebase-auth.js','firebase-firestore.js'}:await r.fulfill(content_type='text/javascript',body=AUTH if r.request.url.endswith('firebase-auth.js') else STORE)
    elif r.request.url.startswith(base):await r.continue_()
    else:await r.abort()
   await c.route('**/*',wrong);page=await c.new_page();await page.goto(base+'/dev/manifest.json')
   error=await page.evaluate("async()=>{try{await(await import('/dev/js/platform.js')).initPlatform()}catch(e){return e.message}}")
   assert 'does not match' in error
   print('PASS wrong-project app reuse fails closed',flush=True)
   await c.close();await browser.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
