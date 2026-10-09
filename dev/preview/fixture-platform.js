/* DEV layout fixtures. This module has no provider, fetch, storage or credential
   dependency. Its process-local maps are discarded on navigation/reload. It is
   reachable only through the preview import map, never the real feature gate. */
import * as engine from '../js/brackets/engine.js';

export const PREVIEW_ONLY = true;
export const SAMPLE_OWNER = 'sample-organizer-0001';
export const SCENARIOS = Object.freeze({
    accounts: ['verified', 'unverified', 'signed-out', 'empty', 'loading', 'error'],
    brackets: ['registration', 'live', 'complete', 'large', 'spectator', 'unverified', 'empty', 'loading', 'error'],
});
const clone = value => structuredClone(value);
const listeners = new Set();
let scenario = 'verified', account = null, documents = new Map(), profiles = new Map();
let configured = false, guestCounter = 0;
const guests = new Map();
const sampleAccount = verified => Object.freeze({
    uid: SAMPLE_OWNER, email: 'SAMPLE ORGANIZER · no email address',
    emailVerified: verified, isAnonymous: false,
});

function sampleLabel(value, limit = 40) {
    const label = String(value || '').trim();
    if (!label || /[@\u0000-\u001f]/.test(label)) throw Error('Use a sample display label, without email addresses.');
    return (label.startsWith('Sample ') ? label : `Sample ${label}`).slice(0, limit);
}
function makeTournament(id, count = 4) {
    let item = engine.createTournament({ id, ownerId: SAMPLE_OWNER, title: `Sample ${count}-team practice cup`, date: '2026-10-09', gameType: '501', bestOf: 3 });
    item = engine.saveRoster(item, Array.from({ length: count * 2 }, (_, index) => ({
        id: `sample-entry-${index + 1}`, playerId: index === 0 ? SAMPLE_OWNER : index % 2 === 0 ? `sample-player-${index + 1}` : null,
        name: `Sample ${index % 2 ? 'Guest' : 'Player'} ${String(index + 1).padStart(2, '0')}`,
        tag: String(Math.floor(index / 2) + 1), paid: true, checkedIn: true, standby: false,
    })));
    return item;
}
function completeTournament(item) {
    let current = engine.startTournament(item);
    // Use the actual engine and legal leg scores. These are invented examples.
    while (current.status !== 'complete') {
        const ready = current.matches.find(match => match.status === 'ready');
        if (!ready) throw Error('Sample tournament could not advance.');
        current = engine.recordResult(current, ready.id, { winnerId: ready.teamA, scoreA: 2, scoreB: 1, forfeit: false });
    }
    return current;
}

