#!/usr/bin/env python3
"""DEV bracket UI in Chrome: real page/engine, mocked Firebase storage boundary.

    /home/md/Documents/Darts/.venv/bin/python dev/tests/brackets_ui_test.py
"""
import argparse
import asyncio
import json
from functools import partial
from http.server import ThreadingHTTPServer
import os
import shutil
import tempfile
import threading
import traceback

from playwright.async_api import async_playwright
from bracket_engine_test import Handler, DEV_ROOT
from platform_test import APP, AUTH, STORE


MOCK_PLATFORM = """
import * as engine from '/js/brackets/engine.js';
const copy = value => structuredClone(value);
window.__api = { account: {uid:'owner',emailVerified:true,isAnonymous:false},
    failWrite:false, failRead:false, conflict:false, writes:0, statsWrites:0, calls:[] };
const api = window.__api;
function fixture(count, status='registration', ownerId='owner') {
    let t = engine.createTournament({id:'demo',ownerId,title:'Friday Doubles',date:'2026-09-07',gameType:'chicago'});
    t = engine.saveRoster(t, Array.from({length:count*2},(_,i)=>({
        id:`r${i}`,playerId:i===0?'profile-a':null,name:`Player ${i+1}`,tag:String(Math.floor(i/2)+1),
        checkedIn:true,paid:i%2===0,standby:false,
    })));
    if(status!=='registration') t=engine.startTournament(t);
    if(status==='complete') {
        while(t.status!=='complete') {
            const m=t.matches.find(m=>m.status==='ready');
            t=engine.recordResult(t,m.id,{winnerId:m.teamA,scoreA:2,scoreB:0});
        }
    }
    return {...t,createdAt:1,updatedAt:1};
}
api.docs = {demo:fixture(4)};
api.fixture=fixture;
api.accountChanged=()=>{};
export async function initPlatform(){return {};}
export function getAccount(){return api.account;}
export function subscribeAccount(fn){api.accountChanged=fn;fn(api.account);return ()=>{};}
export function requireVerifiedAccount(){
    if(!api.account?.emailVerified||api.account.isAnonymous)throw Error('Verified account required');
    return api.account;
}
export async function listProfiles(){
    requireVerifiedAccount();
    return [{id:'profile-a',name:'Verified Alice'},{id:'profile-b',name:'Verified Bob'}];
}
function read(){if(api.failRead)throw Error('network unavailable');}
export async function listTournaments(){read();return copy(Object.values(api.docs));}
export async function getTournament(id){
    read();
    const snapshot=copy(api.docs[id]||null);
    if(snapshot&&api.account?.uid!==snapshot.ownerId){
        snapshot.registrations=snapshot.registrations.map(r=>({...r,paid:false,checkedIn:false,standby:false}));
    }
    if(api.holdRead)await new Promise(resolve=>{api.releaseRead=resolve;});
    return snapshot;
}
export async function createTournamentDocument(t){
    requireVerifiedAccount();
    if(api.failWrite)throw Error('permission-denied');
    api.docs[t.id]={...copy(t),createdAt:1,updatedAt:1};
    api.writes++;
    return copy(api.docs[t.id]);
}
export async function updateTournament(id,expectedRevision,updater){
    requireVerifiedAccount();
    api.calls.push({id,expectedRevision});
    if(api.failWrite)throw Error('permission-denied');
    if(api.conflict||api.docs[id].revision!==expectedRevision)throw Error('This tournament changed on another device. Reload before trying again.');
    if(api.docs[id].ownerId!==api.account.uid)throw Error('Only the organizer can change it');
    const current=copy(api.docs[id]);
    const next=updater(copy(current));
    const retried=updater(copy(current));
    if(JSON.stringify(next)!==JSON.stringify(retried))throw Error('Transaction updater changed across retry');
    api.docs[id]={...copy(next),revision:current.revision+1,updatedAt:current.updatedAt+1};
    api.writes++;
    return copy(api.docs[id]);
}
export async function saveMatchResult(){api.statsWrites++;throw Error('Manual UI must not fabricate player statistics');}
"""


