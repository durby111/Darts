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
from feature_test_helpers import enable_future_features
from platform_test import APP


UI_AUTH = """
const states=new Map(), initial={uid:'verified_owner',emailVerified:true,isAnonymous:false};
const hydrate=user=>user&&({...user,getIdToken:async()=> 'test-token'});
export const getAuth=app=>{
    if(!states.has(app.name))states.set(app.name,{
        app,currentUser:hydrate(app.name==='blakeout-dev-accounts'?initial:null),listeners:[],
    });
    return states.get(app.name);
};
const notify=(auth,user)=>{
    auth.currentUser=hydrate(user);
    for(const fn of auth.listeners)fn(auth.currentUser);
};
globalThis.changeTestUser=user=>notify(states.get('blakeout-dev-accounts'),user);
export const browserLocalPersistence='LOCAL';
export const setPersistence=async()=>{};
export const onAuthStateChanged=(auth,fn)=>{auth.listeners.push(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>{};};
export const signInAnonymously=async auth=>{
    notify(auth,{uid:globalThis.testGuestUid||'guest_device_fixture',isAnonymous:true,emailVerified:false});
    return {user:auth.currentUser};
};
export const signOut=async auth=>notify(auth,null);
"""

UI_STORE = """
export const getFirestore=app=>({app});
const docs=new Map();globalThis.testDocs=docs;globalThis.testReadPaths=[];
let serial=0;
const read=()=>{if(globalThis.testOffline)throw Error('Offline');if(globalThis.denyReads)throw Error('permission-denied');};
const snapshot=ref=>{
    const exists=docs.has(ref.path),value=structuredClone(docs.get(ref.path));
    return {id:ref.id,exists:()=>exists,data:()=>structuredClone(value)};
};
export const collection=(db,...segments)=>({path:[db.path,...segments].filter(Boolean).join('/')});
export const doc=(db,...segments)=>{
    const path=[db.path,...segments].filter(Boolean).join('/')+(segments.length?'':'/generated-'+(++serial));
    return {path,id:path.split('/').at(-1)};
};
export const getDocFromServer=async ref=>{read();testReadPaths.push(ref.path);return snapshot(ref);};
export const getDocsFromServer=async ref=>{
    read();
    return {docs:[...docs.keys()].filter(path=>path.startsWith(ref.path+'/')
        &&path.slice(ref.path.length+1).indexOf('/')===-1)
        .filter(path=>!ref.filter||docs.get(path)[ref.filter.field].includes(ref.filter.value))
        .map(path=>snapshot({path,id:path.split('/').at(-1)}))};
};
export const query=(ref,filter)=>({...ref,filter});
export const where=(field,op,value)=>({field,op,value});
export const runTransaction=async(db,callback)=>{
    read();
    for(let attempt=0;attempt<5;attempt++){
        const reads=new Map(),writes=[];
        const result=await callback({
            get:async ref=>{
                if(writes.length)throw Error('Transaction reads after writes');
                testReadPaths.push(ref.path);
                reads.set(ref.path,JSON.stringify(docs.get(ref.path)));
                return snapshot(ref);
            },
            set:(ref,value)=>writes.push([ref.path,structuredClone(value)]),
            delete:ref=>writes.push([ref.path,undefined]),
        });
        if(globalThis.testTransactionHook&&writes.length){
            const hook=globalThis.testTransactionHook;globalThis.testTransactionHook=null;await hook(writes);
        }
        if(globalThis.retryTransaction){globalThis.retryTransaction=false;continue;}
        if([...reads].some(([path,value])=>JSON.stringify(docs.get(path))!==value))continue;
        writes.forEach(([path,value])=>value===undefined?docs.delete(path):docs.set(path,value));
        return result;
    }
    throw Error('Concurrent transaction retry limit');
};
"""


MOCK_PLATFORM = """
import * as engine from '/js/brackets/engine.js';
const copy = value => structuredClone(value);
window.__api = { account: {uid:'owner',emailVerified:true,isAnonymous:false},
    failWrite:false, failRead:false, conflict:false, writes:0, statsWrites:0, calls:[],
    myProfile:{id:'owner',name:'Organizer Player'}, joinCalls:0, guestCalls:0 };
const api = window.__api;
function fixture(count, status='registration', ownerId='owner') {
    let t = engine.createTournament({id:'demo',ownerId,title:'Friday Doubles',date:'2026-09-07',gameType:'chicago'});
    t = engine.saveRoster(t, Array.from({length:count*2},(_,i)=>({
        id:`r${i}`,playerId:i===0?'profile-a':null,name:`Player ${i+1}`,tag:String(Math.floor(i/2)+1),
        checkedIn:true,paid:true,standby:false,
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
export async function getProfile(){
    requireVerifiedAccount();
    if(api.failProfile)throw Error('Profile lookup unavailable');
    return copy(api.myProfile);
}
export async function joinTournament(id){
    const user=requireVerifiedAccount();
    api.joinCalls++;
    if(api.failWrite)throw Error('permission-denied');
    if(api.holdJoin)await new Promise(resolve=>{api.releaseJoin=resolve;});
    const t=api.docs[id];
    if(t.status!=='registration')throw Error('Registration is closed.');
    if(!api.myProfile)throw Error('A player profile is required.');
    if(!t.registrations.some(r=>r.playerId===user.uid)){
        t.registrations.push({id:'signup_'+user.uid,playerId:user.uid,name:api.myProfile.name,
            tag:'',paid:false,checkedIn:false,standby:false});
        t.revision++;
        api.writes++;
    }
    return getTournament(id);
}
export async function joinTournamentAsGuest(id,name){
    api.guestCalls++;
    if(api.failWrite)throw Error('Guest signup permission-denied');
    if(api.holdGuest)await new Promise(resolve=>{api.releaseGuest=resolve;});
    const t=api.docs[id];
    if(t.status!=='registration')throw Error('Registration is closed.');
    const registrationId='guest_test_device';
    const existing=t.registrations.find(r=>r.id===registrationId);
    if(existing&&existing.name!==name)throw Error('This device already has a guest entry. Ask the organizer to add another player on a shared device.');
    if(!existing){
        t.registrations.push({id:registrationId,playerId:null,name,tag:'',paid:false,checkedIn:false,standby:false});
        t.revision++;api.writes++;
    }
    return {tournament:await getTournament(id),registrationId};
}
function read(){if(api.failRead)throw Error('network unavailable');}
export async function listTournaments(){read();return copy(Object.values(api.docs));}
export async function getTournament(id){
    read();
    const snapshot=copy(api.docs[id]||null);
    if(snapshot&&api.account?.uid!==snapshot.ownerId){
        snapshot.registrations=snapshot.registrations.map(r=>({...r,paid:false,checkedIn:false,standby:false}));
    }
    if(api.holdRead)await new Promise((resolve,reject)=>{api.releaseRead=resolve;api.rejectRead=reject;});
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
    if(api.holdWrite)await new Promise(resolve=>{api.releaseWrite=resolve;});
    if(api.failWrite)throw Error('permission-denied');
    if(api.conflict||api.docs[id].revision!==expectedRevision)throw Error('This tournament changed on another device. Reload before trying again.');
    if(api.docs[id].ownerId!==api.account.uid)throw Error('Only the organizer can change it');
    const current=copy(api.docs[id]);
    const next=updater(copy(current));
    const retried=updater(copy(current));
    if(JSON.stringify(next)!==JSON.stringify(retried))throw Error('Transaction updater changed across retry');
    api.docs[id]={...copy(next),revision:current.revision+1,updatedAt:current.updatedAt+1};
    api.writes++;
    const saved=copy(api.docs[id]);
    if(api.holdResponse)await new Promise(resolve=>{api.releaseResponse=resolve;});
    return saved;
}
export async function saveMatchResult(){api.statsWrites++;throw Error('Manual UI must not fabricate player statistics');}
"""



