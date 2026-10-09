/** Local-only DEV Start & Lock regression checks. No browser or provider calls.
 * Run: node --experimental-vm-modules dev/tests/start_lock_feedback_test.mjs
 * Requires the QA dependency jsdom; BLAKEOUT_JSDOM_MODULE may point to an existing
 * installed jsdom package. It is never imported by the application.
 * JSDOM cannot verify rendered layout, touch, screen readers or live Firebase.
 */
import assert from 'node:assert/strict';
import { fresh } from './brackets_dom_helpers.mjs';

let passed = 0;
async function test(name, fn, options) {
    const t = await fresh(options);
    try { await fn(t); passed++; console.log(`PASS ${name}`); }
    finally { t.dom.window.close(); }
}
function assertNoAttempt(t) {
    assert.equal(t.w.confirmations, 0);
    assert.equal(t.w.__api.calls.length, 0);
    assert.equal(t.w.__api.writes, 0);
    assert.equal(t.w.__api.docs.demo.matches.length, 0);
    assert.equal(t.w.__api.docs.demo.status, 'registration');
}
function assertPrivateFeedbackCleared(t) {
    assert.equal(t.get('startFeedback').hidden, true);
    assert.equal(t.get('startFeedbackReasons').children.length, 0);
    assert.equal(t.get('startFeedbackTitle').textContent, '');
    assert.equal(t.get('rosterRows').children.length, 0);
    assert.equal(t.get('startTournament').disabled, true);
    assert.notEqual(t.w.document.activeElement, t.get('bracketHeading'));
}

await test('shipped gate leaves feedback inert and never imports account/bracket code', async t => {
    assert.ok(t.get('featureUnavailableShell'));
    assert.ok(t.get('featurePageTemplate'));
    assert.equal(t.get('startTournament'), null);
    assert.equal(t.w.__api, undefined);
    assert.ok(![...t.modules.keys()].some(filename => /\/(platform|page)\.js$/.test(filename)));
}, { enabled: false });

await test('dirty and missing-pair blockers are focused, safe text, write-free and shuffle-free', async t => {
    t.input('#rosterRows [data-field="name"]', '<img src=x onerror=alert(1)>');
    t.input('#rosterRows [data-field="tag"]', '');
    let shuffles = 0;
    t.w.Math.random = () => { shuffles++; return .5; };
    assert.equal(t.get('startTournament').disabled, false);
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /Save all roster changes/);
    assert.match(t.get('startFeedback').textContent, /needs a team tag and partner/);
    assert.equal(t.get('startFeedback').querySelector('img'), null);
    assert.equal(t.w.document.activeElement, t.get('startFeedback'));
    assert.equal(shuffles, 0);
    assertNoAttempt(t);
    t.input('#rosterRows [data-field="tag"]', '1');
    assert.equal(t.get('startFeedback').hidden, true);
});

await test('invalid draft names do not confirm, shuffle or save', async t => {
    t.input('#rosterRows [data-field="name"]', '');
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /Player name/);
    assertNoAttempt(t);
});

await test('saved check-in and payment blockers preserve current eligibility', async t => {
    const row = t.w.__api.docs.demo.registrations[0];
    row.checkedIn = false;
    row.paid = false;
    t.w.__api.docs.demo.revision++;
    await t.refresh();
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /Player 1 must be checked in/);
    assert.match(t.get('startFeedback').textContent, /Player 1 must be marked paid/);
    assertNoAttempt(t);
});

await test('unpaid standby remains exempt and a ready start focuses the bracket', async t => {
    t.w.__api.docs.demo.registrations.push({
        id: 'standby', playerId: null, name: 'Unpaid standby', tag: '',
        paid: false, checkedIn: false, standby: true,
    });
    t.w.__api.docs.demo.revision++;
    await t.refresh();
    await t.click('startTournament');
    assert.equal(t.w.__api.writes, 1);
    assert.equal(t.w.__api.docs.demo.status, 'live');
    assert.equal(t.w.document.activeElement, t.get('bracketHeading'));
});

await test('cancellation remains unlocked and focus moves to the explanation', async t => {
    t.w.confirmResult = false;
    await t.click('startTournament');
    assert.equal(t.w.confirmations, 1);
    assert.equal(t.w.__api.calls.length, 0);
    assert.equal(t.w.__api.docs.demo.matches.length, 0);
    assert.match(t.get('startFeedback').textContent, /Start canceled/);
    assert.equal(t.w.document.activeElement, t.get('startFeedback'));
});

