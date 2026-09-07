import {
    initPlatform, subscribeAccount, getAccount, sendAccountLink, completeAccountLink,
    isAccountLink, pendingAccountEmail, signOutAccount, saveProfile, getProfile, listMyResults,
    registerAccount, signInAccount, sendAccountVerification, resetAccountPassword, refreshAccount
} from './platform.js';

const $ = id => document.getElementById(id);
let records = [];
let accountGeneration = 0;
let credentialsBusy = false;
let verificationRefresh = null;

function status(message, error = false) {
    $('accountStatus').textContent = message;
    $('accountStatus').classList.toggle('platform-error', error);
    $('accountStatus').setAttribute('role', error ? 'alert' : 'status');
}

function showError(error) {
    const code = error.code ? `${error.code}: ` : '';
    status(`${code}${error.message || error} Check Firebase setup below if configuration or permissions are unavailable.`, true);
}

async function action(button, callback) {
    button.disabled = true;
    try { await callback(); } catch (error) { showError(error); }
    finally { button.disabled = false; }
}

function renderRecords(uid) {
    const summary = {};
    $('records').replaceChildren();
    for (const record of records) {
        const item = document.createElement('p');
        const date = typeof record.createdAt === 'number'
            ? new Date(record.createdAt).toLocaleDateString() : '';
        item.textContent = `${date} · ${record.gameType} · Match ${record.matchId}`;
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
        const cricket = ['cricket', 'spanish'].includes(type);
        const rate = counters.darts ? ((cricket ? counters.marks * 3 : counters.points) / counters.darts).toFixed(2) : '—';
        item.textContent = `${type}: ${counters.matches} matches · ${counters.darts} actual darts · ${cricket ? counters.marks + ' marks' : counters.points + ' points'} · ${rate} ${cricket ? 'MPR' : 'PPD'}`;
        $('lifetimeSummary').append(item);
    }
    if (!records.length) $('records').textContent = 'No recorded tournament matches for this verified player ID yet.';
    $('exportRecords').disabled = false;
}

async function refreshRecords() {
    const uid = getAccount()?.uid;
    const generation = accountGeneration;
    const loaded = await listMyResults();
    if (generation !== accountGeneration || getAccount()?.uid !== uid) return;
    records = loaded.sort((a, b) => b.createdAt - a.createdAt);
    renderRecords(uid);
}

async function renderAccount(user) {
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
        if (generation !== accountGeneration) return;
        $('displayName').value = profile?.name || '';
        await refreshRecords();
    } catch (error) {
        if (generation === accountGeneration) showError(error);
    }
}

async function passwordAuth(create) {
    if (credentialsBusy || !$('passwordForm').reportValidity()) return;
    credentialsBusy = true;
    for (const id of ['passwordSignIn', 'passwordRegister', 'passwordReset']) $(id).disabled = true;
    try {
        if (create) {
            await registerAccount($('accountEmail').value, $('accountPassword').value);
            status('Account created. Check your verification email, then return here. Private features remain locked until verification.');
        } else {
            await signInAccount($('accountEmail').value, $('accountPassword').value);
        }
    } catch (error) { showError(error); }
    finally {
        $('accountPassword').value = '';
        credentialsBusy = false;
        for (const id of ['passwordSignIn', 'passwordRegister', 'passwordReset']) $(id).disabled = false;
    }
}

async function refreshVerificationOnReturn() {
    const user = getAccount();
    if (!user || user.isAnonymous || user.emailVerified || verificationRefresh) return;
    verificationRefresh = refreshAccount().catch(showError);
    try { await verificationRefresh; } finally { verificationRefresh = null; }
}

$('passwordForm').addEventListener('submit', event => {
    event.preventDefault();
    passwordAuth(false);
});
$('passwordRegister').addEventListener('click', () => passwordAuth(true));
$('passwordReset').addEventListener('click', () => {
    if (!$('accountEmail').reportValidity()) return;
    action($('passwordReset'), async () => {
        await resetAccountPassword($('accountEmail').value);
        status('If this email has a password account, check its inbox for password-reset instructions.');
    });
});
$('sendVerification').addEventListener('click', () => action($('sendVerification'), async () => {
    await sendAccountVerification();
    status('Verification email sent. Open it and return here to unlock your account.');
}));
$('refreshVerification').addEventListener('click', () => action($('refreshVerification'), refreshAccount));
window.addEventListener('focus', refreshVerificationOnReturn);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshVerificationOnReturn();
});

$('emailForm').addEventListener('submit', event => {
    event.preventDefault();
    action($('sendLink'), async () => {
        await sendAccountLink($('linkEmail').value);
        status('Sign-in link sent. Check your inbox and open the link to verify your address.');
    });
});
$('completeLink').addEventListener('click', () => action($('completeLink'), async () => {
    await completeAccountLink($('linkEmail').value);
    $('completeLink').hidden = true;
    $('linkHelp').hidden = true;
    await renderAccount(getAccount());
}));
$('profileForm').addEventListener('submit', event => {
    event.preventDefault();
    action(event.submitter, async () => {
        await saveProfile($('displayName').value);
        status('Public display name saved to your verified player ID.');
    });
});
$('signOut').addEventListener('click', () => action($('signOut'), signOutAccount));
$('refreshRecords').addEventListener('click', () => action($('refreshRecords'), refreshRecords));
$('exportRecords').addEventListener('click', () => {
    const user = getAccount();
    if (!user?.emailVerified) return;
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