async def click_with_confirmation(page, selector, *, accept=True):
    """Drive the real asynchronous app dialog after the triggering action."""
    await page.locator(selector).click()
    dialog = page.locator('dialog.platform-confirm[open]')
    if await dialog.count():
        assert await dialog.locator('.platform-confirm-cancel').evaluate('el => document.activeElement === el')
        await dialog.locator('.platform-confirm-accept' if accept else '.platform-confirm-cancel').click()
        await dialog.wait_for(state='detached')


async def fresh(browser, base, *, owner=True, status="registration", count=4, touch=False):
    context = await browser.new_context(viewport={"width": 1024, "height": 900}, has_touch=touch)
    await enable_future_features(context)
    await context.route("**/js/platform.js", lambda route: route.fulfill(
        status=200, content_type="application/javascript", body=MOCK_PLATFORM))
    page = await context.new_page()
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
        await click_with_confirmation(page, "#startTournament")
        assert "Save all roster changes" in await page.locator("#startFeedback").inner_text()
        assert await page.evaluate("__api.calls.length") == 0
        assert "Guest partner" in await page.locator("#diagram").inner_text()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes === 1")
        records = await page.evaluate("__api.docs.demo.registrations.slice(-2)")
        assert [r["playerId"] for r in records] == ["profile-b", None]
        assert len(await page.evaluate("__api.docs.demo.teams")) == 5
        await click_with_confirmation(page, "#startTournament")
        assert "checked in" in await page.locator("#startFeedback").inner_text()
        assert await page.evaluate("__api.writes") == 1
        for row in await page.locator("#rosterRows tr").all():
            await row.locator('[data-field="checkedIn"]').check()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes === 2")
        await click_with_confirmation(page, "#startTournament")
        assert "marked paid" in await page.locator("#startFeedback").inner_text()
        assert await page.evaluate("__api.writes") == 2
        assert await page.evaluate("__api.docs.demo.status") == "registration"
        assert "marked paid" in await page.locator("#blockers").inner_text()
        for row in await page.locator("#rosterRows tr").all():
            await row.locator('[data-field="paid"]').check()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes === 3")
        assert await page.locator("#startTournament").is_enabled()
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("__api.docs.demo.status === 'live'")
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.locator("#rosterRows tr").count() == 0
        assert await page.locator(".match-action").count() > 0
        assert await page.evaluate("__api.statsWrites") == 0
        return "single team-number field, verified/guest add, preview, check-in and locked start"
    finally:
        await context.close()


async def test_roster_counts(browser, base):
    context, page = await fresh(browser, base)
    try:
        summary = page.locator("#rosterSummary")
        assert await summary.inner_text() == "8 total · 0 standby · 8 non-standby · 8 in complete pairs · 0 without a complete pair"
        assert await page.locator('#rosterRows th[scope="row"]').all_text_contents() == [str(i) for i in range(1, 9)]
        ids = await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)')
        await page.locator('#rosterRows [data-field="standby"]').first.check()
        await page.wait_for_function("document.querySelector('#rosterSummary').textContent.includes('6 in complete pairs')")
        assert await summary.inner_text() == "8 total · 1 standby · 7 non-standby · 6 in complete pairs · 1 without a complete pair"
        assert await page.evaluate('__api.writes') == 0, "Counts describe drafts without saving"
        await page.locator('#rosterRows tr').last.locator('button:not([data-move])').click()
        assert await page.locator('#rosterRows th[scope="row"]').all_text_contents() == [str(i) for i in range(1, 8)]
        assert await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)') == ids[:-1]
        assert await summary.inner_text() == "7 total · 1 standby · 6 non-standby · 4 in complete pairs · 2 without a complete pair"
        for width in (744, 1133, 390):
            await page.set_viewport_size({"width": width, "height": 900})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), f"Body overflow at {width}"
        await page.locator('#saveRoster').click()
        await page.wait_for_function('__api.writes===1')
        assert await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)') == ids[:-1]
        await page.evaluate('__api.account=null;__api.accountChanged(null)')
        await page.wait_for_function("document.querySelector('#rosterPanel').hidden")
        assert await summary.text_content() == '', "Private standby-derived counts cleared on signout"
        assert await page.locator('#rosterRows tr').count() == 0
        return "draft counts, standby/pair breakdown, renumbering preserves IDs, responsive widths and signout privacy"
    finally:
        await context.close()


