// Derive isolation from this deployed module's location, never from cosmetic
// DEV labels or the currently open page's query string.
export const APP_BASE_URL = new URL('../', import.meta.url).href;
export const IS_DEV_BUILD = new URL(APP_BASE_URL).pathname.endsWith('/dev/');

export const BUILD_STORAGE = Object.freeze({
    activeGame: IS_DEV_BUILD ? 'blakeout_dev_active_game' : 'blakeout_active_game',
    legacyImport: IS_DEV_BUILD ? 'blakeout_dev_active_game_imported' : null,
    matchRecoveryPrefix: IS_DEV_BUILD ? 'blakeout_dev_match_' : 'blakeout_match_',
    casualRecoveryPrefix: IS_DEV_BUILD ? 'blakeout_dev_casual_' : 'blakeout_casual_'
});

export function isBuildCache(name) {
    return IS_DEV_BUILD ? name.startsWith('blakeout-dev-') : /^blakeout-v\d/.test(name);
}

export async function clearBuildCaches(cacheStorage) {
    const keys = await cacheStorage.keys();
    await Promise.all(keys.filter(isBuildCache).map(key => cacheStorage.delete(key)));
}

export async function getBuildServiceWorker(serviceWorkers) {
    const registrations = await serviceWorkers.getRegistrations();
    return registrations.find(registration => registration.scope === APP_BASE_URL) || null;
}
