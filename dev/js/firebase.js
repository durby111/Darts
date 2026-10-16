/* DEV scorer cloud roster/usage synchronization is deliberately disabled.
   Keep local roster APIs for compatibility without opening legacy Firebase
   apps, persistence queues, or anonymous sessions. */

let db;
let sdk = null;              // resolved Firestore SDK fns after init
let rosterCache = [];
let rosterListeners = [];
let initState = 'pending';   // pending | ready | error
let initError = null;

/* ============================================
   Legacy private-roster helpers (sync disabled in this DEV candidate)
   ============================================
   The roster used to live in ONE global `roster` collection, so any client
   — including an anonymous stranger — could read every player's name and
   email, and delete any of them. Anonymous auth is open, so
   `request.auth != null` gated nothing.

   Each install now owns a private roster at:

       rosters/{rosterId}/players/{playerId}

   `rosterId` is 128 bits of crypto randomness held in localStorage. It is
   never listed or discoverable: Firestore rules match only this exact
   path shape, and collection-group queries on `players` are refused
   because that requires a recursive-wildcard rule we deliberately don't
   write. So a roster is reachable only by someone who already knows its id.

   Sharing is explicit and opt-in: `?roster=<id>` adopts an existing roster
   (used by the Share link), which is how a couple or a bar crew keep one
   list across devices.

   TRADEOFF — this is capability-link security, like an unlisted video URL.
   Anyone holding the link has full access to that roster. It is not per-
   account isolation; that would require real (non-anonymous) sign-in.
   ============================================ */

const ROSTER_ID_KEY = 'blakeout_darts_dev_roster_id';
const ROSTER_ID_RE = /^[0-9a-f]{32}$/;

// Mirrors the cap enforced by the Firestore rules, so an over-long name is
// trimmed here instead of being rejected by the server with a vague error.
export const MAX_NAME_LENGTH = 40;