async def test_bulk_flags_and_odd_warning(browser, base):
    context, page = await fresh(browser, base)
    try:
        paid = page.locator('[data-bulk-field="paid"]')
        checkin = page.locator('[data-bulk-field="checkedIn"]')
        standby = page.locator('[data-bulk-field="standby"]')
        ids = await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)')
        assert await paid.is_checked() and await checkin.is_checked()
        assert not await standby.is_checked()
        await page.locator('#rosterRows [data-field="paid"]').first.uncheck()
        assert await paid.evaluate('(input)=>input.indeterminate')
        await paid.click()
        assert await page.locator('#rosterRows [data-field="paid"]:checked').count() == 8
        assert not await paid.evaluate('(input)=>input.indeterminate')
        await paid.uncheck()
        await checkin.uncheck()
        await standby.check()
        assert await page.locator('#rosterRows [data-field="paid"]:checked').count() == 0
        assert await page.locator('#rosterRows [data-field="checkedIn"]:checked').count() == 0
        assert await page.locator('#rosterRows [data-field="standby"]:checked').count() == 8
        assert await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)') == ids
        assert await page.evaluate('__api.writes') == 0
        await click_with_confirmation(page, '#startTournament')
        assert 'Save all roster changes' in await page.locator('#startFeedback').inner_text()
        assert await page.evaluate('__api.writes') == 0
        await page.evaluate('__api.failWrite=true')
        await page.locator('#saveRoster').click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('permission-denied')")
        assert await standby.is_checked(), "Failed bulk save preserves draft"
        await page.evaluate('__api.failWrite=false;__api.conflict=true')
        await page.locator('#saveRoster').click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('another device')")
        assert await standby.is_checked() and not await paid.is_checked()
        assert await page.evaluate('__api.writes') == 0
        await page.evaluate('__api.conflict=false')
        await click_with_confirmation(page, '#discard')
        await page.wait_for_function("!document.querySelector('[data-bulk-field=standby]').checked")
        assert await paid.is_checked() and await checkin.is_checked()
        await page.fill('#guestName', 'Unpaired arrival')
        await page.locator('#addForm button').click()
        assert await page.locator('#rosterWarning').is_visible()
        await page.locator('#saveRoster').click()
        await page.wait_for_function('__api.writes===1')
        assert await page.locator('#startTournament').is_enabled(), "Odd total alone must not block ready teams"
        assert await page.locator('#rosterWarning').is_visible()
        await page.locator('#rosterRows [data-field="standby"]').last.check()
        await page.wait_for_function("document.querySelector('#rosterWarning').hidden")
        assert await standby.evaluate('(input)=>input.indeterminate')
        await paid.check()
        assert await page.locator('#rosterRows [data-field="paid"]:checked').count() == 9, "Bulk explicitly includes standby"
        await page.locator('#saveRoster').click()
        await page.wait_for_function('__api.writes===2')
        assert await page.evaluate('__api.docs.demo.registrations.every(r=>r.paid)')
        await page.evaluate('__api.account=null;__api.accountChanged(null)')
        await page.wait_for_function("document.querySelector('#rosterPanel').hidden")
        for control in (paid, checkin, standby):
            assert await control.is_disabled()
            assert not await control.is_checked()
            assert not await control.evaluate('(input)=>input.indeterminate')
        assert await page.locator('#rosterWarning').text_content() == ''
    finally:
        await context.close()
    context, page = await fresh(browser, base, count=0)
    try:
        for control in await page.locator('[data-bulk-field]').all():
            assert await control.is_disabled()
        assert await page.locator('#rosterWarning').is_hidden()
        return "bulk all/none/mixed, private draft state, failed/stale saves, explicit standby scope, odd-warning-only and empty roster"
    finally:
        await context.close()


async def test_roster_order(browser, base):
    context, page = await fresh(browser, base)
    try:
        ids = await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)')
        original = await page.evaluate('structuredClone(__api.docs.demo)')
        assert await page.locator('#rosterRows [data-move="up"]').first.is_disabled()
        assert await page.locator('#rosterRows [data-move="down"]').last.is_disabled()
        await page.locator('#rosterRows [data-move="down"]').first.click()
        assert await page.evaluate('document.activeElement.closest("tr").dataset.registration') == ids[0]
        await page.keyboard.press('Enter')
        expected = [ids[1],ids[2],ids[0],*ids[3:]]
        assert await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)') == expected
        assert await page.locator('#rosterRows th[scope="row"]').all_text_contents() == [str(i) for i in range(1,9)]
        assert await page.evaluate('__api.writes') == 0
        await click_with_confirmation(page, '#startTournament')
        assert 'Save all roster changes' in await page.locator('#startFeedback').inner_text()
        assert await page.evaluate('__api.writes') == 0
        await page.evaluate('__api.conflict=true')
        await page.locator('#saveRoster').click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('another device')")
        assert await page.locator('#rosterRows tr').evaluate_all('(rows)=>rows.map(r=>r.dataset.registration)') == expected
        await page.evaluate('__api.conflict=false')
        await page.locator('#saveRoster').click()
        await page.wait_for_function('__api.writes===1')
        saved = await page.evaluate('__api.docs.demo')
        assert [r['id'] for r in saved['registrations']] == expected
        assert {r['id']:r for r in saved['registrations']} == {r['id']:r for r in original['registrations']}
        assert {t['id']:t for t in saved['teams']} == {t['id']:t for t in original['teams']}, "Partner order and team IDs must stay stable"
        for width in (744, 1133, 390):
            await page.set_viewport_size({"width":width,"height":900})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        await click_with_confirmation(page, '#startTournament')
        await page.wait_for_function("__api.docs.demo.status==='live'")
        assert await page.locator('#rosterRows [data-move]').count() == 0
        assert await page.locator('.match-card.pending').first.evaluate("e=>getComputedStyle(e).borderStyle") == 'dashed'
        assert await page.locator('.match-card.ready').first.evaluate("e=>getComputedStyle(e).borderStyle") == 'solid'
        return "keyboard/touch reordering, focus, numbering, stable registrations/teams/partner order, stale-save preservation and locked controls"
    finally:
        await context.close()


async def test_event_name_labels(browser, base):
    context, page = await fresh(browser, base)
    try:
        await page.evaluate("""() => {
            __api.docs.demo.registrations[0].name='Alex';
            __api.docs.demo.registrations[1].name='Alex';
            __api.docs.demo.registrations[2].name='(1) Alex';
            __api.docs.demo.revision++;
        }""")
        await page.locator('#refresh').click()
        await page.wait_for_function("document.querySelector('#publicRoster').textContent.includes('(2) Alex')")
        labels=await page.locator('#publicRoster li').all_text_contents()
        assert labels[:3]==['(2) Alex','(3) Alex','(1) Alex']
        assert '(2) Alex & (3) Alex' in await page.locator('#publicTeams').inner_text()
        assert '(2) Alex & (3) Alex' in await page.locator('#diagram').inner_text()
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value()=='Alex'
        assert await page.locator('#rosterRows .event-name-label').first.inner_text()=='Event label: (2) Alex'
        await page.locator('#rosterRows [data-move="down"]').first.click()
        assert await page.locator('#publicRoster li').all_text_contents()==labels, 'Draft order must not change saved public labels'
        assert await page.locator('#rosterRows .event-name-label').nth(1).inner_text()=='Event label: (2) Alex'
        await page.locator('#rosterRows [data-field="name"]').nth(1).fill('Sam')
        await page.wait_for_function("document.querySelectorAll('#rosterRows .event-name-label')[1].hidden")
        assert await page.evaluate('__api.writes')==0
        await page.locator('#saveRoster').click()
        await page.wait_for_function('__api.writes===1')
        assert (await page.locator('#publicRoster li').all_text_contents())[:3]==['Alex','Sam','(1) Alex']
        assert await page.evaluate('__api.docs.demo.registrations.slice(0,3).map(r=>r.name)')==['Alex','Sam','(1) Alex']
        await page.evaluate('__api.account=null;__api.accountChanged(null)')
        await page.wait_for_function("document.querySelector('#rosterPanel').hidden")
        assert (await page.locator('#publicRoster li').all_text_contents())[:3]==['Alex','Sam','(1) Alex']
        return 'saved public roster/bracket labels, draft-only hints, reorder consistency, owner rename and spectator consistency without name ownership'
    finally:
        await context.close()


