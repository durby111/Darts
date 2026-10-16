// Local candidate for the isolated DEV project. This does not open release gates.
export const DEV_BACKEND = 'blakeout-darts-dev';
export const DEV_APP_ID = '1:901185136996:web:89d4f413520e66ff773271';
export const BACKEND_KEY = DEV_BACKEND + ':' + DEV_APP_ID;
export function assertDevConfig(config) {
    if (config?.projectId !== DEV_BACKEND || config?.appId !== DEV_APP_ID ||
        config?.authDomain !== DEV_BACKEND + '.firebaseapp.com') {
        throw new Error('DEV backend configuration does not match the isolated project. No connection was made.');
    }
}
export function requireCurrentBackend(session) {
    if (session?.backendKey !== BACKEND_KEY) {
        throw new Error('This record belongs to an older or unknown backend. It is kept on this device and cannot be sent to the new DEV project. Start a new recorded game with newly selected profiles.');
    }
}
