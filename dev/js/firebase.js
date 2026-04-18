/* ============================================
   Firebase wrapper — roster sync via Firestore.
   Offline-first: the SDK queues writes locally and
   replays them when the device comes back online.
   ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
    getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot,
    serverTimestamp, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let app, db, auth;
let rosterCache = [];
let rosterListeners = [];
let initState = 'pending';   // pending | ready | error
let initError = null;

/**
 * Initialize Firebase, sign in anonymously, attach a live roster listener.
 * Safe to call once at app start. Failures are non-fatal — the rest of the
 * app still works, the roster section just shows an error.
 */
export async function initFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // IndexedDB persistence — must be enabled BEFORE any other Firestore call.
        // Fails silently in browsers that don't support it (Safari private mode,
        // multiple tabs, etc). The app still works in those cases.
        try {
            await enableIndexedDbPersistence(db);
        } catch (err) {
            console.warn('[Firebase] offline persistence unavailable:', err.code);
        }

        await signInAnonymously(auth);

        // Live roster snapshot. Re-fires on every remote change AND on local
        // writes from this device, so the UI always reflects current state.
        onSnapshot(
            collection(db, 'roster'),
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
        console.error('[Firebase] init failed:', err);
        initState = 'error';
        initError = err;
        throw err;
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
    const id = normalizeEmail(email);
    const cleanName = (name || '').trim();
    if (!id) throw new Error('email required');
    if (!cleanName) throw new Error('name required');
    if (!db) throw new Error('Firebase not initialized');

    const ref = doc(db, 'roster', id);
    await setDoc(ref, {
        email: id,
        name: cleanName,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

export async function deletePlayer(email) {
    const id = normalizeEmail(email);
    if (!id || !db) return;
    await deleteDoc(doc(db, 'roster', id));
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
