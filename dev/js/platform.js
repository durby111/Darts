// Dev accounts deliberately use a named app, never the scorer's anonymous auth.
import { ACCOUNT_EMAIL_SERVICE_URL } from './account-email-config.js';
import { sendAccountEmail } from './account-email.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.13.2';
const APP_NAME = 'blakeout-dev-accounts';
const EMAIL_KEY = 'blakeout_dev_email_link';
const CASUAL_GAME_PATTERN = /^(301|501|701|801|901|1101|1501|cricket|spanish|minnesota|chaos|quickie|cutthroat|wildcard|hammer|teamhammer|chicago|121|baseball|bermuda|golf|shanghai|countup|gotcha|sharktank|tictactoe|robinhood|doubledown|teamcricket)$/;
const COLLECTIONS = Object.freeze({
    profiles: 'blakeoutDevProfiles',
    tournaments: 'blakeoutDevTournaments',
    rosterPrivate: 'blakeoutDevRosterPrivate',
    results: 'blakeoutDevResults',
    signupState: 'blakeoutDevSignupState',
    casualResults: 'blakeoutDevCasualResults'
});
const listeners = new Set();
let initialization, auth, db, authSDK, storeSDK, account = null;
let guestInitialization;

function publishAccount(user) {
    account = user;
    for (const callback of listeners) {
        try { callback(user); } catch (error) { console.error('Account listener failed', error); }
    }
}

export async function initPlatform() {
    if (!initialization) {
        initialization = (async () => {
            const [config, apps, authentication, firestore] = await Promise.all([
                import('./firebase-config.js'),
                import(`${SDK_BASE}/firebase-app.js`),
                import(`${SDK_BASE}/firebase-auth.js`),
                import(`${SDK_BASE}/firebase-firestore.js`)
            ]);
            if (!config.firebaseConfig?.apiKey || !config.firebaseConfig?.projectId) {
                throw new Error('Firebase configuration is missing. Check dev/js/firebase-config.js.');
            }
            const app = apps.getApps().find(item => item.name === APP_NAME)
                || apps.initializeApp(config.firebaseConfig, APP_NAME);
            authSDK = authentication;
            storeSDK = firestore;
            auth = authentication.getAuth(app);
            await authentication.setPersistence(auth, authentication.browserLocalPersistence);
            db = firestore.getFirestore(app);
            await new Promise((resolve, reject) => {
                authentication.onAuthStateChanged(auth, user => {
                    publishAccount(user);
                    resolve();
                }, reject);
            });
            return storage;
        })().catch(error => {
            initialization = null;
            throw error;
        });
    }
    return initialization;
}

export function subscribeAccount(callback) {
    listeners.add(callback);
    callback(getAccount());
    return () => listeners.delete(callback);
}

export function getAccount() { return auth ? auth.currentUser : account; }

export function requireVerifiedAccount() {
    const user = getAccount();
    if (!user || user.isAnonymous || !user.emailVerified) {
        throw new Error('Sign in and verify your email address on the Accounts page first.');
    }
    return user;
}

export function isAccountLink() {
    return !!authSDK && authSDK.isSignInWithEmailLink(auth, location.href);
}

export function pendingAccountEmail() {
    try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; }
}