function randomRosterId() {
    const bytes = new Uint8Array(16);           // 128 bits
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The roster this device belongs to. Adopts `?roster=<id>` when present
 * (then strips it from the URL so the id doesn't linger in screenshots or
 * the back stack), otherwise reuses or mints a private id.
 */
export function getRosterId() {
    let adopted = null;
    try {
        const fromUrl = new URLSearchParams(location.search).get('roster');
        if (fromUrl && ROSTER_ID_RE.test(fromUrl)) adopted = fromUrl;
    } catch { /* ignore malformed URLs */ }

    let id = null;
    try {
        id = localStorage.getItem(ROSTER_ID_KEY);
    } catch { /* private mode */ }

    if (adopted && adopted !== id) {
        id = adopted;
        try { localStorage.setItem(ROSTER_ID_KEY, id); } catch { /* non-fatal */ }
    }
    if (!id || !ROSTER_ID_RE.test(id)) {
        id = randomRosterId();
        try { localStorage.setItem(ROSTER_ID_KEY, id); } catch { /* non-fatal */ }
    }

    if (adopted) {
        // Keep the id out of the visible URL once it's stored.
        try {
            const url = new URL(location.href);
            url.searchParams.delete('roster');
            history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch { /* non-fatal */ }
    }
    return id;
}

/** Shareable link that lets another device join this roster. */
export function getRosterShareUrl() {
    throw new Error('DEV cloud roster sharing is disabled; existing roster data is unchanged.');
}

function playersCollection() {
    return sdk.collection(db, 'rosters', getRosterId(), 'players');
}

function playerDoc(id) {
    return sdk.doc(db, 'rosters', getRosterId(), 'players', id);
}

export async function initFirebase() {
    // Anonymous Auth is off in the isolated project. Do not initialize a default
    // app, reopen old IndexedDB queues, sync a production roster or send usage writes.
    initState = 'error';
    initError = new Error('DEV cloud roster and usage sync are disabled. Local scoring remains available.');
    rosterListeners.forEach(fn => { try { fn(rosterCache); } catch (e) { console.error(e); } });
}

export function getRosterCache() {
    return rosterCache;
}

export function getInitState() {
    return { state: initState, error: initError };
}

/**
 * Subscribe to roster changes. Calls back immediately with current cache
 * if init has completed. Returns an unsubscribe function.
 */
export function onRosterChange(fn) {
    rosterListeners.push(fn);
    if (initState === 'ready' || initState === 'error') {
        try { fn(rosterCache); } catch (e) { console.error(e); }
    }
    return () => { rosterListeners = rosterListeners.filter(f => f !== fn); };
}

/**
 * Add or update a roster player. Doc ID is the email lowercased + trimmed,
 * inside this device's private roster.
 * Uses merge: true so future stats writes don't clobber profile fields.
 */
export async function upsertPlayer({ email, name }) {
    const cleanName = (name || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!cleanName) throw new Error('name required');
    if (!db || !sdk) throw new Error('Roster is offline. Check your connection and refresh.');

    // Players without an email get a synthetic local-only ID. Their stats
    // accrue on whichever device entered them (no cross-device merge).
    // The id is stored as the `email` field so Firestore rules — which require
    // request.resource.data.email == doc id — still pass.
    const id = normalizeEmail(email) || `noemail-${cryptoId()}`;

    const ref = playerDoc(id);
    await sdk.setDoc(ref, {
        email: id,
        name: cleanName,
        updatedAt: sdk.serverTimestamp()
    }, { merge: true });
}

function cryptoId() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================
   Monthly usage counter
   ============================================
   Answers "roughly how many devices used the app this month?" without any
   analytics vendor and without storing anything about a person. One doc per
   month holds a single integer:

       usage/2026-07       { month: '2026-07',     devices: 42 }
       usage/2026-07-dev   { month: '2026-07-dev', devices: 3 }

   Dev and production share one Firebase project, so the dev build counts
   into its own `-dev` doc and can't inflate the real number.

   Each device increments a given month at most once, gated by localStorage
   ('blakeout_usage_month'). That makes this a monthly-active-DEVICES count,
   not people: two devices used by one player count twice, and clearing site
   data lets a device count again.

   Firestore rules must allow the exact +1 pattern (see CLAUDE.md). If they
   don't, the write is rejected and the app carries on unaffected.
   ============================================ */

const USAGE_KEY = 'blakeout_usage_month';

function currentUsagePeriod() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const isDev = document.body && document.body.classList.contains('dev-build');
    return isDev ? `${month}-dev` : month;
}

// Local servers are the test battery and hand testing — never real usage.
function isCountableHost() {
    const host = location.hostname;
    return !!host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
}

/**
 * Count this device once for the current month. Safe to call on every load.
 * Never throws and never blocks: offline writes queue in IndexedDB and
 * replay on reconnect, which is why the local marker is set as soon as the
 * write is enqueued rather than when the server acknowledges it.
 *
 * `deps` exists so the test battery can drive this with a stub Firestore —
 * the battery runs on localhost, which is deliberately never counted.
 * Production calls it with no arguments.
 */
export function recordMonthlyUsage(deps = {}) {
    const activeDb = deps.db || db;
    const activeSdk = deps.sdk || sdk;
    const countable = deps.countableHost === undefined ? isCountableHost() : deps.countableHost;
    if (!activeDb || !activeSdk || !countable) return;

    const period = currentUsagePeriod();
    let alreadyCounted = null;
    try {
        alreadyCounted = localStorage.getItem(USAGE_KEY);
    } catch { /* private mode — count, but we may recount next load */ }
    if (alreadyCounted === period) return;

    try {
        localStorage.setItem(USAGE_KEY, period);
    } catch { /* non-fatal */ }

    activeSdk.setDoc(
        activeSdk.doc(activeDb, 'usage', period),
        { month: period, devices: activeSdk.increment(1) },
        { merge: true }
    ).catch(err => {
        // Most likely a missing or stricter Firestore rule. Roll the marker
        // back so a later load can retry instead of losing the month.
        try { localStorage.removeItem(USAGE_KEY); } catch { /* ignore */ }
        console.warn('[Firebase] usage ping skipped:', err?.code || err);
    });
}

/**
 * Read the counter for a month, e.g. getMonthlyUsage('2026-07').
 * Defaults to the current period. Returns null when unavailable.
 */
export async function getMonthlyUsage(period = currentUsagePeriod()) {
    if (!db || !sdk || !sdk.getDoc) return null;
    try {
        const snap = await sdk.getDoc(sdk.doc(db, 'usage', period));
        return snap.exists() ? (snap.data().devices || 0) : 0;
    } catch (err) {
        console.warn('[Firebase] usage read failed:', err?.code || err);
        return null;
    }
}

export function isRealEmail(value) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function deletePlayer(email) {
    const id = normalizeEmail(email);
    if (!id || !db || !sdk) return;
    await sdk.deleteDoc(playerDoc(id));
}

export function findPlayerByName(name) {
    const lower = (name || '').trim().toLowerCase();
    if (!lower) return null;
    return rosterCache.find(p => p.name.toLowerCase() === lower) || null;
}

export function findPlayerByEmail(email) {
    const id = normalizeEmail(email);
    if (!id) return null;
    return rosterCache.find(p => p.email === id) || null;
}

function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
}
