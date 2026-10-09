/** Actual bracket + shared-dialog modules; interrupted async flows, mocked
 * storage boundary. NodeVM/JSDOM only: no browser, account or layout proof.
 */
import assert from 'node:assert/strict';
import { fresh } from './brackets_dom_helpers.mjs';

const cases = [
    ['start', 'Start this tournament? This shuffles the draw once and permanently locks the roster.'],
    ['openTournament', 'Discard unsaved edits and open another tournament?'],
    ['create', 'Discard unsaved edits and create a new tournament?'],
    ['saveResult', 'Save this manual match result? No per-dart or lifetime statistics will be created or adjusted.'],
    ['openResult', 'Discard the unsaved result entry?'],
    ['closeResult', 'Discard the unsaved result entry?'],
    ['launch', 'Discard unsaved manual scores and launch the scorer?'],
    ['discard', 'Discard your unsaved edits and reload from cloud?'],
];
const resultCases = new Set(['saveResult', 'openResult', 'closeResult', 'launch']);
const dialog = t => t.w.document.querySelector('dialog.platform-confirm');
const submit = (t, name) => t.get(name).dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
async function prepare(t, name) {
    if (resultCases.has(name)) {
        t.w.__api.docs.demo = t.w.__api.fixture(4, 'live');
        await t.refresh({ discard: true });
        t.w.document.querySelector('.match-action').click();
        await t.settle();
        t.input('#scoreA', '2');
        t.input('#scoreB', '0');
    } else if (name !== 'start') t.input('#rosterRows [data-field="name"]', 'Unsaved tournament name');
    if (name === 'create') {
        t.get('createPanel').open = true;
        t.input('#title', 'New tournament');
        t.input('#date', '2026-10-10');
    }
    const trigger = () => {
        if (name === 'start') t.get('startTournament').click();
        else if (name === 'openTournament') t.w.document.querySelector('.tournament-link').click();
        else if (name === 'create') submit(t, 'createForm');
        else if (name === 'saveResult') submit(t, 'resultForm');
        else if (name === 'openResult') t.w.document.querySelectorAll('.match-action')[1].click();
        else t.get({ closeResult: 'closeResult', launch: 'launchScorer', discard: 'discard' }[name]).click();
    };
    return trigger;
}
function unchangedCloud(t, before) {
    assert.equal(t.w.__api.writes, 0);
    assert.equal(t.w.__api.calls.length, 0);
    assert.equal(t.w.__api.statsWrites, 0);
    if (before) assert.equal(JSON.stringify(t.w.__api.docs), before);
    assert.equal(t.w.localStorage.getItem('blakeout_dev_match_launch'), null);
}
let passed = 0;
async function test(name, run) {
    const t = await fresh({ autoConfirm: false });
    try { await run(t); passed++; console.log(`PASS ${name}`); }
    finally { t.w.close(); }
}
for (const [name, message] of cases) {
    await test(`${name}: real pending dialog, wording, duplicate, Cancel/Close/Escape`, async t => {
        const trigger = await prepare(t, name);
        const before = JSON.stringify(t.w.__api.docs);
        const resultHeading = t.get('resultHeading').textContent;
        for (const dismissal of ['cancel', 'close', 'escape']) {
            trigger();
            await t.settle();
            assert.ok(dialog(t));
            assert.equal(dialog(t).querySelector('.platform-confirm-message').textContent, message);
            assert.equal(t.w.document.activeElement, dialog(t).querySelector('.platform-confirm-cancel'));
            unchangedCloud(t, before);
            const count = t.w.confirmations;
            trigger();
            await t.settle();
            assert.equal(t.w.confirmations, count, 'Repeated activation must not open another dialog');
            assert.equal(t.w.document.querySelectorAll('dialog.platform-confirm').length, 1);
            if (dismissal === 'escape') t.w.document.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            else dialog(t).querySelector(`.platform-confirm-${dismissal}`).click();
            await t.settle();
            assert.equal(dialog(t), null);
            unchangedCloud(t, before);
            if (resultCases.has(name)) {
                assert.equal(t.get('scoreA').value, '2');
                assert.equal(t.get('resultHeading').textContent, resultHeading);
                assert.equal(t.get('resultPanel').hidden, false);
            }
            else if (name !== 'start') assert.equal(t.w.document.querySelector('#rosterRows [data-field="name"]').value, 'Unsaved tournament name');
        }
    });
    for (const interruption of ['signout', 'sameUidSession', 'poll', 'edit', 'navigation', 'betweenAwaits']) {
        await test(`${name}: rejects ${interruption} while awaiting approval`, async t => {
            const trigger = await prepare(t, name);
            trigger();
            await t.settle();
            assert.ok(dialog(t));
            const oldAccept = dialog(t).querySelector('.platform-confirm-accept');
            const headerLink = t.w.document.querySelector('.platform-header a');
            if (interruption === 'signout') {
                t.w.__api.account = null;
                t.w.__api.accountChanged(null);
            } else if (interruption === 'sameUidSession') {
                const previous = t.w.__api.account;
                t.w.__api.account = null;
                t.w.__api.accountChanged(null);
                t.w.__api.account = { ...previous };
                t.w.__api.accountChanged(t.w.__api.account);
            } else if (interruption === 'poll') {
                t.w.__api.docs.demo.revision++;
                await t.refresh();
            } else if (interruption === 'edit') {
                if (resultCases.has(name)) t.input('#scoreA', '0');
                else if (name === 'create') t.input('#title', 'Changed after prompt opened');
                else t.input('#rosterRows [data-field="name"]', 'Changed while dialog open');
            } else if (interruption === 'navigation') {
                t.w.dispatchEvent(new t.w.PopStateEvent('popstate'));
            } else {
                oldAccept.click();
                // The inner confirmCurrent continuation runs first; invalidate
                // between its resolution and the outer event handler resuming.
                queueMicrotask(() => {
                    t.w.__api.account = { uid: 'replacement', emailVerified: true, isAnonymous: false };
                    t.w.__api.accountChanged(t.w.__api.account);
                    headerLink.focus();
                });
            }
            await t.settle();
            headerLink.focus();
            oldAccept.click();
            await t.settle();
            assert.equal(dialog(t), null);
            unchangedCloud(t);
            assert.equal(t.w.document.activeElement, headerLink, 'Obsolete prompt must not steal focus');
            if (['signout', 'betweenAwaits'].includes(interruption)) {
                assert.equal(t.get('startFeedback').hidden, true);
                assert.equal(t.get('startFeedbackReasons').children.length, 0);
                assert.equal(t.get('rosterRows').children.length, 0);
            }
        });
    }
}