function accountEmail(email) {
    email = String(email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    return email;
}

function accountReturnSettings() {
    return { url: new URL('../accounts/', import.meta.url).href, handleCodeInApp: false };
}

export async function registerAccount(email, password) {
    await initPlatform();
    if (typeof password !== 'string' || password.length < 6) throw new Error('Use a password with at least 6 characters.');
    const credential = await authSDK.createUserWithEmailAndPassword(auth, accountEmail(email), password);
    publishAccount(credential.user);
    await sendAccountVerification();
    return credential.user;
}

export async function signInAccount(email, password) {
    await initPlatform();
    if (typeof password !== 'string' || !password) throw new Error('Enter your password.');
    const credential = await authSDK.signInWithEmailAndPassword(auth, accountEmail(email), password);
    publishAccount(credential.user);
    return credential.user;
}

export async function sendAccountVerification() {
    await initPlatform();
    const user = getAccount();
    if (!user || user.isAnonymous) throw new Error('Sign in before requesting a verification email.');
    if (user.emailVerified) throw new Error('This email address is already verified.');
    if (ACCOUNT_EMAIL_SERVICE_URL) {
        const token = await user.getIdToken(true);
        if (getAccount()?.uid !== user.uid) throw new Error('The signed-in account changed. Try again.');
        await sendAccountEmail(ACCOUNT_EMAIL_SERVICE_URL, 'verify-email', { token });
    } else {
        await authSDK.sendEmailVerification(user, accountReturnSettings());
    }
}

export async function resetAccountPassword(email) {
    await initPlatform();
    email = accountEmail(email);
    if (ACCOUNT_EMAIL_SERVICE_URL) {
        await sendAccountEmail(ACCOUNT_EMAIL_SERVICE_URL, 'reset-password', { email });
    } else {
        await authSDK.sendPasswordResetEmail(auth, email, accountReturnSettings());
    }
}

export async function refreshAccount() {
    await initPlatform();
    const user = auth.currentUser;
    if (user) {
        await authSDK.reload(user);
        await user.getIdToken(true);
    }
    publishAccount(auth.currentUser);
    return getAccount();
}

export async function sendAccountLink(email) {
    await initPlatform();
    email = accountEmail(email);
    await authSDK.sendSignInLinkToEmail(auth, email, {
        url: new URL('../accounts/', import.meta.url).href,
        handleCodeInApp: true
    });
    try { localStorage.setItem(EMAIL_KEY, email); } catch { /* Cross-device completion asks for email. */ }
}

export async function completeAccountLink(email) {
    await initPlatform();
    if (!isAccountLink()) throw new Error('Open the sign-in link from your email first.');
    const credential = await authSDK.signInWithEmailLink(auth, accountEmail(email), location.href);
    await credential.user.getIdToken(true);
    account = credential.user;
    if (!account.emailVerified) throw new Error('Firebase has not verified this email address.');
    try { localStorage.removeItem(EMAIL_KEY); } catch { /* Storage may be disabled. */ }
    history.replaceState(null, '', location.pathname);
    return account;
}

export async function signOutAccount() {
    await initPlatform();
    await authSDK.signOut(auth);
}

function ref(type, id, connection = db) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        throw new Error('Invalid document ID.');
    }
    return storeSDK.doc(connection, COLLECTIONS[type], id);
}

function publicName(name) {
    name = String(name || '').trim();
    if (!name || name.length > 40 || name.includes('@')) {
        throw new Error('Use a public display name of 1–40 characters, not an email address.');
    }
    return name;
}

function withoutPrivateData(value) {
    if (typeof value === 'string' && value.includes('@')) {
        throw new Error('Public tournament data cannot contain email addresses.');
    }
    if (Array.isArray(value)) value.forEach(withoutPrivateData);
    else if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            if (/email|password|token/i.test(key)) throw new Error(`Private field "${key}" is not allowed.`);
            withoutPrivateData(nested);
        }
    }
}

const TOURNAMENT_FIELDS = [
    'id', 'ownerId', 'title', 'date', 'gameType', 'bestOf', 'status',
    'registrations', 'teams', 'matches', 'revision', 'createdAt', 'updatedAt'
];

