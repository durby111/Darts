import {
    initPlatform, subscribeAccount, getAccount, sendAccountLink, completeAccountLink,
    isAccountLink, pendingAccountEmail, signOutAccount, saveProfile, getProfile, listMyResults,
    registerAccount, signInAccount, sendAccountVerification, resetAccountPassword, refreshAccount
} from './platform.js';
import { GAME_REGISTRY } from './registry.js';

const $ = id => document.getElementById(id);
let records = [];
let accountGeneration = 0;
let renderedAccount;
let accountSession = 0;
let recordRequest = 0;
let verificationRefresh = null;
const operations = new Set();
const buttonOwners = new Map();

function status(message, error = false) {
    $('accountStatus').textContent = message;
    $('accountStatus').classList.toggle('platform-error', error);
    $('accountStatus').setAttribute('role', error ? 'alert' : 'status');
}

function showError(error) {
    const code = error.code ? `${error.code}: ` : '';
    status(`${code}${error.message || error} Check Firebase setup below if configuration or permissions are unavailable.`, true);
}

function finishOperation(operation) {
    operations.delete(operation);
    for (const button of operation.buttons) {
        if (buttonOwners.get(button) !== operation) continue;
        buttonOwners.delete(button);
        button.disabled = false;
    }
}

function beginOperation(buttons, nextAccount) {
    buttons = buttons.filter(Boolean);
    if (buttons.some(button => buttonOwners.has(button))) return null;
    const operation = { buttons, user: getAccount(), session: accountSession, nextAccount };
    operations.add(operation);
    for (const button of buttons) {
        buttonOwners.set(button, operation);
        button.disabled = true;
    }
    return operation;
}

function isCurrentOperation(operation) {
    return operations.has(operation) && operation.session === accountSession
        && operation.user === getAccount();
}

function accountForEmail(email) {
    const expected = email.trim().toLowerCase();
    return user => !!user && !user.isAnonymous && user.email?.toLowerCase() === expected;
}

async function action(button, callback, nextAccount) {
    const operation = beginOperation([button], nextAccount);
    if (!operation) return;
    const isCurrent = () => isCurrentOperation(operation);
    try { await callback(isCurrent); }
    catch (error) { if (isCurrent()) showError(error); }
    finally { finishOperation(operation); }
}

function renderRecords(uid) {
    const summary = {};
    $('records').replaceChildren();
    for (const record of records) {
        const item = document.createElement('p');
        item.style.overflowWrap = 'anywhere';
        const date = typeof record.createdAt === 'number'
            ? new Date(record.createdAt).toLocaleDateString() : '';
        const source = record.source === 'casual' ? 'Casual · scorekeeper-recorded' : 'Tournament · organizer-recorded';
        item.textContent = `${date} · ${source} · ${record.gameType} · Match ${record.matchId}`;
        $('records').append(item);
        const seenGames = new Set();
        for (const player of record.perPlayer || []) {
            if ((player.playerId || player.id) !== uid) continue;
            const type = player.gameType || record.gameType;
            const game = summary[type] ||= { matches: 0, points: 0, marks: 0, darts: 0 };
            if (!seenGames.has(type)) game.matches += 1;
            seenGames.add(type);
            game.points += Number(player.points || 0);
            game.marks += Number(player.marks || 0);
            game.darts += Number(player.darts || 0);
        }
    }
    $('lifetimeSummary').replaceChildren();
    for (const [type, counters] of Object.entries(summary)) {
        const item = document.createElement('p');
        const cricket = ['cricket', 'teamcricket'].includes(GAME_REGISTRY.find(game => game.id === type)?.engine);
        const rate = counters.darts ? ((cricket ? counters.marks * 3 : counters.points) / counters.darts).toFixed(2) : '—';
        item.textContent = `${type}: ${counters.matches} matches · ${counters.darts} actual darts · ${cricket ? counters.marks + ' marks' : counters.points + ' points'} · ${rate} ${cricket ? 'MPR' : 'PPD'}`;
        $('lifetimeSummary').append(item);
    }
    if (!records.length) $('records').textContent = 'No recorded matches for this verified player ID yet.';
    $('exportRecords').disabled = false;
}

async function refreshRecords() {
    const user = getAccount();
    const uid = user?.uid;
    const generation = accountGeneration;
    const request = ++recordRequest;
    const isCurrent = () => generation === accountGeneration && getAccount() === user
        && request === recordRequest;
    let loaded;
    try { loaded = await listMyResults(); }
    catch (error) { if (isCurrent()) throw error; return; }
    if (!isCurrent()) return;
    records = loaded.sort((a, b) => b.createdAt - a.createdAt);
    renderRecords(uid);
}

