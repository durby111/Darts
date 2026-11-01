// Isolated rendered DEV regression checks; no real accounts, backend or user profile.
// Node equivalent of dev_test.py setup_throw_order and relevant BotBlake review flows.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.BLAKEOUT_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.BLAKEOUT_QA_OUTPUT;
if(output) await mkdir(output,{recursive:true});
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };
const server = createServer(async (req,res) => {
    try {
        let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname));
        if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
const names = p => p.locator('[id^=player][id$=Group] input').evaluateAll(els => els.map(e=>e.value));
const state = p => p.evaluate(async () => JSON.parse(JSON.stringify((await import('./js/state.js')).game)));
const score = async (p,n=60) => { await p.waitForTimeout(750); for(const digit of String(n))await p.locator(`[data-digit="${digit}"]`).click();await p.click('#x01EnterBtn'); };
const start = async (p,mode='501',skill='expert') => {await p.goto(base+'/dev/');await p.selectOption('#gameType',mode);await p.selectOption('#player2Skill',skill);await p.click('#startGameBtn');await p.locator('#gameScreen').waitFor({state:'visible'});};
async function add(p,name,zone,skill) {if(skill){await p.selectOption('#teamBotSkill',skill);await p.click('#teamAddBotBtn');}else{await p.fill('#teamAddName',name);await p.click('#teamAddBtn');}await p.locator('#teamTray [data-chip-id]').last().click();await p.locator(`#teamZone${zone}`).click({position:{x:10,y:10}});}
async function run(name, fn, options={}) {
    if(process.argv.length>2 && !process.argv.slice(2).some(filter=>name.includes(filter))) return;
    const ctx = await browser.newContext({ serviceWorkers:'block', viewport:{width:900,height:1600}, ...options });
    await ctx.route('**/*', route => route.request().url().startsWith(base+'/') ? route.continue() : route.abort());
    const p = await ctx.newPage(), errors=[];
    p.on('pageerror', error => errors.push(error.message));
    p.on('dialog', d => d.accept());
    try { await p.goto(base+'/dev/'); await p.locator('#player1').waitFor(); await fn(p); assert.deepEqual(errors,[]); results.push({name,pass:true}); console.log('PASS',name); }
    catch(error) { results.push({name,pass:false,error:String(error)}); console.error('FAIL',name,String(error)); }
    finally { await ctx.close(); }
}
try {
    browser = await chromium.launch({ headless:true, executablePath: process.env.BLAKEOUT_CHROMIUM || undefined });
    await run('responsive controls, drag/arrows/randomize, Start and Play Again', async p => {
        await p.selectOption('#numPlayers','4');
        for(const [i,n] of ['Alpha','Bravo','Charlie','Delta'].entries()) await p.fill(`#player${i+1}`,n);
        for(const width of [744,390,1280]) {
            await p.setViewportSize({width,height:1133});
            const rows=await p.locator('.player-row:not(.hidden)').evaluateAll(rows=>rows.map(r=>{
                const b=r.getBoundingClientRect(), i=r.querySelector('input').getBoundingClientRect();
                return {left:b.left,top:b.top,bottom:b.bottom,right:b.right,inputLeft:i.left,inputRight:i.right,inputWidth:i.width,
                    targets:[...r.querySelectorAll('button')].map(x=>{const b=x.getBoundingClientRect();return [b.width,b.height];})};
            }));
            for(let i=0;i<rows.length;i++) { const r=rows[i]; assert(r.inputLeft>=r.left && r.inputRight<=r.right); assert(r.inputWidth>=160,JSON.stringify({width,r})); assert(r.targets.every(([w,h])=>w>=44&&h>=44),JSON.stringify(r)); if(i)assert(r.top>=rows[i-1].bottom); }
            assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            if(output) { await mkdir(output,{recursive:true}); await p.screenshot({path:path.join(output,`setup-${width}.png`),fullPage:true}); }
        }
        await p.setViewportSize({width:900,height:1600});
        await p.locator('[data-player-drag-index="0"]').scrollIntoViewIfNeeded();
        const from=await p.locator('[data-player-drag-index="0"]').boundingBox(),to=await p.locator('#player3Group').boundingBox();
        await p.mouse.move(from.x+from.width/2,from.y+from.height/2);await p.mouse.down();await p.mouse.move(to.x+to.width/2,to.y+to.height*.25,{steps:12});await p.mouse.up();
        assert.deepEqual(await names(p),['Bravo','Charlie','Alpha','Delta']);
        await p.click('#player3Group [data-player-order-action="up"]');assert.deepEqual(await names(p),['Bravo','Alpha','Charlie','Delta']);
        for(const [i,n] of ['Alpha','Bravo','Charlie','Delta'].entries()) await p.fill(`#player${i+1}`,n);
        await p.evaluate(()=>{window.savedRandom=Math.random;Math.random=()=>0;});await p.click('#randomizePlayersBtn');await p.evaluate(()=>{Math.random=window.savedRandom;delete window.savedRandom;});
        const expected=['Bravo','Charlie','Delta','Alpha'];assert.deepEqual(await names(p),expected);
        await p.selectOption('#gameType','501');await p.click('#startGameBtn');assert.deepEqual((await state(p)).players.map(x=>x.name),expected);
        await p.evaluate(async()=>{(await import('./js/setup.js')).playAgain();});assert.deepEqual((await state(p)).players.map(x=>x.name),expected);
    });
    await run('keyboard suggestions, Escape, clear, no preset/roster suggestions', async p => {
        await p.evaluate(()=>{localStorage.setItem('blakeout_dev_recent_player_names',JSON.stringify(['Alpha','Alice']));localStorage.setItem('blakeout_configs',JSON.stringify({lastConfig:{player1:'Preset only'},savedConfigs:[]}));});
        await p.locator('#player1').focus(); await p.fill('#player1','Al');
        assert.deepEqual(await p.locator('#player1Suggestions button').allTextContents(),['Alpha','Alice']);
        // Follow actual Tab order through existing arrows/skill until chips.
        for(let i=0;i<8 && !(await p.locator('#player1Suggestions button').first().evaluate(e=>e===document.activeElement));i++)await p.keyboard.press('Tab');
        assert(await p.locator('#player1Suggestions button').first().evaluate(e=>e===document.activeElement));
        await p.keyboard.press('Enter');assert.equal(await p.inputValue('#player1'),'Alpha');assert(await p.locator('#player2').evaluate(e=>e===document.activeElement));
        await p.keyboard.press('Escape');assert.equal(await p.locator('#player2Suggestions').isVisible(),false);
        await p.click('#clearRecentNamesBtn');assert.match(await p.locator('#clearRecentNamesStatus').textContent(),/cleared/);
        await p.locator('#player1').focus();assert.equal(await p.locator('#player1Suggestions').isVisible(),false);
        assert(await p.evaluate(()=>localStorage.getItem('blakeout_configs')!==null));
    });
    await run('emulated touch tap order, same-handle cancel and chips', async p => {
        await p.fill('#player1','Alpha');await p.fill('#player2','Bravo');await p.selectOption('#player2Skill','hard');
        await p.locator('[data-player-drag-index="1"]').tap();await p.locator('[data-player-drag-index="0"]').tap();
        assert.deepEqual((await names(p)).slice(0,2),['Bravo','Alpha']);assert.equal(await p.inputValue('#player1Skill'),'hard');
        await p.locator('[data-player-drag-index="0"]').tap();await p.locator('[data-player-drag-index="0"]').tap();assert.equal(await p.locator('.player-row--picked').count(),0);
        await p.evaluate(()=>localStorage.setItem('blakeout_dev_recent_player_names','["Alicia"]'));
        await p.locator('#player2').tap();await p.fill('#player2','Ali');await p.locator('#player2Suggestions button').tap();assert.equal(await p.inputValue('#player2'),'Alicia');
    },{hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
    await run('BotBlake first-player adjustment, saved config and reorder preserve skills', async p => {
        await p.selectOption('#gameType','501');await p.selectOption('#player1Skill','auto');await p.selectOption('#numPlayers','3');await p.selectOption('#player3Skill','hard');await p.click('#startGameBtn');
        const s=await state(p);assert.deepEqual(s.players.map(x=>x.bot?.skill??null),[null,'auto','hard']);
        await p.reload();await p.locator('#loadLastBtn').evaluate(el=>el.click());
        assert.deepEqual(await p.locator('[id^=player][id$=Skill]').evaluateAll(es=>es.slice(0,3).map(e=>e.value)),['auto','off','hard']);
        await p.click('[data-player-order-action="down"][data-player-index="0"]');
        assert.deepEqual(await p.locator('[id^=player][id$=Skill]').evaluateAll(es=>es.slice(0,3).map(e=>e.value)),['off','auto','hard']);
    });
    await run('BotBlake settings pause', async p=>{
        await start(p);await score(p);await p.click('#menuBtn');await p.click('#gameMenuVisualBtn');assert(await p.locator('#settingsModal').isVisible());
        const before=await state(p);await p.waitForTimeout(1600);assert.deepEqual((await state(p)).players,before.players);
    });
    await run('BotBlake team-builder typing with pending old turn', async p=>{
        await start(p);await score(p);await p.click('#menuBtn');await p.click('#gameMenuSettingsBtn');await p.check('#teamMode');await p.click('#startGameBtn');
        await p.locator('#teamAddName').pressSequentially('New Human');assert.equal(await p.inputValue('#teamAddName'),'New Human');
        const before=await state(p);await p.waitForTimeout(1600);assert.deepEqual((await state(p)).players,before.players);
    });
    await run('BotBlake actual turns across ten supported modes', async p=>{
        for(const mode of ['301','501','701','801','901','1101','1501','cricket','spanish','cutthroat']) {
            await start(p,mode);const cricket=['cricket','spanish','cutthroat'].includes(mode);
            if(cricket){await p.locator('[data-target="20"][data-multiplier="3"]').click();await p.click('#enterBtn');}else await score(p);
            await p.waitForTimeout(1500);const s=await state(p);assert.equal(s.currentPlayer,0,mode);assert.equal(cricket?s.players[1].throws:s.players[1].history.length,1,mode);
        }
    });
    await run('BotBlake Cutthroat leader targeting', async p=>{
        await p.selectOption('#gameType','cutthroat');await p.selectOption('#numPlayers','3');await p.selectOption('#player1Skill','expert');await p.click('#startGameBtn');
        await p.evaluate(async()=>{const {game}=await import('./js/state.js');Math.random=()=>0;game.players.forEach((p,i)=>p.score=[100,50,150][i]);for(const t of ['20','19'])Object.assign(game.players[0].cricketData[t],{marks:3,closed:true});Object.assign(game.players[1].cricketData['20'],{marks:3,closed:true});});
        await p.waitForTimeout(1500);const s=await state(p);assert.deepEqual(s.players.map(p=>p.score),[100,107,207]);assert(['18','17'].every(t=>s.players[0].cricketData[t].closed));assert.equal(s.currentPlayer,1);
    });
    await run('BotBlake team average, undo/redo, rotation and reload', async p=>{
        await p.selectOption('#gameType','501');await p.check('#teamMode');await p.click('#startGameBtn');
        for(const zone of [0,1]){await add(p,`Human${zone}`,zone);await add(p,'',zone,'auto');}
        await p.click('#teamStartMatchBtn');await score(p);assert.deepEqual((await state(p)).teams[0].members[0].practice,{turns:1,points:60,marks:0});
        await p.click('#undoBtnX01');assert(!(await state(p)).teams[0].members[0].practice);await p.waitForTimeout(550);await p.click('#redoBtnX01');assert.equal((await state(p)).teams[0].members[0].practice.points,60);
        await score(p,0);const strength=await p.evaluate(async()=>{const {game}=await import('./js/state.js');const {activeBot,strength}=await import('./js/botblake-engine.js');return strength(game,activeBot(game));});assert(Math.abs(strength-(30-4.5)/133.5)<.00001);
        await p.click('#menuBtn');const saved=(await state(p)).teams;await p.reload();await p.click('#resumeGameBtn');await p.waitForTimeout(1500);assert.deepEqual((await state(p)).teams,saved);assert(await p.locator('#botStatus button').isVisible());
    });
    await run('BotBlake keyboard navigation does not score for bot', async p=>{
        await start(p);await score(p);await p.waitForTimeout(1500);await p.click('#undoBtnX01');const quick=p.locator('[data-quick="26"]');await quick.focus();await quick.press('Tab');assert(!(await quick.evaluate(e=>document.activeElement===e)));
        const before=await state(p);await quick.focus();await quick.press('Enter');assert.deepEqual((await state(p)).players,before.players);
    });
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
if(output)await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
assert(results.every(x=>x.pass),JSON.stringify(results));
