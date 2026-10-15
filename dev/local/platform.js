import { matchFormat } from '../js/brackets/engine.js';
// Device-only tournament adapter. No Firebase imports, accounts or network writes.
export const LOCAL_ONLY = true;
export const STORAGE_KEY = 'blakeout_dev_local_tournaments_v1';
const identity = Object.freeze({ uid: 'device-organizer', emailVerified: true, isAnonymous: false });
const copy = value => structuredClone(value);
// Recovery compaction may reinsert `records` in a different property order.
// Compare JSON values canonically; preserve the order of darts/legs in arrays.
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sameResult = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function read() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, events: {}, results: {}, corrections: [] };
    const data = JSON.parse(raw);
    if (data.version !== 1 || !data.events || !data.results || !Array.isArray(data.corrections))
        throw Error('Local tournament storage cannot be read. It has not been replaced.');
    return data;
}
async function write(callback) {
    if (!navigator.locks?.request) throw Error('This browser cannot safely coordinate local tournament saves. Use a current supported browser.');
    return navigator.locks.request(STORAGE_KEY, () => {
        const data = read();
        const result = callback(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return copy(result);
    });
}
export async function initPlatform() { read(); }
export const getAccount = () => identity;
// Compatibility with the account-shaped UI contract; this is NOT authentication.
export const requireVerifiedAccount = () => identity;
export function subscribeAccount(callback) { queueMicrotask(() => callback(identity)); return () => {}; }
export const listProfiles = async () => [];
export const getProfile = async () => null;
export const listTournaments = async () => Object.values(read().events).map(copy);
export const getTournament = async id => copy(read().events[id] || null);
export async function createTournamentDocument(tournament) {
    return write(data => {
        if (data.events[tournament.id]) throw Error('This tournament already exists.');
        if (tournament.ownerId !== identity.uid || tournament.status !== 'registration') throw Error('Invalid local tournament.');
        data.events[tournament.id] = copy(tournament);
        return tournament;
    });
}
function revised(data, id, revision, updater) {
    const current = data.events[id];
    if (!current || current.ownerId !== identity.uid) throw Error('Local tournament not found.');
    if (current.revision !== revision) throw Error('This tournament changed in another tab. Reload before retrying.');
    const next = updater(copy(current));
    if (next.id !== id || next.ownerId !== identity.uid || next.revision !== revision + 1) throw Error('Invalid local revision.');
    if (JSON.stringify(current.formats) !== JSON.stringify(next.formats)) {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== 'blakeout_dev_local_active_game' && !key.startsWith('blakeout_dev_local_match_')) continue;
            let session;
            try { session = JSON.parse(localStorage.getItem(key))?.tournament; } catch { continue; }
            if (!session || session.tournamentId !== id || session.status === 'saved') continue;
            const match = current.matches.find(m => m.id === session.matchId);
            if (match && JSON.stringify(matchFormat(current, match)) !== JSON.stringify(matchFormat(next, match)))
                throw Error('Scoring has already started for a selected match. Finish or correct that match before changing its format.');
        }
    }
    for (const match of current.matches.filter(m => m.status === 'complete')) {
        const updated = next.matches.find(m => m.id === match.id);
        if (JSON.stringify(updated) !== JSON.stringify(match)) data.corrections.push({
            tournamentId: id, matchId: match.id, revision: next.revision, at: Date.now(),
            before: copy(match), after: copy(updated)
        });
    }
    data.events[id] = next;
    return next;
}
export async function updateTournament(id, revision, updater) {
    return write(data => revised(data, id, revision, updater));
}
export async function saveMatchResult(id, revision, resultId, result, updater) {
    return write(data => {
        const receipt = data.results[resultId];
        if (receipt) {
            if (receipt.tournamentId !== id || !sameResult(receipt.result, result))
                throw Error('This result receipt belongs to different scoring.');
            return data.events[id]; // A retry never undoes a later correction.
        }
        const match = data.events[id]?.matches.find(m => m.id === result.matchId);
        if (match?.status !== 'ready') throw Error('Match already recorded or no longer ready.');
        const next = revised(data, id, revision, updater);
        data.results[resultId] = { tournamentId: id, result: copy(result), at: Date.now() };
        return next;
    });
}
export const joinTournament = async () => { throw Error('Local organizer adds people on this device.'); };
export const joinTournamentAsGuest = joinTournament;