function validateTournament(tournament) {
    if (!tournament || Object.keys(tournament).some(key => !TOURNAMENT_FIELDS.includes(key))) {
        throw new Error('Unknown tournament fields. Keep account/private information outside public tournaments.');
    }
    withoutPrivateData(tournament);
    if (!tournament.title?.trim() || tournament.title.length > 100) throw new Error('A title of 1–100 characters is required.');
    for (const key of ['registrations', 'teams', 'matches']) {
        if (!Array.isArray(tournament[key])) throw new Error(`Tournament ${key} must be an array.`);
    }
    if (!Number.isInteger(tournament.revision) || tournament.revision < 0) throw new Error('Invalid tournament revision.');
    if (!['registration', 'live', 'complete'].includes(tournament.status)) throw new Error('Invalid tournament status.');
    if (!['chicago', 'minnesota', '301', '501', 'cricket', 'spanish'].includes(tournament.gameType)) throw new Error('Invalid tournament game type.');
    if (!Number.isSafeInteger(tournament.bestOf) || tournament.bestOf < 1 || tournament.bestOf > 99 || tournament.bestOf % 2 !== 1) {
        throw new Error('Best-of must be an odd number from 1 to 99.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tournament.date)) throw new Error('Choose a tournament date.');
    return tournament;
}

// Firestore rules cannot iterate large bracket arrays. Encode just the three
// public arrays so rules can reject emails (including Unicode-escape bypasses)
// across their entire contents, without the rule expression limit limiting teams.
// All exported APIs accept/return ordinary arrays; this is only the wire format.
function ordered(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || fields.length !== Object.keys(value).length
        || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
        throw new Error('Unknown or incomplete tournament entry schema.');
    }
    return Object.fromEntries(fields.map(key => [key, value[key]]));
}

function encodeTournament(tournament) {
    const document = { ...tournament };
    const source = value => value === null ? null
        : ordered(value, 'teamId' in value ? ['teamId'] : ['matchCode', 'outcome']);
    document.registrations = JSON.stringify(tournament.registrations.map(entry => {
        ordered(entry, ['id', 'playerId', 'name', 'tag', 'paid', 'checkedIn', 'standby']);
        return { id: entry.id, playerId: entry.playerId, name: entry.name, tag: entry.tag };
    }));
    document.teams = JSON.stringify(tournament.teams.map(entry => ordered(entry, ['id', 'name', 'memberIds'])));
    document.matches = JSON.stringify(tournament.matches.map(entry => ({
        ...ordered(entry, ['id', 'code', 'bracket', 'round', 'position', 'sourceA', 'sourceB',
            'teamA', 'teamB', 'status', 'winnerId', 'scoreA', 'scoreB', 'forfeit']),
        sourceA: source(entry.sourceA), sourceB: source(entry.sourceB)
    })));
    for (const [field, limit] of [['registrations', 100000], ['teams', 50000], ['matches', 200000]]) {
        if (new TextEncoder().encode(document[field]).length > limit) throw new Error(`Tournament ${field} exceeds the cloud storage limit.`);
    }
    return document;
}

function encodePrivateRoster(tournament) {
    const registrations = tournament.registrations.map(entry => {
        for (const key of ['paid', 'checkedIn', 'standby']) {
            if (typeof entry[key] !== 'boolean') throw new Error(`Private roster ${key} must be a boolean.`);
        }
        return { id: entry.id, paid: entry.paid, checkedIn: entry.checkedIn, standby: entry.standby };
    });
    const packed = JSON.stringify(registrations);
    if (new TextEncoder().encode(packed).length > 100000) throw new Error('Private roster exceeds the cloud storage limit.');
    return { tournamentId: tournament.id, ownerId: tournament.ownerId, revision: tournament.revision, registrations: packed };
}

function decodeTournament(document) {
    const tournament = { ...document };
    for (const key of ['registrations', 'teams', 'matches']) {
        if (typeof document[key] !== 'string') throw new Error(`Unsupported stored DEV tournament ${key} format.`);
        tournament[key] = JSON.parse(document[key]);
    }
    if (!Array.isArray(tournament.registrations)) throw new Error('Unsupported public registration schema.');
    tournament.registrations = tournament.registrations.map(entry => ({
        ...ordered(entry, ['id', 'playerId', 'name', 'tag']),
        // Redacted view only. Mutations always reload authoritative owner flags.
        paid: false, checkedIn: false, standby: false
    }));
    validateTournament(tournament);
    encodeTournament(tournament);
    return tournament;
}

function mergePrivateRoster(tournament, snapshot) {
    if (!snapshot.exists()) throw new Error('Owner roster metadata is missing. No changes were saved.');
    const metadata = ordered(snapshot.data(), ['tournamentId', 'ownerId', 'revision', 'registrations']);
    if (metadata.tournamentId !== tournament.id || metadata.ownerId !== tournament.ownerId
        || metadata.revision !== tournament.revision || typeof metadata.registrations !== 'string') {
        throw new Error('Owner roster metadata does not match the tournament revision. Reload before continuing.');
    }
    const entries = JSON.parse(metadata.registrations);
    if (!Array.isArray(entries)) throw new Error('Invalid private roster schema.');
    const flags = new Map(entries.map(entry => {
        ordered(entry, ['id', 'paid', 'checkedIn', 'standby']);
        return [entry.id, entry];
    }));
    if (flags.size !== entries.length || entries.length !== tournament.registrations.length) {
        throw new Error('Private and public roster registrations do not match.');
    }
    const merged = { ...tournament, registrations: tournament.registrations.map(entry => {
        if (!flags.has(entry.id)) throw new Error('Private roster registration is missing.');
        return { ...entry, ...flags.get(entry.id) };
    }) };
    encodePrivateRoster(merged);
    return merged;
}

async function validateLinkedProfiles(tournament, read) {
    const ids = [...new Set(tournament.registrations.map(entry => entry.playerId).filter(id => id !== null))];
    const profiles = await Promise.all(ids.map(id => read(ref('profiles', id))));
    if (profiles.some(profile => !profile.exists())) {
        throw new Error('Every linked player ID must have an existing verified account profile. Use a guest for an unregistered player.');
    }
}

function setTournamentPair(transaction, tournament, bundle = { signups: [] }) {
    // Prepare both payloads before queuing either write, including schema checks.
    const publicDocument = encodeTournament(tournament);
    const privateDocument = encodePrivateRoster(tournament);
    for (const entry of tournament.registrations) {
        if (entry.id.startsWith('self-') && entry.id !== `self-${entry.playerId}`) {
            throw new Error('Self-registration IDs belong to their verified player. Remove the entry before adding a guest.');
        }
        if (entry.id.startsWith('guest-') && entry.playerId !== null) {
            throw new Error('Guest signup IDs never become account IDs. Remove the guest before adding a verified player.');
        }
    }
    transaction.set(ref('tournaments', tournament.id), publicDocument);
    transaction.set(ref('rosterPrivate', tournament.id), privateDocument);
    transaction.set(ref('signupState', tournament.id), {
        tournamentId: tournament.id, revision: tournament.revision, lastJoiner: null,
        members: bundle.signups.filter(signup => hasSignup(tournament, signup)).map(signup => signup.uid)
    });
}

// Like bracket arrays, counters are canonical JSON only in Firestore. This
// avoids the server's 1000-expression ceiling for 4 players × 3 Chicago games.
function encodeResultCounters(counters, participantIds, casual = false) {
    const participantLimit = casual ? 128 : 4;
    const counterLimit = casual ? 384 : 12;
    if (!Array.isArray(participantIds) || participantIds.length > participantLimit
        || participantIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        || new Set(participantIds).size !== participantIds.length) {
        throw new Error(`Results require at most ${participantLimit} distinct verified participant IDs.`);
    }
    if (!Array.isArray(counters) || counters.length > counterLimit) throw new Error(`Results allow at most ${counterLimit} per-player game counters.`);
    const canonical = counters.map(player => {
        const counter = ordered(player, ['playerId', 'gameType', 'points', 'darts', 'marks']);
        if (!participantIds.includes(counter.playerId)) throw new Error('Counter player ID is not a result participant.');
        if (typeof counter.gameType !== 'string' || (casual ? !CASUAL_GAME_PATTERN.test(counter.gameType)
            : !['chicago', 'minnesota', '301', '501', 'cricket', 'spanish'].includes(counter.gameType))) {
            throw new Error('Unsupported counter game type.');
        }
        for (const key of ['points', 'darts', 'marks']) {
            if (!Number.isFinite(counter[key]) || counter[key] < 0 || counter[key] >= 1e12) {
                throw new Error(`Counter ${key} must be a finite nonnegative number below one trillion.`);
            }
        }
        if (!Number.isSafeInteger(counter.darts)) throw new Error('Actual darts must be a nonnegative integer.');
        return counter;
    });
    const packed = JSON.stringify(canonical);
    if (new TextEncoder().encode(packed).length > (casual ? 100000 : 8192)) throw new Error('Result counters exceed the cloud storage limit.');
    return packed;
}

function decodeResult(document, source = 'tournament') {
    if (typeof document.perPlayer !== 'string') throw new Error('Unsupported stored DEV result counter format.');
    const perPlayer = JSON.parse(document.perPlayer);
    encodeResultCounters(perPlayer, document.participantIds, source === 'casual');
    return { ...document, perPlayer, source,
        provenance: source === 'casual' ? 'scorekeeper-recorded' : 'organizer-recorded' };
}

function signupRef(id, uid, connection = db) {
    ref('tournaments', id, connection);
    ref('profiles', uid, connection);
    return storeSDK.doc(connection, 'blakeoutDevSignups', id, 'players', uid);
}

function signupVersion(snapshot) {
    if (!snapshot.exists()) return null; // Explicit deployed-v1 bootstrap case.
    const data = ordered(snapshot.data(), ['tournamentId', 'revision', 'lastJoiner', 'members']);
    if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.members)
        || data.members.length > 128 || new Set(data.members).size !== data.members.length
        || data.members.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) {
        throw new Error('Invalid signup revision or member index.');
    }
    return data.revision;
}

