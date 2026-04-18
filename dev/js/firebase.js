/* ============================================
   Firebase wrapper — roster sync via Firestore.
   Offline-first: the SDK queues writes locally and
   replays them when the device comes back online.

   All Firebase imports are loaded dynamically inside
   initFirebase() so a missing firebase-config.js
   (gitignored, may not exist in every deploy) cannot
   break the module graph for the rest of the app.
   ============================================ */

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.13.2";

let app, db, auth;
let sdk = null;              // resolved Firestore SDK fns after init
let rosterCache = [];
let rosterListeners = [];
let initState = 'pending';   // pending | ready | error
let initError = null;

export async function initFirebase() {
    try {
        // Dynamic imports — failures here are caught and logged, not thrown
        // up the module graph, so setup.js etc. are unaffected.
        const cfgMod = await import('./firebase-config.js');
        const appMod = await import(`${SDK_BASE}/firebase-app.js`);
        const authMod = await import(`${SDK_BASE}/firebase-auth.js`);
        const fsMod = await import(`${SDK_BASE}/firebase-firestore.js`);

        sdk = {
            collection: fsMod.collection,
            doc: fsMod.doc,
            setDoc: fsMod.setDoc,
            deleteDoc: fsMod.deleteDoc,
            onSnapshot: fsMod.onSnapshot,
            serverTimestamp: fsMod.serverTimestamp,
        };

        app = appMod.initializeApp(cfgMod.firebaseConfig);
        db = fsMod.getFirestore(app);
        auth = authMod.getAuth(app);

        // IndexedDB persistence — must be enabled BEFORE any other Firestore call.
        // Fails silently in browsers that don't support it (Safari private mode,
        // multiple tabs, etc). The app still works in those cases.
        try {
            await fsMod.enableIndexedDbPersistence(db);
        } catch (err) {
            console.warn('[Firebase] offline persistence unavailable:', err.code);
        }

        await authMod.signInAnonymously(auth);

        // Live roster snapshot. Re-fires on every remote change AND on local
        // writes from this device, so the UI always reflects current state.
        sdk.onSnapshot(
            sdk.collection(db, 'roster'),
            (snap) => {
                rosterCache = snap.docs
                    .map(d => d.data())
                    .filter(d => d && d.email && d.name)
                    .sort((a, b) => a.name.localeCompare(b.name));
                if (initState !== 'ready') initState = 'ready';
                rosterListeners.forEach(fn => { try { fn(rosterCache); } catch (e) { console.error(e); } });
            },
            (err) => {
                console.warn('[Firebase] roster listener error:', err);
                initState = 'error';
                initError = err;
                rosterListeners.forEach(fn => { try { fn(rosterCache); } catch (e) { console.error(e); } });
            }
        );
    } catch (err) {
        console.warn('[Firebase] init skipped/failed:', err?.message || err);
        initState = 'error';
        initError = err;
        // Notify listeners so the UI can show "(offline)".
        rosterListeners.forEach(fn => { try { fn(rosterCache); } catch (e) { console.error(e); } });
    }
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
 * Add or update a roster player. Doc ID is the email lowercased + trimmed.
 * Uses merge: true so future stats writes don't clobber profile fields.
 */
export async function upsertPlayer({ email, name }) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new Error('name required');
    if (!db || !sdk) throw new Error('Roster is offline. Check your connection and refresh.');

    // Players without an email get a synthetic local-only ID. Their stats
    // accrue on whichever device entered them (no cross-device merge).
    // The id is stored as the `email` field so Firestore rules — which require
    // request.resource.data.email == doc id — still pass.
    const id = normalizeEmail(email) || `noemail-${cryptoId()}`;

    const ref = sdk.doc(db, 'roster', id);
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

export function isRealEmail(value) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function deletePlayer(email) {
    const id = normalizeEmail(email);
    if (!id || !db || !sdk) return;
    await sdk.deleteDoc(sdk.doc(db, 'roster', id));
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
