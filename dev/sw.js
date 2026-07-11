const CACHE_NAME = 'blakeout-dev-v13';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/variables.css',
    './css/layout.css',
    './css/components.css',
    './css/games.css',
    './css/dev.css',
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

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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

self.addEventListener('fetch', (event) => {
    // Network-first: always try network, fall back to cache offline
    event.respondWith(
        fetch(event.request).then((response) => {
            if (response.ok && event.request.method === 'GET') {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
        }).catch(() => {
            return caches.match(event.request);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