function signupConflict() {
    const error = new Error('Registrations changed on another device. Reload before saving or starting.');
    error.code = 'platform/revision-conflict';
    return error;
}

async function signupBundle(id, transaction, materialized = null) {
    const state = await transaction.get(ref('signupState', id));
    const version = signupVersion(state);
    const members = state.exists() ? state.data().members : [];
    const pending = materialized ? members.filter(uid =>
        !hasSignup(materialized, { playerId: uid, registrationId: `self-${uid}` })
        && !hasSignup(materialized, { playerId: null, registrationId: `guest-${uid}` })) : members;
    const snapshots = await Promise.all(pending.map(uid => transaction.get(signupRef(id, uid))));
    const signups = snapshots.map(doc => {
        if (!doc.exists()) throw new Error('Self-registration index references a missing entry.');
        const data = ordered(doc.data(), ['playerId', 'registrationId', 'name', 'joinRevision']);
        const identityMatches = data.playerId === null
            ? data.registrationId === `guest-${doc.id}`
            : data.playerId === doc.id && data.registrationId === `self-${doc.id}`;
        if (!identityMatches
            || typeof data.name !== 'string' || !Number.isSafeInteger(data.joinRevision)
            || data.joinRevision < 1 || data.joinRevision > version) {
            throw new Error('Invalid self-registration schema.');
        }
        return { ...data, uid: doc.id };
    });
    return { version, signups };
}