async def test_start_feedback(browser, base):
    context, page = await fresh(browser, base, count=32, touch=True)
    try:
        await page.evaluate("window.testConfirmCalls=0;new MutationObserver(rs=>rs.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1&&n.matches('.platform-confirm-host'))testConfirmCalls++;}))).observe(document.body,{childList:true});window.confirm=()=>{throw Error('Native confirm must not run');}")
        await page.locator('#rosterRows [data-field="name"]').first.fill("<img src=x onerror=alert(1)>")
        await page.locator('#rosterRows [data-field="tag"]').first.fill("")
        await page.locator("#startTournament").tap()
        panel = page.locator("#startFeedback")
        assert "Save all roster changes" in await panel.inner_text()
        assert "needs a team tag and partner" in await panel.inner_text()
        assert await panel.locator("img").count() == 0, "Player labels must remain text"
        assert await page.evaluate("document.activeElement.id") == "startFeedback"
        assert await page.evaluate("testConfirmCalls") == 0
        assert await page.evaluate("__api.calls.length") == 0
        assert await page.evaluate("__api.writes") == 0
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "<img src=x onerror=alert(1)>"
        for width in (1024, 768, 390):
            await page.set_viewport_size({"width": width, "height": 900})
            await page.locator("#startTournament").press("Enter")
            assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth+1"), f"Body overflow at {width}"
            assert await panel.evaluate("el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}"), f"Start feedback off-screen at {width}"
        await page.locator('#rosterRows [data-field="tag"]').first.fill("1")
        assert await panel.is_hidden(), "Editing must clear obsolete attempted-start feedback"
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes===1")
        await page.locator('#rosterRows [data-field="checkedIn"]').first.uncheck()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.writes===2")
        await click_with_confirmation(page, "#startTournament")
        assert "must be checked in" in await panel.inner_text()
        assert await page.evaluate("testConfirmCalls") == 0
        assert await page.evaluate("__api.docs.demo.status") == "registration"
        return "touch/keyboard Start explains unsaved, missing-pair and check-in blockers; no confirmation/write, safe text and nearby tablet/mobile feedback"
    finally:
        await context.close()


async def test_start_pending_and_failure(browser, base):
    context, page = await fresh(browser, base)
    try:
        await click_with_confirmation(page, "#startTournament", accept=False)
        assert "Start canceled" in await page.locator("#startFeedback").inner_text()
        assert await page.evaluate("__api.calls.length") == 0
        assert await page.evaluate("__api.docs.demo.matches.length") == 0
    finally:
        await context.close()
    context, page = await fresh(browser, base)
    try:
        await page.evaluate("__api.failWrite=true")
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("document.querySelector('#startFeedback').textContent.includes('permission-denied')")
        assert "Start was not confirmed" in await page.locator("#startFeedback").inner_text()
        assert await page.evaluate("__api.writes") == 0
        assert await page.locator("#startTournament").is_enabled()
        await page.evaluate("import('/js/brackets/page.js').then(m=>m.refreshSelected())")
        assert "up to date" in await page.locator("#message").inner_text()
        assert "permission-denied" in await page.locator("#startFeedback").inner_text()
        await page.evaluate("__api.failWrite=false;__api.conflict=true")
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("document.querySelector('#startFeedback').textContent.includes('another device')")
        assert await page.evaluate("__api.docs.demo.status") == "registration"
        await page.evaluate("__api.conflict=false;__api.holdWrite=true")
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("typeof __api.releaseWrite==='function'")
        assert "Waiting for cloud confirmation" in await page.locator("#startFeedback").inner_text()
        assert await page.locator("#startTournament").is_disabled()
        calls = await page.evaluate("__api.calls.length")
        await page.locator("#startTournament").dispatch_event("click")
        assert await page.evaluate("__api.calls.length") == calls
        await page.evaluate("__api.holdWrite=false;__api.releaseWrite()")
        await page.wait_for_function("__api.docs.demo.status==='live'")
        assert await page.evaluate("__api.writes") == 1
        assert await page.locator("#startFeedback").is_hidden()
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.evaluate("document.activeElement.id") == "bracketHeading"
        return "canceled/failed/conflicting/pending Start is explicit, polling preserves errors, repeats do not duplicate the cloud operation, retry locks once"
    finally:
        await context.close()


async def test_start_account_switch(browser, base):
    context, page = await fresh(browser, base)
    try:
        await page.locator('#rosterRows [data-field="checkedIn"]').first.uncheck()
        await click_with_confirmation(page, "#startTournament")
        assert "Player 1 must be checked in" in await page.locator("#startFeedback").inner_text()
        await page.evaluate("__api.account=null;__api.accountChanged(null)")
        assert await page.locator("#startFeedback").is_hidden()
        assert await page.locator("#startFeedbackTitle").text_content() == ""
        assert await page.locator("#startFeedbackReasons li").count() == 0
        assert await page.locator("#rosterRows input").count() == 0
    finally:
        await context.close()
    context, page = await fresh(browser, base)
    try:
        await page.evaluate("__api.holdWrite=true")
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("typeof __api.releaseWrite==='function'")
        await page.evaluate("__api.account=null;__api.accountChanged(null);__api.failWrite=true;__api.releaseWrite()")
        await page.wait_for_function("!document.querySelector('#refresh').disabled")
        assert await page.locator("#startFeedback").is_hidden()
        assert await page.locator("#startFeedbackTitle").text_content() == ""
        assert await page.locator("#startFeedbackReasons li").count() == 0
        assert await page.locator("#rosterRows input").count() == 0
        assert await page.locator("#startTournament").is_disabled()
        assert await page.evaluate("__api.writes") == 0
    finally:
        await context.close()
    context, page = await fresh(browser, base)
    try:
        await page.evaluate("__api.holdResponse=true")
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("typeof __api.releaseResponse==='function'")
        assert await page.evaluate("__api.writes") == 1
        await page.evaluate("""() => {
            __api.account={uid:'different-owner',emailVerified:true,isAnonymous:false};
            __api.accountChanged(__api.account);
            __api.releaseResponse();
        }""")
        await page.wait_for_function("!document.querySelector('#refresh').disabled")
        assert await page.locator("#startFeedback").is_hidden()
        assert await page.locator("#startFeedbackTitle").text_content() == ""
        assert await page.locator("#startFeedbackReasons li").count() == 0
        assert await page.locator("#rosterRows input").count() == 0
        assert await page.locator("#startTournament").is_disabled()
        assert await page.evaluate("document.activeElement.id") != "bracketHeading"
        assert await page.evaluate("__api.writes") == 1
        return "account changes clear private blockers; late failed/successful starts cannot repopulate feedback, enable organizer controls or focus the bracket"
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
        await click_with_confirmation(page, "#discard")
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
        assert "join immediately" in (await page.locator("#spectatorNote").inner_text()).lower()
        return "public names-only controls, 63 connected nodes, tablet/mobile containment, fit and source jumps"
    finally:
        await context.close()


