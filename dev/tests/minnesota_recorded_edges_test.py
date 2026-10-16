#!/usr/bin/env python3
"""Rendered recorded-mode boundary tests with explicitly seeded near-win boards.
Tournament setup uses the local adapter. Dart entry, commit, undo and save use UI.
"""
import asyncio,functools,threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from minnesota_cutthroat_test import ROOT,OUT,Quiet,state,hit,enter,preview
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=await b.new_context(service_workers='block')
   await ctx.tracing.start(screenshots=True,snapshots=True,sources=True)
   page=await ctx.new_page();alerts=[]
   page.on('dialog',lambda d:(alerts.append(d.message),asyncio.create_task(d.accept())))
   for case in ['higher','tie','special']:
    await page.goto(base+'/dev/local/brackets/')
    await page.evaluate('''async id=>{
     const p=await import('/dev/local/platform.js'),e=await import('/dev/js/brackets/engine.js');
     let t=e.createTournament({id,ownerId:'device-organizer',title:id,date:'2026-10-16',gameType:'minnesota',bestOf:1,minnesotaCutthroat:true});
     t=e.saveRoster(t,Array.from({length:4},(_,i)=>({id:'r'+i,playerId:null,name:'Player '+i,tag:String(Math.floor(i/2)),paid:true,checkedIn:true,standby:false})));
     await p.createTournamentDocument(t);await p.updateTournament(id,t.revision,x=>e.startTournament(x));
    }''',case)
    await page.goto(base+'/dev/local/brackets/?id='+case)
    await page.locator('.match-action').first.click();await page.click('#launchScorer');await page.wait_for_selector('#cricketMain',state='visible')
    if case=='special':
     await page.evaluate('''async()=>{
      const {game,saveActiveGame}=await import('./js/state.js');
      Object.assign(game.players[0].cricketData.Triples,{marks:3,closed:true});saveActiveGame();
      (await import('./js/cricket.js')).updateCricketDisplay();
     }''')
     await hit(page,'Triples');await page.click('[data-keypad="6"]')
     await page.reload();await page.wait_for_selector('#scoreKeypadModal',state='visible')
     assert await page.locator('#keypadDisplay').inner_text()=='6'
     assert (await state(page))['minnesotaCutthroat']
     await page.click('[data-keypad="0"]');await page.click('[data-keypad="OK"]');await preview(page,[0,60])
     await page.click('#tournamentMissDart');await page.click('#tournamentMissDart');await enter(page)
     message=await page.evaluate('''async()=>{
      const p=await import('./local/platform.js'),e=await import('./js/brackets/engine.js');
      const t=await p.getTournament('special');
      try {await p.updateTournament(t.id,t.revision,x=>e.setFormat(x,'matches','W1.1',{gameType:'minnesota',bestOf:1,minnesotaCutthroat:false}));}
      catch(error){return error.message;}
      return 'unexpected success';
     }''')
     assert 'already started' in message,message
     turn=(await state(page))['scoringRecords']['legs'][0]['turns'][-1]
     assert (turn['points'],turn['marks'],turn['darts'])==(60,1,3),turn
     print('PASS recorded special penalty: keypad interrupted/reloaded, opponent preview, one scoring mark + actual darts',flush=True)
     continue
    await page.evaluate('''async higher=>{
     const {game,saveActiveGame}=await import('./js/state.js');
     game.players[0].score=higher?50:0;
     for(const t of game.cricketTargets)Object.assign(game.players[0].cricketData[t],{marks:3,closed:true});
     Object.assign(game.players[0].cricketData.Bull,{marks:2,closed:false});saveActiveGame();
     (await import('./js/cricket.js')).updateCricketDisplay();
    }''',case=='higher')
    await hit(page,'Bull')
    if case=='higher':
     await enter(page)
     assert not (await state(page))['tournament']['legComplete']
     assert any('every dart' in a for a in alerts)
     assert (await state(page))['players'][0]['cricketData']['Bull']['marks']==2
     await hit(page,'20',3)
    await hit(page,'19',3);await enter(page)
    g=await state(page);assert g['tournament']['legComplete']
    turn=g['scoringRecords']['legs'][0]['turns'][-1]
    assert (turn['points'],turn['marks'],turn['darts'])==((60,4,2) if case=='higher' else (0,1,1)),turn
    assert g['players'][1]['score']==(60 if case=='higher' else 0),'Darts after win must not count'
    await page.click('#winnerCancelBtn');await page.wait_for_timeout(510)
    assert not (await state(page))['scoringRecords']['legs'][0]['turns']
    await enter(page)
    assert len((await state(page))['scoringRecords']['legs'][0]['turns'])==1
    await page.click('#tournamentSaveResult');await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Result saved')")
    print(f'PASS recorded {case}: proper early win, invalid partial visit rollback, exact points/marks/darts, ignored later dart, undo/recommit/save',flush=True)
   await ctx.tracing.stop(path=str(OUT/'recorded-edges-trace.zip'));await b.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