function hasSignup(tournament, signup) {
    return tournament.registrations.some(entry => signup.playerId === null
        ? entry.id === signup.registrationId && entry.playerId === null
        : entry.playerId === signup.playerId);
}

function mergeSignups(tournament, bundle) {
    if (bundle.version !== null && bundle.version < tournament.revision) throw signupConflict();
    const registrations = tournament.registrations.slice();
    for (const signup of bundle.signups) {
        if (hasSignup({ registrations }, signup)) continue;
        if (registrations.some(entry => entry.id === signup.registrationId)) throw new Error('Conflicting self-registration ID.');
        registrations.push({
            id: signup.registrationId, playerId: signup.playerId, name: signup.name,
            tag: '', paid: false, checkedIn: false, standby: false
        });
    }
    return { ...tournament, registrations, revision: bundle.version ?? tournament.revision };
}

async function ownerTournament(id, uid, transaction) {
    const snapshot = await transaction.get(ref('tournaments', id));
    if (!snapshot.exists()) throw new Error('Tournament not found.');
    const tournament = decodeTournament(snapshot.data());
    if (tournament.ownerId !== uid) throw new Error('Only this tournament’s organizer can change it.');
    const bundle = await signupBundle(id, transaction);
    return { current: mergeSignups(mergePrivateRoster(tournament, await transaction.get(ref('rosterPrivate', id))), bundle), bundle };
}

async function visibleTournament(document) {
    const user = getAccount();
    const views = await storeSDK.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref('tournaments', document.id));
        if (!snapshot.exists()) return null;
        const tournament = decodeTournament(snapshot.data());
        const bundle = await signupBundle(document.id, transaction, tournament);
        const publicView = mergeSignups(tournament, bundle);
        const ownerView = user?.emailVerified && !user.isAnonymous && tournament.ownerId === user.uid
            ? mergeSignups(mergePrivateRoster(tournament, await transaction.get(ref('rosterPrivate', document.id))), bundle)
            : null;
        return { publicView, ownerView };
    });
    if (!views) return null;
    // Never reveal an in-flight private response after a signout/account switch.
    return views.ownerView && getAccount()?.uid === user?.uid && getAccount()?.emailVerified
        ? views.ownerView : views.publicView;
}

function removeOmittedSignups(transaction, id, candidate, bundle) {
    for (const signup of bundle.signups) {
        if (!hasSignup(candidate, signup)) transaction.delete(signupRef(id, signup.uid));
    }
}

export async function joinTournament(id) {
    await initPlatform();
    const user = requireVerifiedAccount();
    await storeSDK.runTransaction(db, async transaction => {
        const [snapshot, state, signup, profile] = await Promise.all([
            transaction.get(ref('tournaments', id)), transaction.get(ref('signupState', id)),
            transaction.get(signupRef(id, user.uid)), transaction.get(ref('profiles', user.uid))
        ]);
        if (!snapshot.exists()) throw new Error('Tournament not found.');
        const tournament = decodeTournament(snapshot.data());
        if (!profile.exists()) throw new Error('Save your own verified account profile before joining.');
        if (signup.exists()) {
            if (signup.data().playerId !== user.uid) throw new Error('This identity already has a guest entry. Ask the organizer to remove it before joining with an account.');
            return;
        }
        if (tournament.registrations.some(entry => entry.playerId === user.uid)) return;
        if (tournament.status !== 'registration') throw new Error('Registration is closed.');
        const revision = (signupVersion(state) ?? tournament.revision) + 1;
        const members = state.exists() ? state.data().members : [];
        if (members.length >= 128) throw new Error('This event has reached its 128 self-registration limit. Contact the organizer.');
        transaction.set(signupRef(id, user.uid), {
            playerId: user.uid, registrationId: `self-${user.uid}`, name: publicName(profile.data().name), joinRevision: revision
        });
        transaction.set(ref('signupState', id), { tournamentId: id, revision, lastJoiner: user.uid, members: [...members, user.uid] });
    });
    return getTournament(id);
}