async def assert_outcome_styles(page, code):
    card=page.locator(f'[data-code="{code}"]')
    assert await card.locator('.match-slot.won').count()==1
    assert await card.locator('.match-slot.lost').count()==1
    assert 'Won' in await card.locator('.won .slot-score').inner_text()
    assert 'Lost' in await card.locator('.lost .slot-score').inner_text()
    for theme in ('blue','arctic'):
        await page.evaluate("theme=>document.documentElement.dataset.theme=theme",theme)
        result=await card.evaluate("""card=>{
            const lum=color=>{
                const rgb=color.match(/[0-9.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
                return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
            };
            const contrast=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
            const bg=lum(getComputedStyle(card).backgroundColor);
            return [...card.querySelectorAll('.match-slot')].map(slot=>{
                const style=getComputedStyle(slot), text=getComputedStyle(slot.querySelector('.slot-score'));
                return {state:slot.className,width:style.outlineWidth,style:style.outlineStyle,
                    outlineContrast:contrast(lum(style.outlineColor),bg),textContrast:contrast(lum(text.color),bg)};
            });
        }""")
        assert all(r['width']=='2px' and r['style']=='solid' and r['outlineContrast']>=3 and r['textContrast']>=4.5 for r in result),(theme,result)
    await page.evaluate("document.documentElement.dataset.theme='blue'")
    assert await page.locator('.match-card:not(.complete) .won, .match-card:not(.complete) .lost').count()==0


async def test_manual_results_and_history(browser, base):
    context, page = await fresh(browser, base, status="live", count=2)
    try:
        await page.locator('[data-code="W1.1"] .match-action').click()
        await page.fill("#scoreA", "2")
        await page.fill("#scoreB", "0")
        await page.evaluate("__api.accountChanged(__api.account)")
        assert await page.locator("#resultPanel").is_visible()
        assert await page.locator("#scoreA").input_value() == "2"
        await click_with_confirmation(page, "#resultForm button[type=submit]")
        await page.wait_for_function("__api.writes===1")
        assert "No per-dart" in await page.locator("#message").inner_text()
        await assert_outcome_styles(page,"W1.1")
        assert await page.evaluate("__api.statsWrites") == 0
        assert await page.locator('[data-code="GF1"] .match-action').is_visible()
        await page.locator('[data-code="GF1"] .match-action').click()
        await page.fill("#scoreA", "2")
        await page.fill("#scoreB", "0")
        await click_with_confirmation(page, "#resultForm button[type=submit]")
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
        assert await page.locator("#gameType option").count() == 6
        assert await page.locator("#bestOf").is_disabled()
        await page.select_option("#gameType", "501")
        await page.fill("#bestOf", "5")
        await click_with_confirmation(page, "#createForm button")
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
            await click_with_confirmation(page, "#resultForm button[type=submit]")
            await page.wait_for_function(f"__api.docs.demo.matches.find(m=>m.code==='{code}').status==='complete'")
        assert await page.locator("#champion").is_hidden()
        assert await page.locator('[data-code="GF1"] .match-action').count() == 0
        await page.locator('[data-code="GF2"] .match-action').click()
        await page.locator("#forfeit").check()
        assert await page.locator("#scoreA").is_disabled()
        await click_with_confirmation(page, "#resultForm button[type=submit]")
        await page.wait_for_function("__api.docs.demo.status==='complete'")
        assert "Forfeit" in await page.locator('[data-code="GF2"]').inner_text()
        assert await page.evaluate("__api.statsWrites") == 0
        await assert_outcome_styles(page,"GF2")
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


async def test_immediate_self_join(browser, base):
    context, page = await fresh(browser, base, owner=False)
    try:
        assert await page.locator("#joinTournament").is_disabled()
        await page.evaluate("""() => {
            __api.account={uid:'self_player',emailVerified:true,isAnonymous:false};
            __api.myProfile=null;
            __api.accountChanged(__api.account);
        }""")
        await page.wait_for_function("document.querySelector('#joinHelp').textContent.includes('Create your public')")
        assert await page.locator("#joinProfileLink").is_visible()
        assert await page.locator("#joinTournament").is_disabled()
        await page.evaluate("__api.failProfile=true")
        await page.locator("#refreshJoinProfile").click()
        await page.wait_for_function("document.querySelector('#joinHelp').textContent.includes('could not be loaded')")
        await page.evaluate("__api.failProfile=false;__api.myProfile={id:'self_player',name:'Immediate Player'}")
        await page.locator("#refreshJoinProfile").click()
        await page.wait_for_function("!document.querySelector('#joinTournament').disabled")
        await page.evaluate("__api.failWrite=true")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('permission-denied')")
        assert "Immediate Player" not in await page.locator("#publicRoster").inner_text()
        assert await page.locator("#joinTournament").inner_text() == "Join tournament"
        await page.evaluate("__api.failWrite=false;__api.holdJoin=true")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("typeof __api.releaseJoin==='function'")
        assert "Immediate Player" not in await page.locator("#publicRoster").inner_text()
        assert await page.locator("#joinTournament").is_disabled()
        await page.evaluate("__api.holdJoin=false;__api.releaseJoin()")
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Already registered'")
        assert "Immediate Player" in await page.locator("#publicRoster").inner_text()
        assert await page.locator("#publicRoster li").count() == 9
        assert await page.locator("#publicTeams span").count() == 4
        assert await page.locator("#rosterRows input").count() == 0
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.locator("#joinTournament").is_disabled()
        row = await page.evaluate("__api.docs.demo.registrations.at(-1)")
        assert row == {"id": "signup_self_player", "playerId": "self_player", "name": "Immediate Player",
                       "tag": "", "paid": False, "checkedIn": False, "standby": False}
        await page.evaluate("import('/js/platform.js').then(p=>p.joinTournament('demo'))")
        assert await page.evaluate("__api.docs.demo.registrations.filter(r=>r.playerId==='self_player').length") == 1
        return "verified own-profile immediate join, public unpaired names, API failure/pending honesty and idempotence"
    finally:
        await context.close()