await test('manual approval saves its exact validated payload once', async t => {
    const trigger = await prepare(t, 'saveResult');
    trigger();
    await t.settle();
    assert.equal(t.w.__api.calls.length, 0);
    await t.respond(true);
    assert.equal(t.w.__api.writes, 1);
    assert.equal(t.w.__api.calls.length, 1);
    assert.equal(t.w.__api.statsWrites, 0);
    const completed = t.w.__api.docs.demo.matches.filter(match => match.status === 'complete');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].scoreA, 2);
    assert.equal(completed[0].scoreB, 0);
});
await test('manual raw form changes without events cannot reuse approval', async t => {
    const trigger = await prepare(t, 'saveResult');
    trigger();
    await t.settle();
    t.get('scoreA').value = '0';
    t.get('scoreB').value = '2';
    await t.respond(true);
    unchangedCloud(t);
    assert.equal(t.get('scoreA').value, '0');
    assert.equal(t.get('scoreB').value, '2');
});
await test('approved creation and tournament reload preserve requested behavior', async t => {
    let trigger = await prepare(t, 'openTournament');
    trigger(); await t.settle(); await t.respond(true);
    assert.equal(t.w.document.querySelector('#rosterRows [data-field="name"]').value, 'Player 1');
    trigger = await prepare(t, 'create');
    trigger(); await t.settle(); await t.respond(true);
    assert.equal(t.w.__api.writes, 1);
    assert.equal(t.get('tournamentTitle').textContent, 'New tournament');
    assert.equal(Object.keys(t.w.__api.docs).length, 2);
});
await test('approved result switching and closing discard only the selected draft', async t => {
    const trigger = await prepare(t, 'openResult');
    const before = t.get('resultHeading').textContent;
    trigger(); await t.settle(); await t.respond(true);
    assert.notEqual(t.get('resultHeading').textContent, before);
    assert.equal(t.get('scoreA').value, '');
    t.input('#scoreA', '2');
    t.get('closeResult').click(); await t.settle(); await t.respond(true);
    assert.equal(t.get('resultPanel').hidden, true);
    unchangedCloud(t);
});
await test('discard read cannot erase edits made after approval', async t => {
    const trigger = await prepare(t, 'discard');
    trigger(); await t.settle();
    t.w.__api.holdRead = true;
    await t.respond(true);
    assert.equal(typeof t.w.__api.releaseRead, 'function');
    t.input('#rosterRows [data-field="name"]', 'Keep this newer draft');
    t.w.__api.releaseRead();
    await t.settle();
    assert.equal(t.w.document.querySelector('#rosterRows [data-field="name"]').value, 'Keep this newer draft');
    unchangedCloud(t);
});
await test('launch follow-up read cannot write local launch state after account change', async t => {
    const trigger = await prepare(t, 'launch');
    trigger(); await t.settle();
    t.w.__api.holdRead = true;
    await t.respond(true);
    t.w.__api.account = null;
    t.w.__api.accountChanged(null);
    t.w.__api.releaseRead();
    await t.settle();
    unchangedCloud(t);
});
for (const name of ['discard', 'openTournament', 'launch']) {
    for (const stale of [false, true]) {
        await test(`${name}: delayed rejected read ${stale ? 'cannot replace a new account notice' : 'shows a current error'}`, async t => {
            const trigger = await prepare(t, name);
            trigger(); await t.settle();
            t.w.__api.holdRead = true;
            await t.respond(true);
            assert.equal(typeof t.w.__api.rejectRead, 'function');
            if (stale) {
                t.w.__api.account = null;
                t.w.__api.accountChanged(null);
                t.get('message').textContent = 'Replacement screen notice';
            }
            t.w.__api.rejectRead(new Error('Delayed test network failure'));
            await t.settle();
            if (stale) assert.equal(t.get('message').textContent, 'Replacement screen notice');
            else assert.match(t.get('message').textContent, /Delayed test network failure/);
            unchangedCloud(t);
        });
    }
}
await test('same-UID session object replacement without an intermediate signout cancels approval', async t => {
    const trigger = await prepare(t, 'start');
    trigger(); await t.settle();
    const oldButton = dialog(t).querySelector('.platform-confirm-accept');
    t.w.__api.account = { ...t.w.__api.account };
    t.w.__api.accountChanged(t.w.__api.account);
    oldButton.click();
    await t.settle();
    assert.equal(dialog(t), null);
    unchangedCloud(t);
});
await test('unchanged polling keeps a current confirmation open and approval usable', async t => {
    const trigger = await prepare(t, 'start');
    trigger(); await t.settle();
    const originalDialog = dialog(t);
    await t.refresh();
    assert.equal(dialog(t), originalDialog);
    await t.respond(true);
    assert.equal(t.w.__api.writes, 1);
    assert.equal(t.w.__api.docs.demo.status, 'live');
});
await test('discard can reload a known newer cloud revision after reviewing again', async t => {
    const trigger = await prepare(t, 'discard');
    t.w.__api.docs.demo.revision++;
    t.w.__api.docs.demo.registrations[0].name = 'Latest cloud name';
    await t.refresh();
    assert.equal(t.w.document.querySelector('#rosterRows [data-field="name"]').value, 'Unsaved tournament name');
    trigger(); await t.settle(); await t.respond(true);
    assert.equal(t.w.document.querySelector('#rosterRows [data-field="name"]').value, 'Latest cloud name');
    assert.equal(t.get('discard').hidden, true);
    unchangedCloud(t);
});
await test('raw roster fields changed without events cannot reuse a start approval', async t => {
    const trigger = await prepare(t, 'start');
    trigger(); await t.settle();
    t.w.document.querySelector('#rosterRows [data-field="paid"]').checked = false;
    await t.respond(true);
    unchangedCloud(t);
});
console.log(`${passed}/${passed} asynchronous bracket confirmation groups passed; no live/browser/layout claims`);