async function guestConnection() {
    await initPlatform();
    if (!guestInitialization) {
        guestInitialization = (async () => {
            const [config, apps] = await Promise.all([
                import('./firebase-config.js'), import(`${SDK_BASE}/firebase-app.js`)
            ]);
            const name = 'blakeout-dev-guests';
            const app = apps.getApps().find(item => item.name === name)
                || apps.initializeApp(config.firebaseConfig, name);
            const guestAuth = authSDK.getAuth(app);
            await authSDK.setPersistence(guestAuth, authSDK.browserLocalPersistence);
            await new Promise((resolve, reject) => {
                const unsubscribe = authSDK.onAuthStateChanged(guestAuth, () => {
                    unsubscribe();
                    resolve();
                }, reject);
            });
            if (!guestAuth.currentUser) await authSDK.signInAnonymously(guestAuth);
            if (!guestAuth.currentUser?.isAnonymous) {
                throw new Error('The guest session is not anonymous. Your signed-in account has not been changed.');
            }
            return { auth: guestAuth, db: storeSDK.getFirestore(app) };
        })().catch(error => {
            guestInitialization = null;
            throw error;
        });
    }
    return guestInitialization;
}

// Unlike verified join, return the exact device-owned row ID alongside the
// unchanged tournament object so callers never identify guests by name.
export async function joinTournamentAsGuest(id, name) {
    name = publicName(name);
    const connection = await guestConnection();
    const guest = connection.auth.currentUser;
    if (!guest?.isAnonymous) throw new Error('An anonymous guest session is required.');
    await storeSDK.runTransaction(connection.db, async transaction => {
        const [snapshot, state, signup] = await Promise.all([
            transaction.get(ref('tournaments', id, connection.db)),
            transaction.get(ref('signupState', id, connection.db)),
            transaction.get(signupRef(id, guest.uid, connection.db))
        ]);
        if (!snapshot.exists()) throw new Error('Tournament not found.');
        const tournament = decodeTournament(snapshot.data());
        if (signup.exists()) {
            if (signup.data().playerId !== null) throw new Error('This device identity is already registered with an account.');
            if (signup.data().name !== name) {
                throw new Error(`This device already registered guest "${signup.data().name}". The organizer can add other guests on a shared device.`);
            }
            return;
        }
        if (tournament.status !== 'registration') throw new Error('Registration is closed.');
        const revision = (signupVersion(state) ?? tournament.revision) + 1;
        const members = state.exists() ? state.data().members : [];
        if (members.length >= 128) throw new Error('This event has reached its 128 self-registration limit. Contact the organizer.');
        transaction.set(signupRef(id, guest.uid, connection.db), {
            playerId: null, registrationId: `guest-${guest.uid}`, name, joinRevision: revision
        });
        transaction.set(ref('signupState', id, connection.db), {
            tournamentId: id, revision, lastJoiner: guest.uid, members: [...members, guest.uid]
        });
    });
    return { tournament: await getTournament(id), registrationId: `guest-${guest.uid}` };
}

export async function saveProfile(name) {
    await initPlatform();
    const user = requireVerifiedAccount();
    const profile = { name: publicName(name) };
    await storeSDK.runTransaction(db, async transaction => {
        transaction.set(ref('profiles', user.uid), profile);
    });
    return { id: user.uid, ...profile };
}

export async function getProfile() {
    await initPlatform();
    const user = requireVerifiedAccount();
    const snapshot = await storeSDK.getDocFromServer(ref('profiles', user.uid));
    return snapshot.exists() ? { id: snapshot.id, name: snapshot.data().name } : null;
}

export async function listProfiles() {
    await initPlatform();
    requireVerifiedAccount();
    const snapshot = await storeSDK.getDocsFromServer(storeSDK.collection(db, COLLECTIONS.profiles));
    return snapshot.docs.map(item => ({ id: item.id, name: item.data().name }));
}

export async function listTournaments() {
    await initPlatform();
    const snapshot = await storeSDK.getDocsFromServer(storeSDK.collection(db, COLLECTIONS.tournaments));
    return (await Promise.all(snapshot.docs.map(item => visibleTournament({ id: item.id })))).filter(Boolean);
}

export async function getTournament(id) {
    await initPlatform();
    return visibleTournament({ id });
}

