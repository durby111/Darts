"""Run against server.py on 8874; isolated browser, synthetic identities, no external requests."""
from pathlib import Path
from playwright.sync_api import sync_playwright
base='http://127.0.0.1:8874'
out=Path('/tmp/blakeout-qr-evidence');out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/opt/google/chrome/chrome',headless=True,args=['--no-sandbox','--disable-background-networking'])
    board=browser.new_context(viewport={'width':1200,'height':1000})
    phone=browser.new_context(viewport={'width':390,'height':844})
    errors=[]
    for c in (board,phone):
        c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base+'/') else r.abort())
        c.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
    b=board.new_page();b.goto(base);b.get_by_text('Start local demo',exact=True).click()
    b.get_by_text('Pair phone',exact=True).first.click()
    b.locator('.qr svg').wait_for()
    code=b.locator('.code').inner_text();link=b.get_by_text('Open simulated phone').get_attribute('href')
    b.screenshot(path=str(out/'board.png'),full_page=True)
    f=phone.new_page();f.goto(link);f.locator('#account').select_option('alex');f.get_by_text('Continue with Google (demo)',exact=True).click()
    f.locator('#code').fill('wrong');f.get_by_text('Confirm Alex for seat 1',exact=True).click();f.get_by_text('Code does not match the board.',exact=True).wait_for()
    f.locator('#code').fill(code);f.screenshot(path=str(out/'phone-confirm.png'),full_page=True)
    f.get_by_text('Confirm Alex for seat 1',exact=True).click();f.get_by_text('You’re in.',exact=True).wait_for()
    b.get_by_text('Alex · verified demo player',exact=True).wait_for()
    b.reload();b.get_by_text('Alex · verified demo player',exact=True).wait_for()
    f.reload();f.get_by_text('You’re in.',exact=True).wait_for()
    b.get_by_text('Remove player',exact=True).click();f.get_by_text('Seat access removed',exact=True).wait_for()
    b.get_by_text('Pair phone',exact=True).first.click()
    link=b.get_by_text('Open simulated phone').get_attribute('href')
    f.goto(link);f.locator('#account').wait_for();assert f.locator('#account').input_value()==''
    f.locator('#account').select_option('sam');f.get_by_text('Continue with Email (demo)',exact=True).click()
    f.get_by_text('Use a different account',exact=True).click();f.locator('#account').select_option('alex');f.get_by_text('Continue with Email (demo)',exact=True).click()
    f.locator('#code').fill(b.locator('.code').inner_text());f.get_by_text('Confirm Alex for seat 1',exact=True).click();f.get_by_text('You’re in.',exact=True).wait_for()
    f.get_by_text('Leave this game',exact=True).click();f.get_by_text('Seat access removed',exact=True).wait_for()
    b.get_by_text('End game & remove access',exact=True).click();b.get_by_text('Game ended · all seat access removed',exact=True).wait_for()
    assert not errors,errors
    browser.close()
print('PASS: rendered QR, wrong code, explicit account switch, claim, separate phone/board contexts, both reloads, remove, leave, end; no JS errors.')
