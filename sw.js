const CACHE_NAME = 'blakeout-v37';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/variables.css',
    './css/layout.css',
    './css/components.css',
    './css/games.css',
    './js/app.js',
    './js/state.js',
    './js/ui.js',
    './js/setup.js',
    './js/registry.js',
    './js/picker.js',
    './js/cricket.js',
    './js/x01.js',
    './js/chicago.js',
    './js/game121.js',
    './js/baseball.js',
    './js/bermuda.js',
    './js/golf.js',
    './js/shanghai.js',
    './js/hammer.js',
    './js/tictactoe.js',
    './js/robinhood.js',
    './js/doubledown.js',
    './js/teamcricket.js',
    './js/target_game.js',
    './js/theme.js',
    './js/settings.js',
    './assets/background.jpg',
    './assets/wallpapers/slate.svg',
    './assets/wallpapers/felt.svg',
    './assets/wallpapers/wood.svg',
    './assets/wallpapers/carbon.svg',
    './assets/logo.png',
    './assets/qr-prod.svg'
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
    return url.origin === self.location.origin && REVALIDATE.test(url.pathname);
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
    // Delete ALL old caches
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Only our own files and the Firebase SDK belong in Cache Storage. Caching
// every successful cross-origin GET persisted third-party responses on shared
// devices and bloated the cache for no offline benefit.
const SDK_ORIGIN = 'https://www.gstatic.com';

function isCacheable(request) {
    const url = new URL(request.url);
    if (url.origin === self.location.origin) return true;
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
            return caches.match(request);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