async def fresh(browser, base, *, owner=True, status="registration", count=4):
    context = await browser.new_context(viewport={"width": 1024, "height": 900})
    await context.route("**/js/platform.js", lambda route: route.fulfill(
        status=200, content_type="application/javascript", body=MOCK_PLATFORM))
    page = await context.new_page()
    page.on("dialog", lambda dialog: dialog.accept())
    await page.goto(base + "/brackets/")
    await page.wait_for_function("window.__api && document.querySelector('#message').textContent.includes('Cloud connected')")
    await page.evaluate("""({owner,status,count}) => {
        __api.docs.demo=__api.fixture(count,status);
        if(!owner){__api.account=null;__api.accountChanged(null);}
    }""", {"owner": owner, "status": status, "count": count})
    await page.locator(".tournament-link").first.click()
    await page.wait_for_function("!document.querySelector('#tournament').hidden")
    return context, page


async def test_owner_roster(browser, base):
    context, page = await fresh(browser, base)
    try:
        assert await page.locator("#rosterRows tr").count() == 8
        assert await page.locator('#rosterRows [data-field="tag"]').count() == 8
        assert await page.locator(".connector").count() > 0
        assert "Not played" in await page.locator("#diagram").inner_text()
        assert await page.locator("#startTournament").is_enabled()
        await page.select_option("#profile", "profile-b")
        assert await page.locator("#guestName").is_disabled()
        await page.locator("#addForm button").click()
        row = page.locator("#rosterRows tr").last
        assert "Verified profile" in await row.inner_text()
        await row.locator('[data-field="tag"]').fill("5")
        await page.fill("#guestName", "Guest partner")
        await page.locator("#addForm button").click()
        await page.locator("#rosterRows tr").last.locator('[data-field="tag"]').fill("5")
        await page.wait_for_timeout(180)
        assert await page.locator("#startTournament").is_disabled()
        assert "Guest partner" in await page.locator("#diagram").inner_text()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes === 1")
        records = await page.evaluate("__api.docs.demo.registrations.slice(-2)")
        assert [r["playerId"] for r in records] == ["profile-b", None]
        assert len(await page.evaluate("__api.docs.demo.teams")) == 5
        assert await page.locator("#startTournament").is_disabled(), "Check-in must block start"
        for row in await page.locator("#rosterRows tr").all():
            await row.locator('[data-field="checkedIn"]').check()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes === 2")
        assert await page.locator("#startTournament").is_enabled()
        await page.locator("#startTournament").click()
        await page.wait_for_function("__api.docs.demo.status === 'live'")
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.locator("#rosterRows tr").count() == 0
        assert await page.locator(".match-action").count() > 0
        assert await page.evaluate("__api.statsWrites") == 0
        return "single team-number field, verified/guest add, preview, check-in and locked start"
    finally:
        await context.close()


async def test_failures_and_polling(browser, base):
    context, page = await fresh(browser, base)
    try:
        name = page.locator('#rosterRows [data-field="name"]').first
        await name.fill("Unsaved name")
        await page.evaluate("__api.failWrite=true")
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('permission-denied')")
        assert await name.input_value() == "Unsaved name"
        assert await page.evaluate("__api.writes") == 0
        await page.evaluate("__api.failWrite=false; __api.conflict=true")
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('another device')")
        assert await name.input_value() == "Unsaved name"
        await page.evaluate("""() => {
            __api.conflict=false;__api.docs.demo.revision++;
            __api.docs.demo.registrations[0].name='Remote name';
        }""")
        await page.locator("#refresh").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Newer cloud changes')")
        assert await name.input_value() == "Unsaved name"
        await page.locator("#discard").click()
        await page.wait_for_function("document.querySelector('#rosterRows input').value==='Remote name'")
        await page.evaluate("__api.docs.demo.title='Remote title';__api.docs.demo.revision++")
        await page.evaluate("import('/js/brackets/page.js').then(m=>m.refreshSelected())")
        assert await page.locator("#tournamentTitle").inner_text() == "Remote title"
        await page.evaluate("""() => {
            __api.holdRead=true;
            import('/js/brackets/page.js').then(m=>{window.pendingRefresh=m.refreshSelected();});
        }""")
        await page.wait_for_function("typeof __api.releaseRead==='function'")
        await page.locator('#rosterRows [data-field="name"]').first.fill("Newly saved name")
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes===1")
        await page.evaluate("async () => {__api.holdRead=false;__api.releaseRead();await window.pendingRefresh;}")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Newly saved name"
        await page.evaluate("__api.failRead=true")
        await page.locator("#refresh").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('refresh failed')")
        assert await page.locator("#tournamentTitle").inner_text() == "Remote title"
        return "failed writes and revision conflicts preserve drafts; dirty-aware live polling"
    finally:
        await context.close()