async def test_owner_join_and_concurrent_arrivals(browser, base):
    context, page = await fresh(browser, base)
    try:
        await page.locator('#rosterRows [data-field="name"]').first.fill("Preserved organizer edit")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Already registered'")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Preserved organizer edit"
        assert "Organizer Player" in await page.locator("#publicRoster").inner_text()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('another device')")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Preserved organizer edit"
        await click_with_confirmation(page, "#discard")
        await page.wait_for_function("document.querySelectorAll('#rosterRows tr').length===9")
        joined = page.locator('#rosterRows tr[data-registration="signup_owner"]')
        assert not await joined.locator('[data-field="checkedIn"]').is_checked()
        assert not await joined.locator('[data-field="paid"]').is_checked()
        await joined.locator('[data-field="name"]').fill("Tournament owner name")
        await page.locator("#saveRoster").click()
        await page.wait_for_function("__api.docs.demo.registrations.some(r=>r.name==='Tournament owner name')")
        await joined.locator("button:not([data-move])").click()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Join tournament'")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Already registered'")
        assert await page.evaluate("__api.docs.demo.registrations.filter(r=>r.playerId==='owner').length") == 1
        await page.locator('#rosterRows [data-field="tag"]').first.fill("99")
        await page.evaluate("""() => {
            __api.docs.demo.registrations.push({id:'signup_concurrent',playerId:'concurrent',
                name:'Concurrent arrival',tag:'',paid:false,checkedIn:false,standby:false});
            __api.docs.demo.revision++;
        }""")
        await page.locator("#refresh").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Newer cloud changes')")
        assert "Concurrent arrival" in await page.locator("#publicRoster").inner_text()
        assert await page.locator('#rosterRows [data-field="tag"]').first.input_value() == "99"
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('another device')")
        assert await page.evaluate("__api.docs.demo.registrations.some(r=>r.playerId==='concurrent')")
        return "organizer participation/edit/remove/rejoin and concurrent arrivals preserve dirty drafts and reject stale saves"
    finally:
        await context.close()


async def test_join_closed_and_start_race(browser, base):
    for status in ("live", "complete"):
        context, page = await fresh(browser, base, status=status)
        try:
            assert await page.locator("#joinTournament").is_disabled()
            assert await page.locator("#joinTournament").inner_text() == "Registration closed"
            assert await page.locator("#guestJoinName").is_disabled()
        finally:
            await context.close()
    context, page = await fresh(browser, base)
    try:
        await page.evaluate("""() => {
            __api.docs.demo=__api.fixture(4,'live');
            __api.docs.demo.revision++;
        }""")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Registration is closed')")
        assert await page.locator("#publicRoster li").count() == 8
        assert await page.evaluate("__api.docs.demo.registrations.every(r=>r.playerId!=='owner')")
        await page.locator("#refresh").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Registration closed'")
        return "closed/live/completed registration and join racing start cannot create a local success"
    finally:
        await context.close()


async def test_six_games_create_and_launch(browser, base):
    for game in ("chicago", "301", "501", "cricket", "spanish", "minnesota"):
        context, page = await fresh(browser, base)
        try:
            await page.locator("#createPanel summary").click()
            await page.fill("#title", f"{game} bracket")
            await page.fill("#date", "2026-09-07")
            await page.select_option("#gameType", game)
            if game != "chicago":
                await page.fill("#bestOf", "5")
            await click_with_confirmation(page, "#createForm button")
            await page.wait_for_function("name=>document.querySelector('#tournamentTitle').textContent===name", arg=f"{game} bracket")
            t = await page.evaluate("name=>Object.values(__api.docs).find(t=>t.title===name)", f"{game} bracket")
            assert t["gameType"] == game
            assert t["bestOf"] == (3 if game == "chicago" else 5)
            await page.evaluate("""async id => {
                const e=await import('/js/brackets/engine.js');
                let t=__api.docs[id];
                t=e.saveRoster(t,__api.fixture(2).registrations);
                __api.docs[id]=e.startTournament(t);
            }""", t["id"])
            await page.locator("#refresh").click()
            await page.wait_for_function("document.querySelectorAll('.match-action').length>0")
            await page.locator('[data-code="W1.1"] .match-action').click()
            await context.route("**/?tournamentMatch=1", lambda route: route.fulfill(status=200, content_type="text/html", body="<title>Scorer handoff</title>"))
            await page.locator("#launchScorer").click()
            await page.wait_for_url("**/?tournamentMatch=1")
            payload = await page.evaluate("JSON.parse(localStorage.getItem('blakeout_dev_match_launch'))")
            assert payload["tournamentId"] == t["id"] and payload["matchId"] == "W1.1"
        finally:
            await context.close()
    return "all six games create correct formats and launch with authoritative tournament/match/revision"


async def test_immediate_guest_join(browser, base):
    context, page = await fresh(browser, base, owner=False)
    try:
        assert await page.locator("#guestJoinName").is_enabled()
        await page.fill("#guestJoinName", "Player 1")
        await page.evaluate("__api.failWrite=true")
        await page.locator("#joinGuest").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Guest signup permission-denied')")
        assert await page.locator("#publicRoster li").count() == 8
        assert await page.locator("#guestJoinName").input_value() == "Player 1"
        await page.evaluate("__api.failWrite=false;__api.holdGuest=true")
        await page.locator("#joinGuest").click()
        await page.wait_for_function("typeof __api.releaseGuest==='function'")
        assert await page.locator("#publicRoster li").count() == 8
        assert await page.locator("#guestJoinName").is_disabled()
        await page.evaluate("__api.holdGuest=false;__api.releaseGuest()")
        await page.wait_for_function("document.querySelector('#joinGuest').textContent==='Guest already registered'")
        assert await page.locator("#publicRoster li").count() == 9
        assert await page.locator("#publicRoster li").filter(has_text="Player 1").count() == 2
        assert "no lifetime statistics" in (await page.locator("#message").inner_text()).lower()
        guest = await page.evaluate("__api.docs.demo.registrations.find(r=>r.id==='guest_test_device')")
        assert guest["playerId"] is None
        assert guest["paid"] is False and guest["checkedIn"] is False
        assert await page.evaluate("__api.docs.demo.registrations.find(r=>r.id==='r0').playerId") == "profile-a"
        await page.evaluate("import('/js/platform.js').then(p=>p.joinTournamentAsGuest('demo','Player 1'))")
        assert await page.evaluate("__api.docs.demo.registrations.filter(r=>r.id==='guest_test_device').length") == 1
        rejected = await page.evaluate("""async () => {
            const p=await import('/js/platform.js');
            try {await p.joinTournamentAsGuest('demo','Another player');return false;}
            catch(error){return error.message.includes('shared device');}
        }""")
        assert rejected, "A shared-device guest must not be claimed by entering another name"
        assert await page.locator("#rosterRows input").count() == 0
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.locator("#joinTournament").is_disabled(), "Guest signup must not verify a profile account"
        return "name-only immediate guest registration: anonymous, same-name isolation, server confirmation, retry and no lifetime stats"
    finally:
        await context.close()


