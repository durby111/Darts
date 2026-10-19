"""Real Chromium gate check; no Firebase enforcement or real-account claim."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page();external=[];errors=[]
  def route(r):
   if not r.request.url.startswith(f'http://127.0.0.1:{server.server_port}/'):external.append(r.request.url);r.abort()
   else:r.continue_()
  page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/dev/history-attribution/dev-ui/')
  page.get_by_text('History integration is not released.',exact=True).wait_for()
  assert external==[],external
  assert errors==[],errors
  assert page.locator('header a').get_attribute('href')=='../../accounts/'
  page.evaluate("""async () => {
    const {mountHistoryView}=await import('/dev/history-attribution/dev-ui/views.mjs');
    window.testCalls=[];
    await mountHistoryView(document.querySelector('main'),{role:'phone',auth:{currentUser:{uid:'synthetic-owner'}},history:{
      consentDetails:async p=>({...p,uid:'synthetic-owner',scope:'named-tournament',eventId:'synthetic-event'}),
      confirm:async p=>testCalls.push(p)
    }},{view:'consent',hash:'#context=t_synthetic-event&registration=r1'});
  }""")
  button=page.get_by_role('button',name='Confirm history attribution')
  assert button.is_disabled()
  page.get_by_role('checkbox').check();button.click()
  page.get_by_role('status').filter(has_text='Attribution confirmed').wait_for()
  assert page.evaluate("testCalls.length===1 && testCalls[0].displayed.contextId==='t_synthetic-event' && testCalls[0].displayedUid==='synthetic-owner'")
  assert external==[] and errors==[]
  page.evaluate("""async () => {
    const {mountHistoryView}=await import('/dev/history-attribution/dev-ui/views.mjs');
    window.claimCalls=[];window.historyConsents=[];
    await mountHistoryView(document.querySelector('main'),{role:'phone',auth:{currentUser:{uid:'synthetic-owner'}},pairing:{inspect:async()=>({game:'demo',seat:'1'}),claim:async p=>claimCalls.push(p)},history:{
      consentDetails:async p=>({...p,uid:'synthetic-owner',scope:'game-seat',gameId:'demo'}),confirm:async p=>historyConsents.push(p)
    }},{view:'claim',hash:'#context=g_demo&registration=r1&seat=1&invitation='+('a'.repeat(64))});
  }""")
  page.get_by_label('Pairing code').fill('123456')
  page.get_by_role('checkbox').check();page.get_by_role('button',name='Confirm seat',exact=True).click()
  page.get_by_role('button',name='Confirm history attribution').wait_for()
  assert page.evaluate('claimCalls.length===1 && historyConsents.length===0')
  assert page.get_by_role('button',name='Confirm history attribution').is_disabled()
  page.get_by_role('checkbox').check();page.get_by_role('button',name='Confirm history attribution').click()
  page.get_by_role('status').filter(has_text='Attribution confirmed').wait_for()
  assert page.evaluate("historyConsents.length===1 && historyConsents[0].seatId==='1'")
  assert external==[] and errors==[]
  print('PASS Chromium: seat claim and history consent are separate explicit confirmations (synthetic transport).')
  print('PASS Chromium: synthetic transport phone view requires checkbox and passes exact displayed scope (not enforcement).')
  print('PASS Chromium: staged DEV route disabled; no external requests; no JavaScript errors; Accounts link retained.')
  browser.close()
finally:server.shutdown();server.server_close()