async def test_spectator_and_layout(browser, base):
    context, page = await fresh(browser, base, owner=False, status="live", count=32)
    try:
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.locator("#createPanel").is_hidden()
        assert await page.locator("#rosterRows input").count() == 0
        assert await page.locator(".match-action").count() == 0
        assert await page.locator(".match-card").count() == 63
        assert "Player" in await page.locator("#diagram").inner_text()
        assert "Not decided" in await page.locator("#diagram").inner_text()
        assert await page.locator(".connector").count() > 60
        assert await page.locator("#diagramScale").input_value() == "1"
        for width in (1024, 768, 390):
            await page.set_viewport_size({"width": width, "height": 900})
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth+1"), f"Body overflow at {width}"
        await page.select_option("#diagramScale", "fit")
        await page.wait_for_timeout(150)
        assert await page.evaluate("""() => {
            const d=document.querySelector('#diagram');
            return d.scrollWidth <= d.clientWidth+2;
        }""")
        await page.select_option("#diagramScale", "1")
        await page.locator(".source-jump").first.click()
        await page.wait_for_function("document.activeElement.classList.contains('match-card')")
        assert "self-registration" in (await page.locator("#spectatorNote").inner_text()).lower()
        return "public names-only controls, 63 connected nodes, tablet/mobile containment, fit and source jumps"
    finally:
        await context.close()


async def test_manual_results_and_history(browser, base):
    context, page = await fresh(browser, base, status="live", count=2)
    try:
        await page.locator('[data-code="W1.1"] .match-action').click()
        await page.fill("#scoreA", "2")
        await page.fill("#scoreB", "0")
        await page.evaluate("__api.accountChanged(__api.account)")
        assert await page.locator("#resultPanel").is_visible()
        assert await page.locator("#scoreA").input_value() == "2"
        await page.locator("#resultForm button[type=submit]").click()
        await page.wait_for_function("__api.writes===1")
        assert "No per-dart" in await page.locator("#message").inner_text()
        assert await page.evaluate("__api.statsWrites") == 0
        assert await page.locator('[data-code="GF1"] .match-action').is_visible()
        await page.locator('[data-code="GF1"] .match-action').click()
        await page.fill("#scoreA", "2")
        await page.fill("#scoreB", "0")
        await page.locator("#resultForm button[type=submit]").click()
        await page.wait_for_function("__api.docs.demo.status==='complete'")
        assert "Champion:" in await page.locator("#champion").inner_text()
        assert "Not required" in await page.locator('[data-code="GF2"]').inner_text()
        assert await page.locator("#historyList .tournament-link").count() == 1
        assert await page.locator(".match-action").count() == 0
        assert await page.locator("#resultPanel").is_hidden()
        assert "cannot be edited" in await page.locator("#lockedNote").inner_text()
        return "manual results without stats, history/champion, no correction of immutable recorded results"
    finally:
        await context.close()


