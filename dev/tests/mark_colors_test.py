"""Local synthetic rendered checks for independent committed Cricket ink."""
import asyncio,functools,threading,os
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright
BUILD='' if os.environ.get('BLAKEOUT_BUILD')=='production' else 'dev/'
ROOT=Path(__file__).resolve().parents[2]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
 threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width,height in [(320,568),(412,915),(768,1024),(844,390)]:
   ctx=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block')
   await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
   p=await ctx.new_page();p.set_default_timeout(10000);await p.goto(base+'/'+BUILD)
   await p.click('#settingsBtnSetup');await p.select_option('#cricketMarkColor','white');await p.click('#settingsCloseBtn')
   await p.select_option('#gameType','cricket');await p.click('#startGameBtn')
   await p.evaluate('''async()=>{const {game:g}=await import('./js/state.js');for(const [t,n] of [['20',1],['19',2],['18',3]]){g.players[0].cricketData[t].marks=n;g.players[0].cricketData[t].closed=n===3;}g.pendingDarts=[{target:'17',multiplier:1}];(await import('./js/cricket.js')).updateCricketDisplay();}''')
   before=await p.evaluate("import('./js/state.js').then(s=>JSON.stringify(s.game))")
   for skin in ['modern','classic','dc','dot-better']:
    for theme in ['blue','red','arctic']:
     await p.evaluate('''async([skin,theme])=>{(await import('./js/score-appearance.js')).applyScoreAppearance(skin);(await import('./js/theme.js')).applyTheme(theme);}''',[skin,theme])
     colors=await p.locator('#cricketGrid .mark:not(.pending) svg g[color]').evaluate_all("es=>es.map(e=>getComputedStyle(e).color)")
     assert colors and all(c=='rgb(255, 255, 255)' for c in colors),(skin,theme,colors)
     assert await p.locator('#cricketGrid .mark.pending svg g[color]').first.evaluate("e=>getComputedStyle(e).color!=='rgb(255, 255, 255)'")
   assert await p.evaluate("import('./js/state.js').then(s=>JSON.stringify(s.game))")==before
   await p.evaluate("import('./js/settings.js').then(s=>s.openSettingsModal())")
   await p.select_option('#cricketMarkColor','theme')
   assert await p.evaluate("document.documentElement.style.getPropertyValue('--cricket-mark-color')")==''
   await p.select_option('#cricketMarkColor','white');await p.click('#settingsCloseBtn')
   await p.evaluate("import('./js/state.js').then(s=>s.saveActiveGame())")
   await p.reload();await p.click('#resumeGameBtn')
   assert await p.evaluate("document.documentElement.style.getPropertyValue('--cricket-mark-color')")=='#ffffff'
   if width==412:
    await p.evaluate("import('./js/theme.js').then(t=>t.applyTheme('blue'))")
    Path('/workspace/scratch/mark-colors').mkdir(parents=True,exist_ok=True)
    await p.screenshot(path='/workspace/scratch/mark-colors/white-portrait.png')
   await p.evaluate("Promise.all([import('./js/state.js'),import('./js/cricket.js')]).then(([s,c])=>{s.game.pendingDarts=[];c.hitTarget('17',1);})")
   await p.click('#enterBtn')
   assert await p.evaluate("import('./js/state.js').then(s=>s.game.players[0].cricketData['17'].marks)")==1
   await p.evaluate("Promise.all([import('./js/state.js'),import('./js/cricket.js')]).then(([s,c])=>s.undoLastAction(c.updateCricketDisplay))")
   assert await p.evaluate("import('./js/state.js').then(s=>s.game.players[0].cricketData['17'].marks)")==0
   await p.evaluate("Promise.all([import('./js/state.js'),import('./js/cricket.js')]).then(([s,c])=>s.redoLastAction(c.updateCricketDisplay))")
   assert await p.evaluate("import('./js/state.js').then(s=>s.game.players[0].cricketData['17'].marks)")==1
   await p.goto(base+'/'+BUILD);await p.select_option('#gameType','teamcricket');await p.click('#startGameBtn')
   for name in ['Alpha','Bravo','Charlie','Delta']:
    await p.fill('#teamAddName',name);await p.click('#teamAddBtn')
   for name,zone in [('Alpha',0),('Bravo',0),('Charlie',1),('Delta',1)]:
    await p.locator('.team-chip',has_text=name).click();await p.click(f'#teamZone{zone}Label')
   await p.click('#teamStartMatchBtn')
   await p.evaluate('''async()=>{const {game:g}=await import('./js/state.js');g.teamCricket.memberMarks[0][0]['20']=1;g.teamCricket.memberMarks[0][1]['19']=2;g.teamCricket.memberMarks[1][0]['18']=3;(await import('./js/teamcricket.js')).updateTeamCricketDisplay();}''')
   colors=await p.locator('#teamCricketGrid .mark svg g[color]').evaluate_all("es=>es.map(e=>getComputedStyle(e).color)")
   assert colors and all(c=='rgb(255, 255, 255)' for c in colors),colors
   print('PASS',width,height,'12 theme/skin combinations, partial/closed/pending, reset, persistence, Team Cricket',flush=True)
   await ctx.close()
  await browser.close()
 server.shutdown()
asyncio.run(main())
