import { assertDevConfig } from './backend-context.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.13.2';
// Separate, memory-only Firebase app. Never touches the owner's named app.
export async function createSharedPlayerAuth(load = path => import(path)) {
    const [config, apps, sdk] = await Promise.all([
        load('./firebase-config.js'), load(`${SDK}/firebase-app.js`), load(`${SDK}/firebase-auth.js`)
    ]);
    assertDevConfig(config.firebaseConfig);
    const app = apps.initializeApp(config.firebaseConfig, `blakeout-dev-player-${crypto.randomUUID()}`);
    let auth, pending, closed = false, closing;
    try { auth = sdk.initializeAuth(app, { persistence: sdk.inMemoryPersistence }); }
    catch (error) { await apps.deleteApp(app); throw error; }
    return {
        async signIn(email, password) {
            if (closed || pending) throw new Error('Sign-in unavailable.');
            pending = (async () => {
                const result = await sdk.signInWithEmailAndPassword(auth, email, password);
                const user = result.user;
                await sdk.reload(user);
                const { claims } = await sdk.getIdTokenResult(user, true);
                const age = Date.now() / 1000 - Number(claims.auth_time);
                if (closed || auth.currentUser !== user || user.isAnonymous || !user.emailVerified
                    || claims.email_verified !== true || claims.sub !== user.uid
                    || !Number.isFinite(age) || age < -60 || age > 300) {
                    throw new Error('A fresh, verified player sign-in is required.');
                }
                // Never return a token or refresh token to the UI/session roster.
                return { id: user.uid, name: user.displayName || '', email: user.email || '', expiresAt: (Number(claims.auth_time) + 300) * 1000 };
            })();
            return pending;
        },
        close() {
            if (!closing) {
                closed = true;
                closing = (async () => {
                    // A canceled request can finish late: clean up after it settles.
                    try { await pending; } catch {}
                    try { await sdk.signOut(auth); }
                    finally { await apps.deleteApp(app); }
                })();
            }
            return closing;
        }
    };
}