async def test_creation_and_launch(browser, base):
    context, page = await fresh(browser, base)
    try:
        await page.locator("#createPanel summary").click()
        await page.fill("#title", "My event")
        await page.fill("#date", "2026-10-01")
        assert await page.locator("#gameType option").count() == 5
        assert await page.locator("#bestOf").is_disabled()
        await page.select_option("#gameType", "501")
        await page.fill("#bestOf", "5")
        await page.locator("#createForm button").click()
        await page.wait_for_function("document.querySelector('#tournamentTitle').textContent==='My event'")
        created = await page.evaluate("Object.values(__api.docs).find(t=>t.title==='My event')")
        assert created["gameType"] == "501" and created["bestOf"] == 5
        assert created["ownerId"] == "owner"
        # Reopen a ready real engine bracket and intercept only navigation to scorer.
        await page.evaluate("__api.docs.demo=__api.fixture(2,'live')")
        await page.locator("#currentList .tournament-link").filter(has_text="Friday Doubles").click()
        await page.locator('[data-code="W1.1"] .match-action').click()
        await context.route("**/?tournamentMatch=1", lambda route: route.fulfill(
            status=200, content_type="text/html", body="<title>Scorer handoff</title>"))
        await page.locator("#launchScorer").click()
        await page.wait_for_url("**/?tournamentMatch=1")
        payload = await page.evaluate("JSON.parse(localStorage.getItem('blakeout_dev_match_launch'))")
        assert payload["tournamentId"] == "demo" and payload["matchId"] == "W1.1"
        assert isinstance(payload["revision"], int)
        assert set(payload) == {"tournamentId", "matchId", "revision"}
        return "creation whitelist/format and authoritative revision-tagged scorer handoff"
    finally:
        await context.close()


async def test_manual_reset(browser, base):
    context, page = await fresh(browser, base, status="live", count=2)
    try:
        for code, lower_wins in (("W1.1", False), ("GF1", True)):
            await page.locator(f'[data-code="{code}"] .match-action').click()
            await page.select_option("#winner", index=1 if lower_wins else 0)
            await page.fill("#scoreA", "0" if lower_wins else "2")
            await page.fill("#scoreB", "2" if lower_wins else "0")
            await page.locator("#resultForm button[type=submit]").click()
            await page.wait_for_function(f"__api.docs.demo.matches.find(m=>m.code==='{code}').status==='complete'")
        assert await page.locator("#champion").is_hidden()
        assert await page.locator('[data-code="GF1"] .match-action').count() == 0
        await page.locator('[data-code="GF2"] .match-action').click()
        await page.locator("#forfeit").check()
        assert await page.locator("#scoreA").is_disabled()
        await page.locator("#resultForm button[type=submit]").click()
        await page.wait_for_function("__api.docs.demo.status==='complete'")
        assert "Forfeit" in await page.locator('[data-code="GF2"]').inner_text()
        assert await page.evaluate("__api.statsWrites") == 0
        return "lower-bracket GF1 victory requires GF2; scoreless manual forfeit completes reset"
    finally:
        await context.close()


async def test_redacted_preview(browser, base):
    context, page = await fresh(browser, base, owner=False, count=4)
    try:
        await page.evaluate("""() => {
            const t=__api.docs.demo;
            t.registrations.push({id:'standby',playerId:null,name:'Standby guest',
                tag:'1',paid:true,checkedIn:true,standby:true});
            t.revision++;
        }""")
        await page.locator("#refresh").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('up to date')")
        assert await page.locator(".match-card").count() == 0
        assert "Standby guest" not in await page.locator("#diagram").inner_text()
        assert "will appear when play starts" in await page.locator("#diagram").inner_text()
        assert await page.locator("#publicTeams span").count() == 4
        assert await page.locator("#blockers li").count() == 0
        return "spectators render saved teams only; redacted flags never generate a preview"
    finally:
        await context.close()


