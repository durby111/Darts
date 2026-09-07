// Dev accounts deliberately use a named app, never the scorer's anonymous auth.
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.13.2';
const APP_NAME = 'blakeout-dev-accounts';
const EMAIL_KEY = 'blakeout_dev_email_link';
const COLLECTIONS = Object.freeze({
    profiles: 'blakeoutDevProfiles',
    tournaments: 'blakeoutDevTournaments',
    rosterPrivate: 'blakeoutDevRosterPrivate',
    results: 'blakeoutDevResults'
});
const listeners = new Set();
let initialization, auth, db, authSDK, storeSDK, account = null;

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
    await authSDK.sendEmailVerification(user, accountReturnSettings());
}

export async function resetAccountPassword(email) {
    await initPlatform();
    await authSDK.sendPasswordResetEmail(auth, accountEmail(email), accountReturnSettings());
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

function ref(type, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        throw new Error('Invalid document ID.');
    }
    return storeSDK.doc(db, COLLECTIONS[type], id);
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
    if (!['chicago', '301', '501', 'cricket', 'spanish'].includes(tournament.gameType)) throw new Error('Invalid tournament game type.');
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
    if (!value || fields.length !== Object.keys(value).length || fields.some(key => !(key in value))) {
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

function setTournamentPair(transaction, tournament) {
    // Prepare both payloads before queuing either write, including schema checks.
    const publicDocument = encodeTournament(tournament);
    const privateDocument = encodePrivateRoster(tournament);
    transaction.set(ref('tournaments', tournament.id), publicDocument);
    transaction.set(ref('rosterPrivate', tournament.id), privateDocument);
}

// Like bracket arrays, counters are canonical JSON only in Firestore. This
// avoids the server's 1000-expression ceiling for 4 players × 3 Chicago games.
function encodeResultCounters(counters, participantIds) {
    if (!Array.isArray(participantIds) || participantIds.length > 4
        || participantIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        || new Set(participantIds).size !== participantIds.length) {
        throw new Error('Results require at most four distinct verified participant IDs.');
    }
    if (!Array.isArray(counters) || counters.length > 12) throw new Error('Results allow at most 12 per-player game counters.');
    const canonical = counters.map(player => {
        const counter = ordered(player, ['playerId', 'gameType', 'points', 'darts', 'marks']);
        if (!participantIds.includes(counter.playerId)) throw new Error('Counter player ID is not a result participant.');
        if (!['chicago', '301', '501', 'cricket', 'spanish'].includes(counter.gameType)) throw new Error('Unsupported counter game type.');
        for (const key of ['points', 'darts', 'marks']) {
            if (!Number.isFinite(counter[key]) || counter[key] < 0 || counter[key] >= 1e12) {
                throw new Error(`Counter ${key} must be a finite nonnegative number below one trillion.`);
            }
        }
        if (!Number.isSafeInteger(counter.darts)) throw new Error('Actual darts must be a nonnegative integer.');
        return counter;
    });
    const packed = JSON.stringify(canonical);
    if (new TextEncoder().encode(packed).length > 8192) throw new Error('Result counters exceed the cloud storage limit.');
    return packed;
}

function decodeResult(document) {
    if (typeof document.perPlayer !== 'string') throw new Error('Unsupported stored DEV result counter format.');
    const perPlayer = JSON.parse(document.perPlayer);
    encodeResultCounters(perPlayer, document.participantIds);
    return { ...document, perPlayer };
}

async function ownerTournament(id, uid, transaction) {
    const snapshot = await transaction.get(ref('tournaments', id));
    if (!snapshot.exists()) throw new Error('Tournament not found.');
    const tournament = decodeTournament(snapshot.data());
    if (tournament.ownerId !== uid) throw new Error('Only this tournament’s organizer can change it.');
    return mergePrivateRoster(tournament, await transaction.get(ref('rosterPrivate', id)));
}

async function visibleTournament(document) {
    const tournament = decodeTournament(document);
    const user = getAccount();
    if (!user || !user.emailVerified || user.isAnonymous || tournament.ownerId !== user.uid) return tournament;
    const ownerView = await storeSDK.runTransaction(db, transaction => ownerTournament(tournament.id, user.uid, transaction));
    // Never reveal an in-flight private response after a signout/account switch.
    return getAccount()?.uid === user.uid && getAccount()?.emailVerified ? ownerView : tournament;
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
    return Promise.all(snapshot.docs.map(item => visibleTournament({ ...item.data(), id: item.id })));
}

export async function getTournament(id) {
    await initPlatform();
    const snapshot = await storeSDK.getDocFromServer(ref('tournaments', id));
    return snapshot.exists() ? visibleTournament({ ...snapshot.data(), id: snapshot.id }) : null;
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
        const current = await ownerTournament(id, user.uid, transaction);
        const next = revised(current, expectedRevision, updater, user.uid);
        await validateLinkedProfiles(next, reference => transaction.get(reference));
        setTournamentPair(transaction, next);
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
        const current = await ownerTournament(tournamentId, user.uid, transaction);
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
        setTournamentPair(transaction, next);
        transaction.set(resultRef, record);
        return next;
    });
}

export async function listMyResults() {
    await initPlatform();
    const user = requireVerifiedAccount();
    const snapshot = await storeSDK.getDocsFromServer(storeSDK.query(
        storeSDK.collection(db, COLLECTIONS.results),
        storeSDK.where('participantIds', 'array-contains', user.uid)
    ));
    return snapshot.docs.map(item => decodeResult({ ...item.data(), id: item.id }));
}

// Importable boundary for a future adapter; this implementation never falls back
// to local data or treats queued/offline writes as a successful cloud save.
export const storage = Object.freeze({
    initPlatform, listTournaments, getTournament, createTournamentDocument,
    updateTournament, saveMatchResult, listMyResults, saveProfile, getProfile, listProfiles
});