async function renderAccount(user) {
    if (renderedAccount !== user) {
        renderedAccount = user;
        accountSession += 1;
        $('accountPassword').value = '';
        for (const operation of operations) {
            // Login and logout may own one expected identity transition. An
            // unrelated account change releases the old UI without cancelling
            // or retrying the provider request itself.
            if (operation.nextAccount?.(user)) {
                operation.user = user;
                operation.session = accountSession;
                operation.nextAccount = null;
            } else finishOperation(operation);
        }
    }
    const generation = ++accountGeneration;
    const signedIn = !!user && !user.isAnonymous;
    const verified = signedIn && user.emailVerified;
    $('signInPanel').hidden = signedIn;
    $('verificationPanel').hidden = !signedIn || verified;
    $('accountControls').hidden = !signedIn;
    $('verificationIdentity').textContent = signedIn && !verified ? `Signed in as ${user.email}` : '';
    $('profilePanel').hidden = !verified;
    $('recordsPanel').hidden = !verified;
    $('identity').textContent = '';
    $('displayName').value = '';
    $('records').replaceChildren();
    $('lifetimeSummary').replaceChildren();
    $('exportRecords').disabled = true;
    records = [];
    if (!verified) {
        status(signedIn
            ? 'You are signed in, but your email is not verified. Verify it before accessing profiles, records, or organizer actions.'
            : 'Sign in with email and password, or create an account and verify your email.');
        return;
    }
    $('identity').textContent = `${user.email} · Your stable player ID: ${user.uid}`;
    status('Signed in with a verified email address.');
    try {
        const profile = await getProfile();
        if (generation !== accountGeneration || getAccount() !== user) return;
        $('displayName').value = profile?.name || '';
        await refreshRecords();
    } catch (error) {
        if (generation === accountGeneration && getAccount() === user) showError(error);
    }
}

async function passwordAuth(create) {
    if (!$('passwordForm').reportValidity()) return;
    const email = $('accountEmail').value;
    const buttons = ['passwordSignIn', 'passwordRegister', 'passwordReset'];
    if (create) buttons.push('sendVerification');
    const operation = beginOperation(buttons.map($), accountForEmail(email));
    if (!operation) return;
    try {
        if (create) {
            await registerAccount(email, $('accountPassword').value);
            if (isCurrentOperation(operation)) status('Account created. Check your verification email, then return here. Private features remain locked until verification.');
        } else {
            await signInAccount(email, $('accountPassword').value);
        }
    } catch (error) { if (isCurrentOperation(operation)) showError(error); }
    finally {
        if (isCurrentOperation(operation)) $('accountPassword').value = '';
        finishOperation(operation);
    }
}

async function refreshVerificationOnReturn() {
    const user = getAccount();
    if (!user || user.isAnonymous || user.emailVerified || verificationRefresh?.user === user) return;
    const refresh = { user };
    verificationRefresh = refresh;
    try { await refreshAccount(); }
    catch (error) { if (getAccount() === user) showError(error); }
    finally { if (verificationRefresh === refresh) verificationRefresh = null; }
}

$('passwordForm').addEventListener('submit', event => {
    event.preventDefault();
    passwordAuth(false);
});
$('passwordRegister').addEventListener('click', () => passwordAuth(true));
$('passwordReset').addEventListener('click', () => {
    if (!$('accountEmail').reportValidity()) return;
    action($('passwordReset'), async isCurrent => {
        await resetAccountPassword($('accountEmail').value);
        if (isCurrent()) status('If this email has a password account, check its inbox for password-reset instructions.');
    });
});
$('sendVerification').addEventListener('click', () => action($('sendVerification'), async isCurrent => {
    await sendAccountVerification();
    if (isCurrent()) status('Verification email sent. Open it and return here to unlock your account.');
}));
$('refreshVerification').addEventListener('click', () => action($('refreshVerification'), refreshAccount));
window.addEventListener('focus', refreshVerificationOnReturn);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshVerificationOnReturn();
});

$('emailForm').addEventListener('submit', event => {
    event.preventDefault();
    action($('sendLink'), async isCurrent => {
        await sendAccountLink($('linkEmail').value);
        if (isCurrent()) status('Sign-in link sent. Check your inbox and open the link to verify your address.');
    });
});
$('completeLink').addEventListener('click', () => action($('completeLink'), async isCurrent => {
    await completeAccountLink($('linkEmail').value);
    if (!isCurrent()) return;
    $('completeLink').hidden = true;
    $('linkHelp').hidden = true;
    await renderAccount(getAccount());
}, accountForEmail($('linkEmail').value)));
$('profileForm').addEventListener('submit', event => {
    event.preventDefault();
    action(event.submitter || $('profileForm').querySelector('button[type="submit"]'), async isCurrent => {
        await saveProfile($('displayName').value);
        if (isCurrent()) status('Public display name saved to your verified player ID.');
    });
});
$('signOut').addEventListener('click', () => action($('signOut'), signOutAccount, user => !user));
$('refreshRecords').addEventListener('click', () => action($('refreshRecords'), refreshRecords));
$('exportRecords').addEventListener('click', () => {
    const user = getAccount();
    if (!user?.emailVerified || user.isAnonymous || renderedAccount !== user || $('exportRecords').disabled) return;
    const content = JSON.stringify({ format: 'blakeout-dev-results-v1', playerId: user.uid, exportedAt: new Date().toISOString(), results: records }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'blakeout-dev-my-results.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
    await initPlatform();
    for (const id of ['sendLink', 'passwordSignIn', 'passwordRegister', 'passwordReset']) $(id).disabled = false;
    subscribeAccount(renderAccount);
    if (isAccountLink()) {
        $('signInPanel').hidden = false;
        $('completeLink').hidden = false;
        $('linkHelp').hidden = false;
        $('emailLinkPanel').open = true;
        $('linkEmail').value = pendingAccountEmail();
        status('Email link detected. Confirm the receiving email address to finish sign-in.');
    } else await refreshVerificationOnReturn();
} catch (error) { showError(error); }
