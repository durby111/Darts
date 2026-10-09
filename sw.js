const CACHE_NAME = 'blakeout-v55-coming-soon';
const APP_SCOPE_PATH = new URL('./', self.location.href).pathname;
const IS_DEV_SCOPE = APP_SCOPE_PATH.endsWith('/dev/');
const NESTED_DEV_PATH = new URL('./dev/', self.location.href).pathname;

function isOwnCache(name) {
    return IS_DEV_SCOPE ? name.startsWith('blakeout-dev-') : /^blakeout-v\d/.test(name);
}

function isOwnPath(url) {
    if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_SCOPE_PATH)) return false;
    return IS_DEV_SCOPE || (url.pathname !== NESTED_DEV_PATH.slice(0, -1) && !url.pathname.startsWith(NESTED_DEV_PATH));
}

const ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./accounts/",
    "./accounts/index.html",
    "./brackets/",
    "./brackets/index.html",
    "./css/casual-recording.css",
    "./css/components.css",
    "./css/dot-better.css",
    "./css/feature-availability.css",
    "./css/games.css",
    "./css/layout.css",
    "./css/platform-nav.css",
    "./css/platform.css",
    "./css/setup.css",
    "./css/tournament-scoring.css",
    "./css/variables.css",
    "./css/winner-celebration.css",
    "./css/winner.css",
    "./js/app.js",
    "./js/baseball.js",
    "./js/bermuda.js",
    "./js/brackets/labels.js",
    "./js/build-context.js",
    "./js/casual-recording.js",
    "./js/chicago.js",
    "./js/cricket.js",
    "./js/doubledown.js",
    "./js/feature-availability.js",
    "./js/firebase-config.js",
    "./js/firebase.js",
    "./js/game121.js",
    "./js/golf.js",
    "./js/hammer.js",
    "./js/picker.js",
    "./js/platform-nav.js",
    "./js/registry.js",
    "./js/robinhood.js",
    "./js/scoring-records.js",
    "./js/settings.js",
    "./js/setup.js",
    "./js/shanghai.js",
    "./js/state.js",
    "./js/target_game.js",
    "./js/teamcricket.js",
    "./js/teams.js",
    "./js/theme.js",
    "./js/tictactoe.js",
    "./js/tournament-bridge.js",
    "./js/ui.js",
    "./js/x01.js",
    "./assets/background.jpg",
    "./assets/icon-192.png",
    "./assets/icon-512.png",
    "./assets/logo.png",
    "./assets/qr-prod.svg",
    "./assets/wallpapers/carbon.svg",
    "./assets/wallpapers/felt.svg",
    "./assets/wallpapers/slate.svg",
    "./assets/wallpapers/wood.svg"
];

// Same-origin app code has no version query string, and ES module imports
// (app.js -> x01.js -> ...) can't get one without rewriting every import.
// GitHub Pages serves these with max-age, so a plain fetch can hand back a
// stale file for minutes after a deploy — which shows up as a fresh
// index.html running old CSS/JS. Force a revalidation for them instead;
// unchanged files still come back as a cheap 304.
const REVALIDATE = /\.(?:js|css|json)$/i;

function shouldRevalidate(request) {
    if (request.mode === 'navigate') return false;  // browser already does
    const url = new URL(request.url);
    return isOwnPath(url) && REVALIDATE.test(url.pathname);
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(
            // cache:'reload' skips the HTTP cache, so a new SW version can
            // never precache the files the old one was already serving.
            ASSETS.map((url) => new Request(url, { cache: 'reload' }))
        ))
    );
    // Activate immediately — don't wait for old SW to release
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Keep production and DEV offline cache families isolated.
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => isOwnCache(k) && k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Only our own files and the Firebase SDK belong in Cache Storage. Caching
// every successful cross-origin GET persisted third-party responses on shared
// devices and bloated the cache for no offline benefit.
const SDK_ORIGIN = 'https://www.gstatic.com';

function isCacheable(request) {
    const url = new URL(request.url);
    if (url.searchParams.has('oobCode') || url.searchParams.has('apiKey')) return false;
    if (url.origin === self.location.origin) return isOwnPath(url);
    return url.origin === SDK_ORIGIN && url.pathname.startsWith('/firebasejs/');
}

self.addEventListener('fetch', (event) => {
    // Network-first: always try network, fall back to cache offline
    const request = event.request;
    const networkRequest = shouldRevalidate(request)
        ? new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : request;
    event.respondWith(
        fetch(networkRequest).then((response) => {
            if (response.ok && request.method === 'GET' && isCacheable(request)) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
        }).catch(() => {
            return caches.open(CACHE_NAME).then(cache => cache.match(request));
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
