/**
 * WMD Player - Service Worker
 * 
 * WHY: Service workers enable PWA functionality including:
 * - Offline caching of the player shell (HTML, CSS, JS)
 * - Installability on supported platforms
 * - Background caching strategies
 * 
 * NOTE: Audio files are NOT cached because:
 * 1. They're loaded dynamically via File API (user-selected)
 * 2. They can be very large (hundreds of MB)
 * 3. Cache storage has limits
 */

const CACHE_NAME = 'wmd-player-v1';

// Files to cache for offline use
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

/**
 * Install Event
 * WHY: Pre-cache essential files during installation so the app
 * shell is available even when offline
 */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                // WHY: skipWaiting forces the new SW to activate immediately
                // instead of waiting for all tabs to close
                return self.skipWaiting();
            })
    );
});

/**
 * Activate Event
 * WHY: Clean up old caches when a new version of the SW is activated
 */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                // WHY: clients.claim() allows the SW to control all pages immediately
                // without waiting for a reload
                return self.clients.claim();
            })
    );
});

/**
 * Fetch Event
 * WHY: Intercept network requests to serve cached content when available
 * Strategy: Cache-first for static assets, network-only for everything else
 */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // WHY: Return cached version immediately for fast load times
                    return cachedResponse;
                }

                // WHY: If not in cache, fetch from network
                return fetch(event.request)
                    .then((networkResponse) => {
                        // Don't cache non-successful responses or non-GET requests
                        if (!networkResponse || networkResponse.status !== 200 || event.request.method !== 'GET') {
                            return networkResponse;
                        }

                        // Clone the response before caching
                        // WHY: Response streams can only be read once, so we clone
                        const responseToCache = networkResponse.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return networkResponse;
                    });
            })
            .catch(() => {
                // WHY: Fallback for when both cache and network fail
                // Return a basic offline page or message
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            })
    );
});
