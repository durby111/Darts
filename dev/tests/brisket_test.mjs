const build = process.env.BLAKEOUT_BUILD === 'production' ? '' : 'dev/';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {getGame, searchGames} from '../js/registry.js';
import {game, initCricket, brisketTargets} from '../js/state.js';
const BRISKET_TARGETS=['1','2','3','4','5','6'];
assert.deepEqual(brisketTargets(),[...BRISKET_TARGETS,'Bull']);
for(let start=1;start<=15;start++){const six=brisketTargets(start,false);assert.equal(six.length,6);assert.equal(new Set(six).size,6);assert.equal(Number(six[0]),start);assert.equal(Number(six[5]),start+5);assert(six.every(t=>Number(t)>=1&&Number(t)<=20));assert.deepEqual(brisketTargets(start,true),[...six,'Bull']);}
for(const bad of [0,16,1.5,NaN,'4'])assert.throws(()=>brisketTargets(bad));
assert.equal(getGame('brisket').engine,'cricket');assert(searchGames('Burt','all',[]).some(g=>g.id==='brisket'));
const marks=initCricket('brisket');assert.deepEqual(game.cricketTargets,[...BRISKET_TARGETS,'Bull']);assert(Object.values(marks).every(m=>m.maxMarks===3&&m.marks===0));
initCricket('cricket');assert.deepEqual(game.cricketTargets,['20','19','18','17','16','15','Bull']);
console.log('PASS confirmed default 1–6 plus Bull, all 15 six-number ranges, validation and unchanged Cricket targets');
const root=fileURLToPath(new URL('../../',import.meta.url));const require=createRequire(import.meta.url);const {chromium}=require(process.env.BLAKEOUT_PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({headless:true,executablePath:process.env.BLAKEOUT_CHROMIUM||undefined});let passed=0;
async function run(name,fn){const c=await b.newContext({serviceWorkers:'block',viewport:{width:744,height:1133}});await c.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:8765')return r.abort();let f=path.join(root,u.pathname);try{if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');await r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/octet-stream'});}catch{await r.fulfill({status:404,body:'missing'});}});await c.addInitScript(value=>{window.build=value},build);await c.addInitScript(()=>localStorage.setItem((build ? 'blakeout_active_game' : 'blakeout_dev_active_game'),'preserve-prod'));const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));try{await p.goto('http://127.0.0.1:8765/'+build);await p.selectOption('#gameType','brisket');await fn(p);assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>localStorage.getItem((build ? 'blakeout_active_game' : 'blakeout_dev_active_game'))),'preserve-prod');console.log('PASS '+name);passed++;}finally{await c.close();}}
const state=p=>p.evaluate(async()=>JSON.parse(JSON.stringify((await import('./js/state.js')).game)));
const turn=async(p,target,multiplier)=>{if(target==='MISS')await p.waitForTimeout(1100);return p.evaluate(async({target,multiplier})=>{const c=await import('./js/cricket.js');if(target==='MISS')c.cricketMiss();else{c.hitTarget(target,multiplier);c.cricketConfirm();}},{target,multiplier});};
try{
 await run('defaults, six-number options, Bull toggle and preset restoration',async p=>{
  assert(await p.locator('#cricketPoints').isChecked());assert(await p.locator('#brisketBulls').isChecked());assert.equal(await p.locator('#brisketStart').inputValue(),'1');
  for(const start of ['7','13','15']){await p.selectOption('#brisketStart',start);await p.uncheck('#brisketBulls');await p.uncheck('#cricketPoints');const config=await p.evaluate(async()=>{const s=await import('./js/state.js');return s.getCurrentConfig();});assert.equal(config.brisketStart,Number(start));assert.equal(config.brisketBulls,false);await p.selectOption('#gameType','501');await p.evaluate(async cfg=>(await import('./js/state.js')).applyConfig(cfg),config);assert.equal(await p.locator('#brisketStart').inputValue(),start);assert(!(await p.locator('#brisketBulls').isChecked()));assert(!(await p.locator('#cricketPoints').isChecked()));}
  await p.click('#startGameBtn');assert.deepEqual((await state(p)).cricketTargets,['15','16','17','18','19','20']);await p.reload();await p.click('#resumeGameBtn');assert.deepEqual((await state(p)).cricketTargets,['15','16','17','18','19','20']);assert.equal((await state(p)).cricketPoints,false);
 });
 await run('picker, Burt credit, target controls and responsive layout',async p=>{
  assert(await p.locator('#brisketSetupCredit').isVisible());await p.fill('#gameSearchInput','Brisket');assert.equal(await p.locator('[data-game-value]').count(),1);assert.equal(await p.locator('[data-game-value]').getAttribute('data-game-value'),'brisket');await p.fill('#gameSearchInput','');
  await p.click('#startGameBtn');assert.equal(await p.locator('#menuBtn').innerText(),'Menu');assert.deepEqual((await state(p)).cricketTargets,[...BRISKET_TARGETS,'Bull']);
  for(const width of [744,390]){await p.setViewportSize({width,height:1133});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const menu=await p.locator('#menuBtn').boundingBox();assert(menu.width<200);if(process.env.BLAKEOUT_QA_OUTPUT){fs.mkdirSync(process.env.BLAKEOUT_QA_OUTPUT,{recursive:true});await p.screenshot({path:path.join(process.env.BLAKEOUT_QA_OUTPUT,'brisket-'+width+'.png'),fullPage:true});}}
  await p.locator('[data-target="3"][data-multiplier="3"]').click();await p.click('#enterBtn');assert.equal((await state(p)).players[0].cricketData['3'].marks,3);
 });
 await run('face-value excess scoring, undo/redo, persistence and pending-dart recovery',async p=>{
  await p.click('#startGameBtn');await turn(p,'3',3);await turn(p,'MISS');await turn(p,'3',3);let s=await state(p);assert.equal(s.players[0].score,9);assert.equal(s.currentPlayer,1);
  await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.undoLastAction(c.updateCricketDisplay);});assert.equal((await state(p)).players[0].score,0);
  await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.redoLastAction(c.updateCricketDisplay);});assert.equal((await state(p)).players[0].score,9);
  await p.reload();await p.click('#resumeGameBtn');s=await state(p);assert.equal(s.type,'brisket');assert.equal(s.players[0].score,9);assert.deepEqual(s.cricketTargets,[...BRISKET_TARGETS,'Bull']);
  await p.evaluate(async()=>{(await import('./js/cricket.js')).hitTarget('5',2);});await p.reload();await p.click('#resumeGameBtn');assert.equal((await state(p)).pendingDarts[0].target,'5');await p.click('#enterBtn');assert.equal((await state(p)).players[1].cricketData['5'].marks,2);
 });
 await run('closed opponents cannot score; singles/doubles and Bull retain Cricket values',async p=>{
  await p.click('#startGameBtn');await turn(p,'6',3);await turn(p,'6',3);await turn(p,'6',3);assert.equal((await state(p)).players[0].score,0);await turn(p,'MISS');await turn(p,'1',1);await turn(p,'MISS');await turn(p,'1',2);assert.equal((await state(p)).players[0].cricketData['1'].marks,3);await turn(p,'MISS');await turn(p,'Bull',2);await turn(p,'MISS');await turn(p,'Bull',2);assert.equal((await state(p)).players[0].score,25);
 });
 await run('victory needs closure and tied/highest points; winning action can be undone',async p=>{
  await p.click('#startGameBtn');await p.evaluate(async()=>{const {game:g}=await import('./js/state.js');for(const t of g.cricketTargets){g.players[0].cricketData[t].marks=3;g.players[0].cricketData[t].closed=true;}g.players[0].cricketData['4'].marks=2;g.players[0].cricketData['4'].closed=false;g.players[1].score=4;});await turn(p,'4',1);assert(!(await p.locator('#winnerModal').isVisible()));await turn(p,'MISS');await turn(p,'4',1);assert(await p.locator('#winnerModal').isVisible());assert.equal((await state(p)).players[0].score,4);
  await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.undoLastAction(c.updateCricketDisplay);});assert.equal((await state(p)).players[0].score,0);
 });
 await run('descending display preserves range keys, existing saves and real button scoring',async p=>{
  for(const start of [1,7,15]) {
   await p.goto('http://127.0.0.1:8765/'+build);await p.selectOption('#gameType','brisket');await p.selectOption('#brisketStart',String(start));
   if(start===15)await p.uncheck('#brisketBulls');
   await p.click('#startGameBtn');
   const storedTargets=(await state(p)).cricketTargets;
   const expected=[...storedTargets.filter(t=>t!=='Bull')].reverse().concat(storedTargets.includes('Bull')?['Bull']:[]);
   const displayed=()=>p.locator('.cricket-num-btn').evaluateAll(es=>es.map(e=>e.dataset.target));
   assert.deepEqual(await displayed(),expected);
   const highest=String(start+5);
   await p.locator('[data-target="'+highest+'"][data-multiplier="3"]').click();await p.click('#enterBtn');
   let s=await state(p);assert.equal(s.players[0].cricketData[highest].marks,3);assert.equal(s.players[0].cricketData[String(start)].marks,0);
   assert.deepEqual(s.cricketTargets,storedTargets);
   const saved=JSON.stringify(s.players);
   await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.undoLastAction(c.updateCricketDisplay);});assert.equal((await state(p)).players[0].cricketData[highest].marks,0);
   await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.redoLastAction(c.updateCricketDisplay);});assert.equal((await state(p)).players[0].cricketData[highest].marks,3);
   await p.reload();await p.click('#resumeGameBtn');assert.deepEqual(await displayed(),expected);assert.equal(JSON.stringify((await state(p)).players),saved);
   await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.game.currentPlayer=1;s.game.players[0].lastTurnMarks={MISS:1};c.updateCricketDisplay();});
   assert.equal(await p.locator('.cricket-row:first-child .prev-turn-indicator').first().innerText(),'MISS');
  }
 });
 await run('tattoo closure history follows start of turn, undo/reclose and persisted variants',async p=>{
  await p.click('#startGameBtn');
  for(const before of [0,1,2]) {
   await p.evaluate(async before=>{
    const s=await import('./js/state.js'),c=await import('./js/cricket.js');
    s.game.currentPlayer=0;s.game.pendingDarts=[];
    const m=s.game.players[0].cricketData['1'];m.marks=before;m.closed=false;m.closedInOneTurn=false;m.marksBeforeClose=0;
    for(let n=before;n<3;n++)c.hitTarget('1',1);
    c.cricketConfirm();
   },before);
   let m=(await state(p)).players[0].cricketData['1'];assert.equal(m.marksBeforeClose,before);assert.equal(m.closedInOneTurn,before===0);
   const selector='.cricket-row:has([data-target="1"]) .cricket-cell:first-child .brisket-closed';
   assert.equal(await p.locator(selector).getAttribute('data-closure-arrows'),String(before));
   await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.undoLastAction(c.updateCricketDisplay);});
   assert.equal((await state(p)).players[0].cricketData['1'].marks,before);assert.equal(await p.locator(selector).count(),0);
   await p.evaluate(async()=>{const s=await import('./js/state.js'),c=await import('./js/cricket.js');s.redoLastAction(c.updateCricketDisplay);});
   assert.equal(await p.locator(selector).getAttribute('data-closure-arrows'),String(before));
   await p.reload();await p.click('#resumeGameBtn');assert.equal(await p.locator(selector).getAttribute('data-closure-arrows'),String(before));
  }
 });
 await run('points-off closure race, no credits leaking into ordinary Cricket',async p=>{
  await p.uncheck('#cricketPoints');await p.click('#startGameBtn');await p.evaluate(async()=>{const {game:g}=await import('./js/state.js');for(const t of g.cricketTargets){g.players[0].cricketData[t].marks=3;g.players[0].cricketData[t].closed=true;}g.players[0].cricketData['2'].marks=2;g.players[0].cricketData['2'].closed=false;g.players[1].score=999;});await turn(p,'2',1);assert(await p.locator('#winnerModal').isVisible());
  await p.goto('http://127.0.0.1:8765/'+build);await p.selectOption('#gameType','cricket');assert(!(await p.locator('#brisketSetupCredit').isVisible()));await p.click('#startGameBtn');assert(!(await p.locator('#brisketGameCredit').isVisible()));assert.equal(await p.locator('.brisket-dragon').count(),0);assert.deepEqual((await state(p)).cricketTargets,['20','19','18','17','16','15','Bull']);
 });
 console.log('PASS '+passed+' rendered Brisket groups; confirmed six-number ranges and optional Bull');
}finally{await b.close();}
