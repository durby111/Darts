/* DEV scorer cloud roster/usage synchronization is deliberately disabled.
   Keep local roster APIs for compatibility without opening legacy Firebase
   apps, persistence queues, or anonymous sessions. */

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

/** Keep validation and the disabled-write error for existing setup callers. */
export async function upsertPlayer({ email, name }) {
    const cleanName = (name || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!cleanName) throw new Error('name required');
    throw new Error('Roster is offline. Check your connection and refresh.');
}

// Retained injected-adapter test/compatibility seam. The DEV app supplies no
// database or SDK and never sends usage writes; production has its own module.
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
 * With no injected adapter this disabled DEV implementation is a no-op.
 */
export function recordMonthlyUsage(deps = {}) {
    const activeDb = deps.db;
    const activeSdk = deps.sdk;
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
    // Preserve the read API without retaining unreachable Firestore work.
    return null;
}

export function isRealEmail(value) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function deletePlayer(email) {
    normalizeEmail(email); // Preserve argument validation for existing callers.
    // Cloud roster sync is disabled; retain the existing no-op.
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