await test('pending repeated activation confirms, shuffles and commits once', async t => {
    t.w.__api.holdWrite = true;
    let randomCalls = 0;
    t.w.Math.random = () => { randomCalls++; return .5; };
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /Waiting for cloud confirmation/);
    assert.equal(t.get('startTournament').disabled, true);
    const shuffled = randomCalls;
    assert.ok(shuffled > 0);
    t.get('startTournament').dispatchEvent(new t.w.Event('click'));
    await t.settle();
    assert.equal(t.w.__api.calls.length, 1);
    assert.equal(t.w.confirmations, 1);
    assert.equal(randomCalls, shuffled);
    t.w.__api.releaseWrite();
    await t.settle();
    assert.equal(randomCalls, shuffled, 'Transaction retries reuse the original draw');
    assert.equal(t.w.__api.writes, 1);
    assert.equal(t.w.__api.docs.demo.status, 'live');
    assert.equal(t.get('rosterPanel').hidden, true);
    assert.equal(t.get('startFeedback').hidden, true);
    assert.equal(t.w.document.activeElement, t.get('bracketHeading'));
});

await test('failed/conflicting starts survive polling, preserve edits and retry once', async t => {
    const savedRoster = JSON.stringify(t.w.__api.docs.demo.registrations);
    t.w.__api.failWrite = true;
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /Start was not confirmed/);
    assert.match(t.get('startFeedback').textContent, /permission-denied/);
    assert.equal(t.w.__api.writes, 0);
    assert.equal(t.get('startTournament').disabled, false);
    await t.refresh();
    assert.match(t.get('message').textContent, /up to date/);
    assert.match(t.get('startFeedback').textContent, /permission-denied/);
    t.w.__api.failWrite = false;
    t.w.__api.conflict = true;
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /another device/);
    assert.equal(JSON.stringify(t.w.__api.docs.demo.registrations), savedRoster);
    assert.equal(t.w.__api.docs.demo.status, 'registration');
    t.w.__api.conflict = false;
    await t.click('startTournament');
    assert.equal(t.w.__api.writes, 1);
});

await test('bulk and order edits clear stale feedback without changing identity or pairs', async t => {
    t.w.confirmResult = false;
    await t.click('startTournament');
    const rows = t.w.__api.docs.demo.registrations.map(row => row.id);
    const teams = JSON.stringify(t.w.__api.docs.demo.teams);
    t.input('[data-bulk-field="paid"]', false);
    assert.equal(t.get('startFeedback').hidden, true);
    await t.click('startTournament');
    assert.match(t.get('startFeedback').textContent, /Save all roster changes/);
    assert.match(t.get('startFeedback').textContent, /marked paid/);
    t.w.document.querySelector('[data-move="down"]').click();
    await t.settle();
    assert.equal(t.get('startFeedback').hidden, true);
    assert.equal(JSON.stringify(t.w.__api.docs.demo.teams), teams);
    assert.deepEqual(Array.from(t.w.document.querySelectorAll('#rosterRows tr'), row => row.dataset.registration),
        [rows[1], rows[0], ...rows.slice(2)]);
    assert.equal(t.w.__api.writes, 0);
});

await test('signout clears owner-only blocker contents and controls', async t => {
    t.input('#rosterRows [data-field="tag"]', '');
    await t.click('startTournament');
    t.w.__api.account = null;
    t.w.__api.accountChanged(null);
    await t.settle();
    assertPrivateFeedbackCleared(t);
});

await test('late failed start cannot repopulate feedback or steal focus after signout', async t => {
    t.w.__api.holdWrite = true;
    await t.click('startTournament');
    t.w.__api.account = null;
    t.w.__api.accountChanged(null);
    const navLink = t.w.document.querySelector('.platform-header a');
    navLink.focus();
    assert.equal(t.w.document.activeElement, navLink);
    t.w.__api.failWrite = true;
    t.w.__api.releaseWrite();
    await t.settle();
    assertPrivateFeedbackCleared(t);
    assert.equal(t.w.document.activeElement, navLink);
    assert.equal(t.w.__api.writes, 0);
});

await test('late successful response after owner switch stays private and never steals focus', async t => {
    t.w.__api.holdResponse = true;
    await t.click('startTournament');
    assert.equal(t.w.__api.writes, 1, 'Server committed before the response was delayed');
    assert.equal(typeof t.w.__api.releaseResponse, 'function');
    t.w.__api.account = { uid: 'different-owner', emailVerified: true, isAnonymous: false };
    t.w.__api.accountChanged(t.w.__api.account);
    const navLink = t.w.document.querySelector('.platform-header a');
    navLink.focus();
    assert.equal(t.w.document.activeElement, navLink);
    t.w.__api.releaseResponse();
    await t.settle();
    assertPrivateFeedbackCleared(t);
    assert.equal(t.w.document.activeElement, navLink);
    assert.equal(t.w.__api.writes, 1);
});

console.log(`${passed}/${passed} Start & Lock DOM checks passed; no layout, touch, live account or deployment claims`);
