"""Full real-scorer to real history UI checks; only Firebase SDK is mocked."""
import asyncio, functools, threading, json, os
from http.server import ThreadingHTTPServer
import scoring_bridge_test as bridge
from platform_test import APP, AUTH
from local_tournament_flow_test import state, points
from playwright.async_api import async_playwright
from pathlib import Path
OUT=Path(os.environ.get('BLAKEOUT_HISTORY_EVIDENCE', '/tmp/blakeout-casual-history'))

async def play(page,kind):
    for visit in range(40):
        g=await state(page)
        session=g.get('recording') or g.get('tournament')
        if session['legComplete']:return
        current=g['currentPlayer']
        if kind=='501':
            await points(page,min(180,g['players'][current]['score']) if current==0 else 0)
        elif current!=0:
            await page.click('#missBtn')
        else:
            for dart in range(3):
                g=await state(page)
                pending=g['pendingDarts']
                target=None;needed=0
                for t in g['cricketTargets']:
                    data=g['players'][0]['cricketData'][t]
                    marks=data['marks']+sum(d['multiplier'] for d in pending if d['target']==t)
                    if marks<data['maxMarks']:target=t;needed=data['maxMarks']-marks;break
                if target is None:break
                mult=min(2 if target=='Bull' else 3,needed)
                await page.locator(f'[data-target="{target}"][data-multiplier="{mult}"]').click()
            await page.click('#enterBtn')
    raise AssertionError('Game did not complete')

async def run():
    OUT.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(bridge.QuietHandler,directory=str(bridge.ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    evidence=[]
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            for kind, links in [('501',['owner','']),('cricket',['owner',''])]:
                context=await browser.new_context(service_workers='block',viewport={'width':1200,'height':1000})
                async def route(r):
                    url=r.request.url
                    sdk={'firebase-app.js':APP,'firebase-auth.js':AUTH.replace('verified_owner','owner'),'firebase-firestore.js':bridge.STORE}
                    if url.startswith('https://www.gstatic.com/firebasejs/10.13.2/'):
                        body=sdk.get(url.rsplit('/',1)[-1])
                        if body:await r.fulfill(content_type='text/javascript',body=body)
                        else:await r.abort()
                    elif url.startswith(base+'/'):await r.continue_()
                    else:await r.abort()
                await context.route('**/*',route)
                page=await context.new_page();page.on('dialog',lambda d:d.accept())
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                # Actual release flags: accounts on, cloud brackets off. No feature override.
                await bridge.casual_fixture(page,base,kind,links=links)
                await play(page,kind)
                g=await state(page)
                assert g['tournament'] is None and g['recording']['legComplete']
                assert g['recording']['status']!='saved'
                result_id=g['recording']['resultId']
                if kind=='cricket':
                    await page.evaluate("localStorage.__offline='1'")
                    await page.click('#casualSaveResult')
                    await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Not saved')")
                    pending=await state(page)
                    assert pending['recording']['status']=='pending'
                    assert pending['scoringRecords']['legs']==g['scoringRecords']['legs']
                    assert await page.evaluate("Object.keys(localStorage).some(k=>k.startsWith('blakeout_dev_casual_') && k!=='blakeout_dev_casual_history')")
                    await page.evaluate("localStorage.__offline='0'")
                await page.click('#casualSaveResult')
                await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Casual result saved')")
                saved=await page.evaluate("JSON.parse(localStorage.__documents)")
                raw=saved['blakeoutDevCasualResults/'+result_id]
                assert raw['participantIds']==[uid for uid in links if uid]
                assert all(isinstance(raw[k],str) for k in ['records','perPlayer','legScores'])
                counters=json.loads(raw['perPlayer'])
                winner=next(p for p in counters if p['playerId']=='owner')
                loser=next((p for p in counters if p['playerId']=='u2'),None)
                assert winner['darts']==(9 if kind=='501' else 8),winner
                if links[1]:
                    assert loser['darts']==6 and loser['points']==0 and loser['marks']==0,loser
                else:
                    assert loser is None and len(counters)==1
                    assert any(t['playerId'] is None for leg in json.loads(raw['records'])['legs'] for t in leg['turns'])
                assert winner['points']==(501 if kind=='501' else 0),winner
                assert winner['marks']==(0 if kind=='501' else 21),winner
                for uid in filter(None,links):
                    assert 'blakeoutDevCasualReceipts/'+result_id+'$'+uid in saved
                assert len([k for k in saved if k.startswith('blakeoutDevCasualReceipts/')])==len(list(filter(None,links)))
                # Same result cannot be saved twice.
                await page.evaluate("import('/dev/js/casual-recording.js').then(m=>m.saveCasualResult())")
                assert len([k for k in await page.evaluate('Object.keys(JSON.parse(localStorage.__documents))') if k.startswith('blakeoutDevCasualResults/')])==1
                summaries={}
                for uid in filter(None,links):
                    await page.evaluate("uid=>changeTestUser({uid,emailVerified:true,isAnonymous:false})",uid)
                    await page.goto(base+'/dev/accounts/')
                    await page.wait_for_function("document.querySelector('#records').textContent.includes('Casual')")
                    summary=await page.locator('#lifetimeSummary').inner_text()
                    expected=('55.67 PPD' if kind=='501' else '7.88 MPR') if uid=='owner' else ('0.00 PPD' if kind=='501' else '0.00 MPR')
                    assert expected in summary and '1 matches' in summary,(uid,summary)
                    records=await page.evaluate("import('/dev/js/platform.js').then(m=>m.listMyResults())")
                    assert len(records)==1 and records[0]['source']=='casual' and records[0]['id']==result_id
                    summaries[uid]=summary
                    await page.screenshot(path=str(OUT/f'{kind}-{uid}-guest{not bool(links[1])}-history.png'),full_page=True)
                # The saved-game index is local bookkeeping, not the Accounts cloud query.
                history=await page.evaluate("JSON.parse(localStorage.blakeout_dev_casual_history)")
                assert len(history)==1 and history[0]['resultId']==result_id
                await page.evaluate("changeTestUser({uid:'owner',emailVerified:true,isAnonymous:false})")
                await page.goto(base+'/dev/')
                await page.locator('#casualLocalHistory summary').click()
                local_history=await page.locator('#casualRecoveryList').inner_text()
                assert kind in local_history.lower() and 'saved' in local_history.lower(),local_history
                # Recording is opt-in, even for previously linked identical names.
                assert not await page.locator('#recordCasualStats').is_checked()
                await page.click('#startGameBtn')
                await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
                ordinary=await state(page)
                assert ordinary['recording'] is None and ordinary['tournament'] is None
                assert not errors,errors
                row={'game':kind,'links':links,'mode':'casual, real release flags','resultId':result_id,'counters':counters,'accountSummaries':summaries,'localHistory':local_history,'wireJSONFields':['records','perPlayer','legScores'],'sdk':'mocked, external requests blocked'}
                evidence.append(row)
                print('PASS',json.dumps(row),flush=True)
                await context.close()
            await browser.close()
    finally:server.shutdown()
    (OUT/'casual-history-results.json').write_text(json.dumps(evidence,indent=2)+'\n')
if __name__=='__main__': asyncio.run(run())