export function configurePreview({ page = 'accounts', selectedScenario } = {}) {
    if (configured) throw Error('Reload the preview to reset its sample state.');
    configured = true;
    scenario = SCENARIOS[page]?.includes(selectedScenario) ? selectedScenario : SCENARIOS[page]?.[0] || 'verified';
    account = ['signed-out', 'spectator'].includes(scenario) ? null : sampleAccount(scenario !== 'unverified');
    profiles = new Map([[SAMPLE_OWNER, { id: SAMPLE_OWNER, name: 'Sample Organizer' }], ...Array.from({ length: 8 }, (_, index) => {
        const id = `sample-player-${index + 1}`;
        return [id, { id, name: `Sample Player ${String(index + 1).padStart(2, '0')}` }];
    })]);
    documents = new Map();
    if (scenario !== 'empty') {
        let current = makeTournament('sample-cup', scenario === 'large' ? 32 : 4);
        if (scenario === 'live') {
            current = engine.startTournament(current);
            const ready = current.matches.find(match => match.status === 'ready');
            current = engine.recordResult(current, ready.id, { winnerId: ready.teamA, scoreA: 2, scoreB: 1, forfeit: false });
        }
        if (scenario === 'complete') current = completeTournament(current);
        documents.set(current.id, current);
        const history = completeTournament(makeTournament('sample-history', 2));
        history.title = 'Sample completed doubles night';
        history.date = '2026-10-01';
        documents.set(history.id, history);
    }
    return scenario;
}
function requireConfigured() {
    if (!configured) throw Error('Sample adapter must be configured by the preview launcher.');
}
function available() {
    requireConfigured();
    if (scenario === 'error') throw Error('Simulated sample-data error. Choose another scenario to retry.');
}
export async function initPlatform() {
    requireConfigured();
    if (scenario === 'loading') return new Promise(() => {});
    available();
}
export const getAccount = () => account;
export function subscribeAccount(callback) {
    requireConfigured();
    listeners.add(callback);
    callback(account);
    return () => listeners.delete(callback);
}
export function requireVerifiedAccount() {
    available();
    if (!account?.emailVerified || account.isAnonymous) throw Error('Choose the simulated verified scenario to try this sample action.');
    return account;
}
export async function signOutAccount() {
    account = null;
    for (const listener of listeners) listener(account);
}
export async function refreshAccount() { available(); return account; }
export const isAccountLink = () => false;
export const pendingAccountEmail = () => '';
const credentialsBlocked = async () => { throw Error('Real sign-in, credentials and email actions are disabled in this preview. Choose a sample scenario above.'); };
export const registerAccount = credentialsBlocked;
export const signInAccount = credentialsBlocked;
export const sendAccountVerification = credentialsBlocked;
export const resetAccountPassword = credentialsBlocked;
export const sendAccountLink = credentialsBlocked;
export const completeAccountLink = credentialsBlocked;
export async function getProfile() {
    requireVerifiedAccount();
    return clone(profiles.get(account.uid) || null);
}
export async function saveProfile(name) {
    requireVerifiedAccount();
    profiles.set(account.uid, { id: account.uid, name: sampleLabel(name) });
    return getProfile();
}
export async function listProfiles() { requireVerifiedAccount(); return clone([...profiles.values()]); }
function visible(item) {
    if (!item) return null;
    const view = clone(item);
    if (!account?.emailVerified || account.uid !== view.ownerId) {
        // Same presentation boundary as the real public view: no private flags.
        view.registrations = view.registrations.map(({ paid, checkedIn, standby, ...entry }) => entry);
    }
    return view;
}
export async function listTournaments() { available(); return [...documents.values()].map(visible); }
export async function getTournament(id) { available(); return visible(documents.get(id)); }
function owned(id) {
    requireVerifiedAccount();
    const item = documents.get(id);
    if (!item || item.ownerId !== account.uid) throw Error('This sample tournament is not available to this sample identity.');
    return item;
}
function normalizeDocument(item) {
    const next = clone(item);
    next.title = sampleLabel(next.title, 100);
    next.registrations = next.registrations.map(entry => ({ ...entry, name: sampleLabel(entry.name) }));
    return next;
}
export async function createTournamentDocument(tournament) {
    requireVerifiedAccount();
    if (documents.has(tournament.id) || tournament.ownerId !== account.uid) throw Error('Invalid sample tournament.');
    const next = normalizeDocument(tournament);
    documents.set(next.id, next);
    return visible(next);
}
export async function updateTournament(id, expectedRevision, updater) {
    const stored = owned(id);
    if (stored.revision !== expectedRevision) throw Error('Sample revision conflict. Discard and reload to keep the newest sample roster.');
    const next = normalizeDocument(updater(clone(stored)));
    if (next.id !== id || next.ownerId !== stored.ownerId || next.revision <= stored.revision) throw Error('Invalid sample update.');
    documents.set(id, next);
    return visible(next);
}
function addRegistration(id, entry) {
    available();
    const stored = documents.get(id);
    if (!stored || stored.status !== 'registration') throw Error('Sample registration is closed.');
    const next = engine.saveRoster(stored, [...stored.registrations, entry]);
    documents.set(id, next);
    return visible(next);
}
export async function joinTournament(id) {
    requireVerifiedAccount();
    const stored = documents.get(id);
    if (stored?.registrations.some(entry => entry.playerId === account.uid)) return visible(stored);
    const profile = profiles.get(account.uid);
    if (!profile) throw Error('Create a sample profile first.');
    return addRegistration(id, { id: `sample-joined-${account.uid}`, playerId: account.uid, name: profile.name, tag: '', paid: false, checkedIn: false, standby: false });
}
export async function joinTournamentAsGuest(id, name) {
    available();
    const oldId = guests.get(id);
    if (oldId && documents.get(id)?.registrations.some(entry => entry.id === oldId)) return { tournament: visible(documents.get(id)), registrationId: oldId };
    const registrationId = `sample-guest-${++guestCounter}`;
    const tournament = addRegistration(id, { id: registrationId, playerId: null, name: sampleLabel(name), tag: '', paid: false, checkedIn: false, standby: false });
    guests.set(id, registrationId);
    return { tournament, registrationId };
}
export async function listMyResults() {
    requireVerifiedAccount();
    if (scenario === 'empty') return [];
    return clone([
        { id: 'sample-result-501', matchId: 'SAMPLE-W1.1', createdAt: Date.UTC(2026, 9, 8), source: 'tournament', gameType: '501', perPlayer: [{ playerId: SAMPLE_OWNER, gameType: '501', points: 1002, darts: 45 }] },
        { id: 'sample-result-cricket', matchId: 'SAMPLE-CASUAL-02', createdAt: Date.UTC(2026, 9, 7), source: 'casual', gameType: 'cricket', perPlayer: [{ playerId: SAMPLE_OWNER, gameType: 'cricket', marks: 30, darts: 36 }] },
        { id: 'sample-result-minnesota', matchId: 'SAMPLE-CASUAL-03', createdAt: Date.UTC(2026, 9, 6), source: 'casual', gameType: 'minnesota', perPlayer: [{ playerId: SAMPLE_OWNER, gameType: 'minnesota', marks: 28, darts: 33 }] },
    ]);
}