async def test_real_platform_adapter(browser, base):
    context = await browser.new_context(viewport={"width": 1024, "height": 900})
    await enable_future_features(context)
    profile_name = 'Zoë "Ace" \\ 🎯'
    store = UI_STORE + "\ndocs.set('blakeoutDevProfiles/verified_owner'," + json.dumps({"name": profile_name}) + ");"
    modules = {"firebase-app.js": APP, "firebase-auth.js": UI_AUTH, "firebase-firestore.js": store}

    async def sdk_route(route):
        filename = route.request.url.rsplit("/", 1)[-1]
        await route.fulfill(status=200, content_type="application/javascript", body=modules[filename])

    await context.route("https://www.gstatic.com/firebasejs/**", sdk_route)
    await context.route("**/js/firebase-config.js", lambda route: route.fulfill(
        status=200, content_type="application/javascript",
        body="export const firebaseConfig={apiKey:'test-only',projectId:'demo-blakeout'};"))
    page = await context.new_page()
    try:
        await page.goto(base + "/brackets/")
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Cloud connected')")
        await page.locator("#createPanel summary").click()
        await page.fill("#title", "Real adapter event")
        await page.fill("#date", "2026-09-07")
        await click_with_confirmation(page, "#createForm button")
        await page.wait_for_function("!document.querySelector('#tournament').hidden")
        await page.select_option("#profile", "verified_owner")
        await page.locator("#addForm button").click()
        for name in ("Guest One", "Guest Two", "Guest Three"):
            await page.fill("#guestName", name)
            await page.locator("#addForm button").click()
        for index, row in enumerate(await page.locator("#rosterRows tr").all()):
            await row.locator('[data-field="tag"]').fill(str(index // 2 + 1))
            await row.locator('[data-field="checkedIn"]').check()
            await row.locator('[data-field="paid"]').check()
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
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Tournament started')")
        await page.locator('[data-code="W1.1"] .match-action').click()
        await page.fill("#scoreA", "2")
        await page.fill("#scoreB", "0")
        await click_with_confirmation(page, "#resultForm button[type=submit]")
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Manual result saved')")
        assert await page.evaluate("[...testDocs.keys()].filter(k=>k.startsWith('blakeoutDevResults/')).length") == 0
        assert await page.evaluate("[...testDocs.keys()].filter(k=>k.startsWith('blakeoutDevRosterPrivate/')).length") == 1
        return "actual platform.js + mocked Firebase SDK: packed/private schemas, Unicode, auth reload, transaction retry"
    finally:
        await context.close()


async def actual_join_page(browser, base):
    context = await browser.new_context(viewport={"width": 1024, "height": 900})
    await enable_future_features(context)
    store = UI_STORE + """
docs.set('blakeoutDevProfiles/verified_owner',{name:'Verified Organizer'});
docs.set('blakeoutDevProfiles/verified_joiner',{name:'Verified Arrival'});
"""
    modules = {"firebase-app.js": APP, "firebase-auth.js": UI_AUTH, "firebase-firestore.js": store}

    async def sdk_route(route):
        await route.fulfill(status=200, content_type="application/javascript",
                            body=modules[route.request.url.rsplit("/", 1)[-1]])

    await context.route("https://www.gstatic.com/firebasejs/**", sdk_route)
    await context.route("**/js/firebase-config.js", lambda route: route.fulfill(
        status=200, content_type="application/javascript",
        body="export const firebaseConfig={apiKey:'test-only',projectId:'demo-blakeout'};"))
    page = await context.new_page()
    await page.goto(base + "/brackets/")
    await page.wait_for_function("document.querySelector('#message').textContent.includes('Cloud connected')")
    await page.evaluate("""async () => {
        const p=await import('/js/platform.js'),e=await import('/js/brackets/engine.js');
        let t=e.createTournament({id:'selfjoin-integration',ownerId:'verified_owner',
            title:'Real selfjoin integration',date:'2026-09-07',gameType:'minnesota',bestOf:3});
        t=e.saveRoster(t,Array.from({length:8},(_,i)=>({id:'seed-'+i,playerId:null,
            name:'Seed player '+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));
        await p.createTournamentDocument(t);
    }""")
    await page.locator("#refresh").click()
    await page.locator(".tournament-link").first.click()
    await page.wait_for_function("!document.querySelector('#tournament').hidden")
    return context, page


async def test_real_verified_selfjoin(browser, base):
    context, page = await actual_join_page(browser, base)
    try:
        await page.locator('#rosterRows [data-field="name"]').first.fill("Dirty organizer edit")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Already registered'")
        assert "Verified Organizer" in await page.locator("#publicRoster").inner_text()
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Dirty organizer edit"
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('changed')")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Dirty organizer edit"
        await click_with_confirmation(page, "#discard")
        await page.wait_for_function("document.querySelectorAll('#rosterRows tr').length===9")
        row = page.locator('#rosterRows tr[data-registration="self-verified_owner"]')
        assert not await row.locator('[data-field="checkedIn"]').is_checked()
        assert not await row.locator('[data-field="paid"]').is_checked()
        await row.locator('[data-field="checkedIn"]').check()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('All roster changes saved')")
        await click_with_confirmation(page, "#startTournament")
        assert "needs a team tag and partner" in await page.locator("#startFeedback").inner_text()
        assert await page.evaluate("JSON.parse(testDocs.get('blakeoutDevTournaments/selfjoin-integration').matches).length") == 0
        await row.locator('[data-field="name"]').fill("Organizer tournament name")
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#publicRoster').textContent.includes('Organizer tournament name')")
        await row.locator("button:not([data-move])").click()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Join tournament'")
        assert not await page.evaluate("testDocs.has('blakeoutDevSignups/selfjoin-integration/players/verified_owner')")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Already registered'")
        count = await page.evaluate("""async () => {
            const p=await import('/js/platform.js');
            const first=await p.getTournament('selfjoin-integration');
            const second=await p.joinTournament(first.id);
            if(first.revision!==second.revision)throw Error('Duplicate join increments revision');
            return second.registrations.filter(r=>r.playerId==='verified_owner').length;
        }""")
        assert count == 1
        # A second verified user joins through the public UI, not an organizer update.
        await page.evaluate("changeTestUser({uid:'verified_joiner',emailVerified:true,isAnonymous:false})")
        await page.wait_for_function("!document.querySelector('#joinTournament').disabled")
        await page.locator("#joinTournament").click()
        await page.wait_for_function("document.querySelector('#joinTournament').textContent==='Already registered'")
        assert "Verified Arrival" in await page.locator("#publicRoster").inner_text()
        assert await page.locator("#rosterRows input").count() == 0
        assert await page.locator("#rosterPanel").is_hidden()
        assert await page.evaluate("""() => JSON.parse(testDocs.get('blakeoutDevTournaments/selfjoin-integration').registrations)
            .every(r=>!('paid' in r)&&!('checkedIn' in r)&&!('standby' in r))""")
        return "real join API: organizer/player entry, physical check-in, merged revisions, dirty conflicts, edit/remove/rejoin/idempotence"
    finally:
        await context.close()


async def test_real_guest_selfjoin_and_race(browser, base):
    context, page = await actual_join_page(browser, base)
    try:
        await page.evaluate("changeTestUser(null)")
        await page.wait_for_function("document.querySelector('#rosterPanel').hidden&&!document.querySelector('#guestJoinName').disabled")
        await page.fill("#guestJoinName", "Device Guest")
        await page.evaluate("window.testOffline=true")
        await page.locator("#joinGuest").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Offline')")
        assert "Device Guest" not in await page.locator("#publicRoster").inner_text()
        await page.evaluate("window.testOffline=false")
        await page.locator("#joinGuest").click()
        await page.wait_for_function("document.querySelector('#joinGuest').textContent==='Guest already registered'")
        assert "Device Guest" in await page.locator("#publicRoster").inner_text()
        assert await page.locator("#rosterRows input").count() == 0
        guest = await page.evaluate("""async () => {
            const p=await import('/js/platform.js');
            const result=await p.joinTournamentAsGuest('selfjoin-integration','Device Guest');
            const repeated=await p.joinTournamentAsGuest('selfjoin-integration','Device Guest');
            if(result.registrationId!==repeated.registrationId)throw Error('Guest ID is not stable');
            let rejected=false;
            try{await p.joinTournamentAsGuest('selfjoin-integration','Another guest');}
            catch(error){rejected=true;}
            if(!rejected)throw Error('Different shared-device guest name must require organizer assistance');
            return repeated.tournament.registrations.find(r=>r.id===result.registrationId);
        }""")
        assert guest["playerId"] is None and guest["checkedIn"] is False and guest["paid"] is False
        await page.evaluate("changeTestUser({uid:'verified_owner',emailVerified:true,isAnonymous:false})")
        await page.wait_for_function("!document.querySelector('#rosterControls').disabled")
        row = page.locator("#rosterRows tr").filter(has=page.locator(f'[data-field="name"][aria-label="Display name for {guest["name"]}"]'))
        await row.locator("button:not([data-move])").click()
        await page.locator("#saveRoster").click()
        await page.wait_for_function("!document.querySelector('#publicRoster').textContent.includes('Device Guest')")
        await page.fill("#guestJoinName", "Device Guest Rejoined")
        await page.locator("#joinGuest").click()
        await page.wait_for_function("document.querySelector('#publicRoster').textContent.includes('Device Guest Rejoined')")
        # Inject a real device signup between an owner's transaction read and commit.
        await page.locator('#rosterRows [data-field="name"]').first.fill("Race draft retained")
        await page.evaluate("""() => {
            window.testTransactionHook=async ()=>{
                const p=await import('/js/platform.js');
                const apps=await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
                const auth=await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js');
                const guestApp=apps.getApps().find(a=>a.name!=='[DEFAULT]'&&a.name!=='blakeout-dev-accounts');
                await auth.signOut(auth.getAuth(guestApp));
                window.testGuestUid='guest_device_concurrent';
                await auth.signInAnonymously(auth.getAuth(guestApp));
                await p.joinTournamentAsGuest('selfjoin-integration','Concurrent Device Guest');
            };
        }""")
        await page.locator("#saveRoster").click()
        await page.wait_for_function("document.querySelector('#message').textContent.includes('changed')")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Race draft retained"
        await page.locator("#refresh").click()
        await page.wait_for_function("document.querySelector('#publicRoster').textContent.includes('Concurrent Device Guest')")
        assert await page.locator('#rosterRows [data-field="name"]').first.input_value() == "Race draft retained"
        assert await page.evaluate("import('/js/platform.js').then(p=>p.getAccount().uid)") == "verified_owner"
        await click_with_confirmation(page, "#discard")
        await page.wait_for_function("document.querySelector('#discard').hidden")
        await click_with_confirmation(page, "#startTournament")
        await page.wait_for_function("document.querySelector('#message').textContent.includes('Tournament started')")
        assert await page.locator("#guestJoinName").is_disabled()
        closed = await page.evaluate("""async () => {
            const p=await import('/js/platform.js');
            const repeated=await p.joinTournamentAsGuest('selfjoin-integration','Concurrent Device Guest');
            const apps=await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js');
            const auth=await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js');
            const guestApp=apps.getApps().find(a=>a.name==='blakeout-dev-guests');
            window.testGuestUid='guest_new_after_start';
            await auth.signInAnonymously(auth.getAuth(guestApp));
            let newGuestRejected=false,newAccountRejected=false;
            try{await p.joinTournamentAsGuest('selfjoin-integration','Late Guest');}
            catch(error){newGuestRejected=error.message.includes('closed');}
            try{await p.joinTournament('selfjoin-integration');}
            catch(error){newAccountRejected=error.message.includes('closed');}
            return {status:repeated.tournament.status,newGuestRejected,newAccountRejected};
        }""")
        assert closed == {"status": "live", "newGuestRejected": True, "newAccountRejected": True}
        return "real anonymous guest API: offline honesty, no stats identity, remove/rejoin, racing owner commit, isolated auth and closed-event retries"
    finally:
        await context.close()


TESTS = {
    "owner_roster": test_owner_roster,
    "start_feedback": test_start_feedback,
    "start_pending_and_failure": test_start_pending_and_failure,
    "start_account_switch": test_start_account_switch,
    "roster_counts": test_roster_counts,
    "event_name_labels": test_event_name_labels,
    "roster_order": test_roster_order,
    "bulk_flags_and_odd_warning": test_bulk_flags_and_odd_warning,
    "failures_and_polling": test_failures_and_polling,
    "spectator_and_layout": test_spectator_and_layout,
    "manual_results_and_history": test_manual_results_and_history,
    "creation_and_launch": test_creation_and_launch,
    "manual_reset": test_manual_reset,
    "redacted_preview": test_redacted_preview,
    "immediate_self_join": test_immediate_self_join,
    "owner_join_and_concurrent_arrivals": test_owner_join_and_concurrent_arrivals,
    "join_closed_and_start_race": test_join_closed_and_start_race,
    "six_games_create_and_launch": test_six_games_create_and_launch,
    "immediate_guest_join": test_immediate_guest_join,
    "real_platform_adapter": test_real_platform_adapter,
    "real_verified_selfjoin": test_real_verified_selfjoin,
    "real_guest_selfjoin_and_race": test_real_guest_selfjoin_and_race,
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
