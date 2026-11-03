import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.BLAKEOUT_PLAYWRIGHT_MODULE||'playwright');
const html=fs.readFileSync(path.join(root,'dev/compat/index.html'),'utf8');
const engineCode=html.match(/<script id="simpleEngine">([\s\S]*?)<\/script>/)[1];
const context=vm.createContext({window:{}});vm.runInContext(engineCode,context);const E=context.window.BlakeOutSimple;
vm.runInContext('Promise=undefined; Map=undefined; Set=undefined; Array.from=undefined; Array.prototype.includes=undefined; Array.prototype.at=undefined; Object.assign=undefined; Object.entries=undefined; Object.values=undefined; Object.hasOwn=undefined; crypto=undefined; structuredClone=undefined;',context);
let g=E.create(301,'double',['A','B']);
let r=E.score(g,180,false,false);assert.equal(r.game.players[0].score,121);assert.equal(g.players[0].score,301);g=r.game;
g=E.score(g,180,false,false).game;g=E.score(g,120,false,false).game;assert.equal(g.players[0].score,121);assert.equal(g.current,1);
g=E.score(g,0,false,true).game;r=E.score(g,121,false,false);assert(r.bust);assert.equal(r.game.players[0].score,121);
r=E.score(g,121,true,false);assert.equal(r.game.winner,0);assert.equal(E.undo(r.game).players[0].score,121);assert.equal(E.undo(r.game).winner,null);
assert.throws(()=>E.score(g,181,false,false));assert.throws(()=>E.score(g,1.5,false,false));assert(!E.valid({version:1}));
let solo=E.create(301,'open',['Solo']);solo=E.score(solo,180,false,false).game;solo=E.score(solo,121,false,false).game;assert.equal(solo.winner,0);
let over=E.create(301,'open',['Solo']);over=E.score(over,180,false,false).game;assert(E.score(over,122,false,false).bust);assert.equal(E.score(over,121,false,false).game.winner,0);
console.log('PASS pure engine: immutable turns, rotation, straight/double out, bust, winner undo, validation');
const dart=(target,multiplier=1,points=0)=>({target,multiplier,points});
let mn=E.create('minnesota','normal',['A','B']);assert.equal(E.targets.length,10);
mn=E.addDart(mn,dart('20',3));mn=E.addDart(mn,dart('20',2));let confirmed=E.confirm(mn);assert.equal(confirmed.players[0].marks['20'],3);assert.equal(confirmed.players[0].score,40);assert.equal(confirmed.current,1);assert.equal(E.undo(confirmed).pending.length,2);assert.equal(E.undo(E.undo(confirmed)).pending.length,1);
assert.throws(()=>E.addDart(mn,dart('Bed')));assert.throws(()=>E.addDart(E.create('minnesota','normal',['A']),dart('Bull',3)));assert.throws(()=>E.create('minnesota','cutthroat',['A']));
let bed=E.addDart(E.create('minnesota','normal',['A','B']),dart('Bed'));assert.throws(()=>E.addDart(bed,dart('MISS')));assert.equal(E.confirm(bed).players[0].marks.Bed,1);
let cut=E.create('minnesota','cutthroat',['A','B','C']);cut.players[0].marks['20']=3;cut.players[2].marks['20']=3;cut=E.confirm(E.addDart(cut,dart('20',2)));assert.deepEqual(Array.from(cut.players,p=>p.score),[0,40,0]);
let special=E.create('minnesota','normal',['A','B']);special.players[0].marks.Triples=2;special=E.addDart(special,dart('Triples'));assert.throws(()=>E.addDart(special,dart('Triples',1,4)));special=E.confirm(E.addDart(special,dart('Triples',1,60)));assert.equal(special.players[0].score,60);
let winning=E.create('minnesota','normal',['A','B']);for(const t of E.targets)winning.players[0].marks[t]=3;winning.players[0].marks.Bull=1;winning.players[1].score=25;let notWon=E.confirm(E.addDart(winning,dart('Bull',2)));assert.equal(notWon.winner,null);winning.players[0].score=25;let won=E.confirm(E.addDart(winning,dart('Bull',2)));assert.equal(won.winner,0);assert.equal(E.undo(won).winner,null);assert.equal(E.undo(won).pending.length,1);
let cutWin=E.create('minnesota','cutthroat',['A','B']);for(const t of E.targets)cutWin.players[0].marks[t]=3;cutWin.players[0].marks.Bull=1;cutWin.players[0].score=10;assert.equal(E.confirm(E.addDart(cutWin,dart('Bull',2))).winner,null);cutWin.players[1].score=10;assert.equal(E.confirm(E.addDart(cutWin,dart('Bull',2))).winner,0);
let shut=E.create('minnesota','normal',['A','B']);shut.players[0].marks['20']=shut.players[1].marks['20']=3;assert.equal(E.confirm(E.addDart(shut,dart('20',3))).players[0].score,0);
assert(E.valid(JSON.parse(JSON.stringify(mn))));assert(!E.valid({...JSON.parse(JSON.stringify(mn)),pending:[dart('Bull',3)]}));
console.log('PASS Minnesota engine: ten targets, excess/closed rows, normal/Cutthroat, special points, Bed, dart limits, ties/wins, undo and serialized pending darts');
// Acorn, if available, verifies actual ES5 grammar rather than keyword heuristics.
if(process.env.BLAKEOUT_ACORN_MODULE){const acorn=require(process.env.BLAKEOUT_ACORN_MODULE);for(const file of ['dev/index.html','dev/compat/index.html']){const s=fs.readFileSync(path.join(root,file),'utf8');for(const match of s.matchAll(/<script id="(?:startupGuard|simpleEngine|simpleUI)">([\s\S]*?)<\/script>/g))acorn.parse(match[1],{ecmaVersion:5});}console.log('PASS ES5 parser for independent startup and simple-mode scripts');}
const browser=await chromium.launch({executablePath:process.env.BLAKEOUT_CHROMIUM||undefined,headless:true});
let passed=0;
async function run(name,fn,{fault='',javaScriptEnabled=true}={}){
 const c=await browser.newContext({serviceWorkers:'block',javaScriptEnabled,viewport:{width:744,height:1133}});
 await c.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:8765')return route.abort();if(fault==='missing'&&u.pathname==='/dev/js/registry.js')return route.fulfill({status:404,body:'missing'});if(fault==='syntax'&&u.pathname==='/dev/js/registry.js')return route.fulfill({contentType:'text/javascript',body:'export const = ;'});if(fault==='slow'&&u.pathname==='/dev/js/registry.js')await new Promise(r=>setTimeout(r,500));let f=path.join(root,u.pathname);try{if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');await route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/octet-stream'});}catch{await route.fulfill({status:404,body:'missing'});}});
 await c.addInitScript(f=>{localStorage.setItem('blakeout_active_game','preserve-modern');if(f==='unsupported')Array.prototype.at=undefined;if(f==='nomodule')delete HTMLScriptElement.prototype.noModule;if(f==='blocked')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}});if(f==='corrupt')localStorage.setItem('blakeout_configs','{broken');if(f==='slow'){const t=window.setTimeout;window.setTimeout=function(fn,ms){return t(fn,ms===12000?50:ms);};}},fault);
 const p=await c.newPage();
 try{await fn(p);if(javaScriptEnabled&&fault!=='blocked')assert.equal(await p.evaluate(()=>localStorage.getItem('blakeout_active_game')),'preserve-modern');passed++;console.log('PASS '+name);}finally{await c.close();}
}
const base='http://127.0.0.1:8765';
try{
 await run('modern startup hides warning and displays games',async p=>{await p.goto(base+'/dev/');await p.locator('#startupNotice').waitFor({state:'hidden'});assert.equal(await p.locator('[data-game-value]').count(),29);});
 for(const fault of ['missing','syntax','corrupt','blocked'])await run(fault+' startup reports generic failure, not unsupported',async p=>{await p.goto(base+'/dev/');await p.waitForFunction(()=>document.querySelector('#startupNotice').getAttribute('data-startup-state')==='failed');assert(await p.locator('#startupNotice').isVisible());},{fault});
 for(const fault of ['unsupported','nomodule'])await run(fault+' capability warning',async p=>{await p.goto(base+'/dev/');assert.equal(await p.locator('#startupNotice').getAttribute('data-startup-state'),'unsupported');if(process.env.BLAKEOUT_QA_OUTPUT){fs.mkdirSync(process.env.BLAKEOUT_QA_OUTPUT,{recursive:true});await p.screenshot({path:path.join(process.env.BLAKEOUT_QA_OUTPUT,'startup-'+fault+'.png')});}await p.click('#startupDismiss');assert(!(await p.locator('#startupNotice').isVisible()));},{fault});
 await run('slow is not called unsupported; late success hides warning',async p=>{await p.goto(base+'/dev/',{waitUntil:'commit'});await p.waitForFunction(()=>document.querySelector('#startupNotice')?.getAttribute('data-startup-state')==='slow');assert((await p.locator('#startupMessage').textContent()).includes('does not mean'));await p.locator('#startupNotice').waitFor({state:'hidden'});},{fault:'slow'});
 await run('no JavaScript still shows static warning',async p=>{await p.goto(base+'/dev/');assert(await p.locator('#startupNotice').isVisible());assert((await p.locator('noscript').textContent()).includes('disabled'));},{javaScriptEnabled:false});
 await run('simple scoring start, double-click guard, undo, finish, cancel and reload',async p=>{
  await p.goto(base+'/dev/compat/');await p.selectOption('#distance','301');await p.selectOption('#count','1');await p.fill('#name0','<Player>');await p.click('#start');
  await p.fill('#score','180');await p.locator('#submit').dblclick();assert((await p.locator('#scores').textContent()).includes('121'));await p.waitForTimeout(550);
  await p.click('#undo');assert((await p.locator('#scores').textContent()).includes('301'));await p.fill('#score','180');await p.click('#submit');await p.waitForTimeout(550);await p.fill('#score','121');await p.click('#submit');assert((await p.locator('#turn').textContent()).includes('wins'));await p.waitForTimeout(550);await p.click('#undo');assert((await p.locator('#scores').textContent()).includes('121'));
  await p.click('#new');await p.click('#cancel');assert((await p.locator('#scores').textContent()).includes('121'));await p.reload();assert((await p.locator('#scores').textContent()).includes('121'));
  assert.equal(await p.locator('#scores script').count(),0);await p.setViewportSize({width:320,height:640});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(process.env.BLAKEOUT_QA_OUTPUT){fs.mkdirSync(process.env.BLAKEOUT_QA_OUTPUT,{recursive:true});await p.screenshot({path:path.join(process.env.BLAKEOUT_QA_OUTPUT,'simple-scoring.png'),fullPage:true});}
 });
 await run('simple reset confirmation and corrupt-save preservation',async p=>{
  await p.goto(base+'/dev/compat/');await p.evaluate(()=>localStorage.setItem('blakeout_dev_simple_game_v1','{corrupt'));await p.reload();assert((await p.locator('#storageWarning').textContent()).includes('not been removed'));await p.click('#start');await p.click('#cancel');assert.equal(await p.evaluate(()=>localStorage.getItem('blakeout_dev_simple_game_v1')),'{corrupt');await p.click('#start');await p.click('#confirm');assert(await p.locator('#play').isVisible());await p.click('#new');await p.keyboard.press('Escape');assert(await p.locator('#play').isVisible());await p.click('#new');await p.click('#confirm');await p.selectOption('#distance','301');await p.click('#start');await p.click('#confirm');assert((await p.locator('#scores').textContent()).includes('301'));
 });
 await run('simple mode works without modern scoring APIs and modules',async p=>{await p.goto(base+'/dev/compat/');await p.click('#start');await p.fill('#score','60');await p.click('#submit');assert((await p.locator('#scores').textContent()).includes('441'));},{fault:'unsupported'});
 await run('blocked storage keeps simple scoring operational with warning',async p=>{await p.goto(base+'/dev/compat/');await p.click('#start');await p.fill('#score','60');await p.click('#submit');assert((await p.locator('#scores').textContent()).includes('441'));assert((await p.locator('#storageWarning').textContent()).includes('Saving is unavailable'));},{fault:'blocked'});
 await run('simple double-out confirmation, four-player rotation and offline turns',async p=>{
  await p.goto(base+'/dev/compat/');await p.selectOption('#count','4');await p.selectOption('#distance','301');await p.selectOption('#finish','double');await p.click('#start');await p.context().setOffline(true);
  async function turn(total,double=false){await p.fill('#score',String(total));if(double)await p.check('#double');await p.click('#submit');await p.waitForTimeout(550);}
  for(let i=0;i<4;i++)await turn(180);await turn(120);assert((await p.locator('#scores li').first().textContent()).includes('121'));assert((await p.locator('#message').textContent()).includes('Bust'));await turn(121,false);assert((await p.locator('#message').textContent()).includes('Bust'));await turn(121,true);assert((await p.locator('#turn').textContent()).includes('Player 3 wins'));await p.click('#undo');assert((await p.locator('#turn').textContent()).includes('Player 3 to throw'));
 });
 await run('Minnesota pending save/reload, correction, confirmation and reset',async p=>{
  await p.goto(base+'/dev/compat/');await p.selectOption('#distance','minnesota');await p.click('#start');assert(!(await p.locator('#bust').isVisible()));await p.selectOption('#mnMultiplier','3');await p.click('#mnAdd');await p.waitForTimeout(550);await p.reload();assert((await p.locator('#mnPending').textContent()).includes('20 x3'));await p.click('#mnConfirm');await p.waitForTimeout(550);assert((await p.locator('#scores li').first().textContent()).includes('20: 3/3'));await p.click('#undo');assert((await p.locator('#mnPending').textContent()).includes('20 x3'));await p.click('#undo');assert((await p.locator('#mnPending').textContent()).includes('none'));await p.selectOption('#mnTarget','Bed');await p.click('#mnAdd');await p.waitForTimeout(550);await p.click('#mnMiss');assert((await p.locator('#message').textContent()).includes('at most three'));await p.click('#mnConfirm');await p.waitForTimeout(550);await p.reload();assert((await p.locator('#scores li').first().textContent()).includes('Bed: 1/3'));await p.click('#new');await p.click('#cancel');assert((await p.locator('#scores li').first().textContent()).includes('Bed: 1/3'));
  await p.setViewportSize({width:320,height:640});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(process.env.BLAKEOUT_QA_OUTPUT)await p.screenshot({path:path.join(process.env.BLAKEOUT_QA_OUTPUT,'minnesota.png'),fullPage:true});
 });
 await run('Minnesota parity with authoritative modern scorer',async p=>{
  await p.goto(base+'/dev/');
  for(const style of ['normal','cutthroat'])for(const target of ['20','Bull','Triples','Doubles','Bed']){
   let s=E.create('minnesota',style,['A','B','C']);s.players[0].marks[target]=3;s.players[2].marks[target]=3;const d=dart(target,target==='20'?3:target==='Bull'?2:1,target==='Triples'?60:target==='Doubles'?50:target==='Bed'?180:0);const expected=E.confirm(E.addDart(s,d));
   const actual=await p.evaluate(async({s,d})=>{const state=await import('./js/state.js'),cricket=await import('./js/cricket.js'),g=state.game;Object.assign(g,{type:'minnesota',currentPlayer:0,cricketPoints:true,minnesotaCutthroat:s.finish==='cutthroat',minnesotaPlaces:null,teamMode:false,teams:null,tournament:null,recording:null,scoringRecords:null,undoHistory:[],redoHistory:[],completedRounds:0});const template=state.initCricket('minnesota');g.players=s.players.map(p=>({name:p.name,score:p.score,throws:0,totalMarks:0,history:[],cricketData:Object.fromEntries(Object.entries(template).map(([t,v])=>[t,{...v,marks:p.marks[t],closed:p.marks[t]===3}]))}));g.pendingDarts=[{target:d.target,multiplier:d.multiplier,...(d.points?{specialScore:d.points}:{})}];cricket.cricketConfirm();return g.players.map(p=>({score:p.score,marks:Object.fromEntries(Object.entries(p.cricketData).map(([t,v])=>[t,v.marks]))}));},{s:JSON.parse(JSON.stringify(s)),d});
   assert.deepEqual(actual,JSON.parse(JSON.stringify(expected.players.map(p=>({score:p.score,marks:p.marks})))));
  }
 });
 console.log('PASS '+passed+' rendered groups; isolated synthetic data only');
}finally{await browser.close();}