export async function createTournamentDocument(tournament) {
    await initPlatform();
    const user = requireVerifiedAccount();
    const id = tournament.id || storeSDK.doc(storeSDK.collection(db, COLLECTIONS.tournaments)).id;
    const now = Date.now();
    const document = validateTournament({
        ...tournament, id, ownerId: user.uid, revision: 0, createdAt: now, updatedAt: now
    });
    await storeSDK.runTransaction(db, async transaction => {
        const reference = ref('tournaments', id);
        if ((await transaction.get(reference)).exists()) throw new Error('Tournament ID already exists.');
        if ((await transaction.get(ref('rosterPrivate', id))).exists()) throw new Error('Private roster ID already exists.');
        if ((await transaction.get(ref('signupState', id))).exists()) throw new Error('Signup state ID already exists.');
        await validateLinkedProfiles(document, reference => transaction.get(reference));
        setTournamentPair(transaction, document);
    });
    return document;
}

function revised(current, expectedRevision, updater, uid) {
    if (current.ownerId !== uid) throw new Error('Only this tournament’s organizer can change it.');
    if (current.revision !== expectedRevision) {
        const error = new Error('This tournament changed on another device. Reload before trying again.');
        error.code = 'platform/revision-conflict';
        throw error;
    }
    const candidate = updater(structuredClone(current));
    if (!candidate || typeof candidate.then === 'function') throw new Error('Tournament updater must return a document synchronously.');
    return validateTournament({
        ...candidate, id: current.id, ownerId: current.ownerId,
        createdAt: current.createdAt, revision: current.revision + 1, updatedAt: Math.max(current.updatedAt, Date.now())
    });
}

export async function updateTournament(id, expectedRevision, updater) {
    await initPlatform();
    const user = requireVerifiedAccount();
    return storeSDK.runTransaction(db, async transaction => {
        const { current, bundle } = await ownerTournament(id, user.uid, transaction);
        const next = revised(current, expectedRevision, updater, user.uid);
        await validateLinkedProfiles(next, reference => transaction.get(reference));
        setTournamentPair(transaction, next, bundle);
        removeOmittedSignups(transaction, id, next, bundle);
        return next;
    });
}

// Firestore may retry updater: it must be pure (precompute randomized draws,
// collect UI input, and do network work before calling either transaction API).
export async function saveMatchResult(tournamentId, expectedRevision, resultId, result, updater) {
    await initPlatform();
    const user = requireVerifiedAccount();
    return storeSDK.runTransaction(db, async transaction => {
        const resultRef = ref('results', resultId);
        const { current, bundle } = await ownerTournament(tournamentId, user.uid, transaction);
        const resultSnapshot = await transaction.get(resultRef);
        if (resultSnapshot.exists()) {
            const existing = resultSnapshot.data();
            if (existing.tournamentId !== tournamentId || existing.matchId !== result.matchId) {
                throw new Error('Result ID is already used by another match.');
            }
            return current;
        }
        const match = current.matches.find(item => item.id === result.matchId);
        if (!match || match.status !== 'ready') throw new Error('This match is not ready or already has a recorded result.');
        const next = revised(current, expectedRevision, updater, user.uid);
        if (!Array.isArray(result.participantIds) || !Array.isArray(result.perPlayer)) {
            throw new Error('Results require participantIds and perPlayer arrays.');
        }
        const participantIds = [...new Set(result.participantIds)];
        if (participantIds.some(id => typeof id !== 'string' || !id)) throw new Error('Guests must not be included in participantIds.');
        const memberIds = current.teams.filter(team => [match.teamA, match.teamB].includes(team.id))
            .flatMap(team => team.memberIds);
        const actualIds = [...new Set(current.registrations.filter(entry => memberIds.includes(entry.id))
            .map(entry => entry.playerId).filter(Boolean))];
        if (participantIds.length !== actualIds.length || actualIds.some(id => !participantIds.includes(id))) {
            throw new Error('Result participants must be the verified accounts registered to this match.');
        }
        if (result.perPlayer.some(player => !participantIds.includes(player.playerId))) {
            throw new Error('Guest or unrelated player counters cannot be recorded as account statistics.');
        }
        await validateLinkedProfiles(next, reference => transaction.get(reference));
        const record = {
            ...result, ownerId: user.uid, tournamentId, participantIds,
            perPlayer: encodeResultCounters(result.perPlayer, participantIds), createdAt: Date.now()
        };
        withoutPrivateData(record);
        setTournamentPair(transaction, next, bundle);
        removeOmittedSignups(transaction, tournamentId, next, bundle);
        transaction.set(resultRef, record);
        return next;
    });
}

function casualReceiptRef(resultId, playerId) {
    ref('casualResults', resultId);
    ref('profiles', playerId);
    return storeSDK.doc(db, 'blakeoutDevCasualReceipts', `${resultId}$${playerId}`);
}