async def test_real_platform_adapter(browser, base):
    context = await browser.new_context(viewport={"width": 1024, "height": 900})
    profile_name = 'Zoë "Ace" \\ 🎯'
    store = STORE + "\ndocs.set('blakeoutDevProfiles/verified_owner'," + json.dumps({"name": profile_name}) + ");"
    modules = {"firebase-app.js": APP, "firebase-auth.js": AUTH, "firebase-firestore.js": store}

    async def sdk_route(route):
        filename = route.request.url.rsplit("/", 1)[-1]
        await route.fulfill(status=200, content_type="application/javascript", body=modules[filename])

    await context.route("https://www.gstatic.com/firebasejs/**", sdk_route)
    await context.route("**/js/firebase-config.js", lambda route: route.fulfill(
        status=200, content_type="application/javascript",
        body="export const firebaseConfig={apiKey:'test-only',projectId:'demo-blakeout'};"))
    page = await context.new_page()
    page.on("dialog", lambda dialog: dialog.accept())
    try:
        await page.goto(base + "/brackets/")
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Cloud connected')")
        await page.locator("#createPanel summary").click()
        await page.fill("#title", "Real adapter event")
        await page.fill("#date", "2026-09-07")
        await page.locator("#createForm button").click()
        await page.wait_for_function("!document.querySelector('#tournament').hidden")
        await page.select_option("#profile", "verified_owner")
        await page.locator("#addForm button").click()
        for name in ("Guest One", "Guest Two", "Guest Three"):
            await page.fill("#guestName", name)
            await page.locator("#addForm button").click()
        for index, row in enumerate(await page.locator("#rosterRows tr").all()):
            await row.locator('[data-field="tag"]').fill(str(index // 2 + 1))
            await row.locator('[data-field="checkedIn"]').check()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('All roster changes saved')")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == profile_name
        assert await page.evaluate("""() => [...testDocs].filter(([k])=>k.startsWith('blakeoutDevTournaments/'))
            .every(([,v])=>typeof v.registrations==='string' && JSON.parse(v.registrations).every(r=>!('paid' in r)))""")
        # Reauthentication at the same revision must reload private flags, not save redacted defaults.
        await page.evaluate("changeTestUser(null)")
        await page.wait_for_function("document.querySelector('#rosterPanel').hidden")
        await page.wait_for_timeout(100)
        await page.evaluate("changeTestUser({uid:'verified_owner',emailVerified:true,isAnonymous:false})")
        await page.wait_for_function("!document.querySelector('#rosterControls').disabled")
        assert await page.locator('#rosterRows [data-field="checkedIn"]').first.is_checked()
        await page.evaluate("window.retryTransaction=true")
        await page.locator("#startTournament").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Tournament started')")
        await page.locator('[data-code="W1.1"] .match-action').click()
        await page.fill("#scoreA", "2")
        await page.fill("#scoreB", "0")
        await page.locator("#resultForm button[type=submit]").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Manual result saved')")
        assert await page.evaluate("[...testDocs.keys()].filter(k=>k.startsWith('blakeoutDevResults/')).length") == 0
        assert await page.evaluate("[...testDocs.keys()].filter(k=>k.startsWith('blakeoutDevRosterPrivate/')).length") == 1
        return "actual platform.js + mocked Firebase SDK: packed/private schemas, Unicode, auth reload, transaction retry"
    finally:
        await context.close()


TESTS = {
    "owner_roster": test_owner_roster,
    "failures_and_polling": test_failures_and_polling,
    "spectator_and_layout": test_spectator_and_layout,
    "manual_results_and_history": test_manual_results_and_history,
    "creation_and_launch": test_creation_and_launch,
    "manual_reset": test_manual_reset,
    "redacted_preview": test_redacted_preview,
    "real_platform_adapter": test_real_platform_adapter,
}


async def run(selected):
    runtime = DEV_ROOT / f".bu-{os.getpid()}"
    runtime.mkdir()
    old_temp = tempfile.tempdir
    old_env = {key: os.environ.get(key) for key in ("TMPDIR", "TMP", "TEMP")}
    for key in old_env:
        os.environ[key] = str(runtime)
    tempfile.tempdir = str(runtime)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(DEV_ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    failures = 0
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True, executable_path=shutil.which("google-chrome") or shutil.which("chromium"))
            try:
                for name in selected:
                    try:
                        detail = await TESTS[name](browser, f"http://127.0.0.1:{server.server_port}")
                        print(f"PASS {name}: {detail}")
                    except Exception:
                        failures += 1
                        print(f"FAIL {name}")
                        traceback.print_exc()
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        tempfile.tempdir = old_temp
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(runtime)
    print(f"{len(selected)-failures}/{len(selected)} bracket UI tests passed")
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=list(TESTS))
    args = parser.parse_args()
    raise SystemExit(bool(asyncio.run(run([args.only] if args.only else list(TESTS)))))