export async function saveCasualResult(resultId, result) {
    await initPlatform();
    const user = requireVerifiedAccount();
    const reference = ref('casualResults', resultId);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('A casual result object is required.');
    if (result.source !== undefined && result.source !== 'casual') throw new Error('Casual results cannot claim a tournament source.');
    result = { ...result, matchId: result.matchId ?? resultId };
    delete result.source; // The collection, not caller input, determines provenance.
    if (result.winnerIds !== undefined && (!Array.isArray(result.winnerIds) || result.winnerIds.length > 128
        || result.winnerIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))) {
        throw new Error('Tied winners must be a list of stable side IDs, not names.');
    }
    const persisted = await storeSDK.runTransaction(db, async transaction => {
        const existing = await transaction.get(reference);
        if (existing.exists()) {
            if (existing.data().ownerId !== user.uid) throw new Error('This result ID belongs to another scorekeeper.');
            if (existing.data().matchId !== result.matchId || existing.data().gameType !== result.gameType) {
                throw new Error('This result ID already belongs to a different casual match.');
            }
            decodeResult(existing.data(), 'casual');
            return existing.data();
        }
        if (typeof result.gameType !== 'string' || !CASUAL_GAME_PATTERN.test(result.gameType)
            || typeof result.matchId !== 'string' || !result.matchId.trim() || result.matchId.length > 128) {
            throw new Error('A supported game type and match ID are required.');
        }
        const perPlayer = encodeResultCounters(result.perPlayer, result.participantIds, true);
        const profiles = await Promise.all(result.participantIds.map(uid => transaction.get(ref('profiles', uid))));
        if (profiles.some(profile => !profile.exists())) throw new Error('Casual statistics can only reference existing verified player profiles. Guests must be excluded.');
        const document = { ...result, ownerId: user.uid, perPlayer, createdAt: Date.now() };
        withoutPrivateData(document);
        transaction.set(reference, document);
        return document;
    });
    // Receipts independently prove each recipient's verified profile exists.
    // Each receipt has its own small transaction (both expression and lookup
    // budgets). Eight run concurrently; retry resumes missing receipts without
    // rewriting the immutable score document.
    for (let offset = 0; offset < persisted.participantIds.length; offset += 8) {
        const ids = persisted.participantIds.slice(offset, offset + 8);
        const outcomes = await Promise.allSettled(ids.map(uid =>
            storeSDK.runTransaction(db, async transaction => {
                const receipt = await transaction.get(casualReceiptRef(resultId, uid));
                if (!receipt.exists()) transaction.set(casualReceiptRef(resultId, uid), {
                    resultId, playerId: uid, ownerId: user.uid
                });
            })));
        const failed = outcomes.find(outcome => outcome.status === 'rejected');
        if (failed) throw failed.reason;
    }
    return decodeResult({ ...persisted, id: resultId }, 'casual');
}

export async function listMyResults() {
    await initPlatform();
    const user = requireVerifiedAccount();
    const [snapshot, receipts, owned] = await Promise.all([
        storeSDK.getDocsFromServer(storeSDK.query(storeSDK.collection(db, COLLECTIONS.results),
            storeSDK.where('participantIds', 'array-contains', user.uid))),
        storeSDK.getDocsFromServer(storeSDK.query(storeSDK.collection(db, 'blakeoutDevCasualReceipts'),
            storeSDK.where('playerId', '==', user.uid))),
        storeSDK.getDocsFromServer(storeSDK.query(storeSDK.collection(db, COLLECTIONS.casualResults),
            storeSDK.where('ownerId', '==', user.uid)))
    ]);
    const casual = new Map(owned.docs.map(item =>
        [item.id, decodeResult({ ...item.data(), id: item.id }, 'casual')]));
    const received = await Promise.all(receipts.docs.filter(receipt => !casual.has(receipt.data().resultId)).map(async receipt => {
        const record = await storeSDK.getDocFromServer(ref('casualResults', receipt.data().resultId));
        if (!record.exists()) throw new Error('A casual result receipt references a missing record.');
        return decodeResult({ ...record.data(), id: record.id }, 'casual');
    }));
    for (const record of received) casual.set(record.id, record);
    return [...snapshot.docs.map(item => decodeResult({ ...item.data(), id: item.id })), ...casual.values()];
}

// Importable boundary for a future adapter; this implementation never falls back
// to local data or treats queued/offline writes as a successful cloud save.
export const storage = Object.freeze({
    initPlatform, listTournaments, getTournament, createTournamentDocument,
    updateTournament, joinTournament, joinTournamentAsGuest, saveMatchResult, saveCasualResult,
    listMyResults, saveProfile, getProfile, listProfiles
});
