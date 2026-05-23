// Service Worker for Calculated Risk PWA
// Bump CACHE_VERSION to invalidate all caches (e.g., after deploy)
const CACHE_VERSION = 450;
const CACHE_NAME = `calculated-risk-v${CACHE_VERSION}`;

// Critical assets to pre-cache on install (app shell only)
// Everything else gets cached dynamically on first fetch
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Never cache these — always hit the network
const NETWORK_ONLY = [
  '/socket.io/',    // WebSocket connections
  '/api/replays',   // Replay CRUD (changes every battle)
  '/api/debug/'     // Debug endpoints
];

// API routes that serve static-ish data — cache, but revalidate in background
// Writes (POST/PUT/DELETE) to these paths bust the cache automatically
const STALE_REVALIDATE = [
  '/api/insignia',       // User-created insignia (rarely changes)
  '/api/variants',       // Unit skin variants
  '/api/terrain/sprites',// Terrain sprite manifest
  '/api/units',          // Unit definitions
  '/api/sprites',        // Sprite data
  '/api/parts'           // Sprite parts
];

function getStrategy(url) {
  const path = new URL(url).pathname;
  if (NETWORK_ONLY.some(p => path.startsWith(p))) return 'network';
  if (STALE_REVALIDATE.some(p => path.startsWith(p))) return 'stale-revalidate';
  return 'cache-first';
}

// Install — pre-cache app shell, then activate immediately
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate — delete old version caches, claim all clients
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (e) => {
  const method = e.request.method;

  // Non-GET writes: bust cache for stale-revalidate API routes
  if (method !== 'GET') {
    const strategy = getStrategy(e.request.url);
    if (strategy === 'stale-revalidate') {
      // Delete cached entries matching this API path so next GET is fresh
      e.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
          cache.keys().then(keys => {
            const path = new URL(e.request.url).pathname;
            return Promise.all(
              keys.filter(k => new URL(k.url).pathname.startsWith(path))
                  .map(k => cache.delete(k))
            );
          })
        )
      );
    }
    return; // Let the write go to network normally
  }

  const strategy = getStrategy(e.request.url);

  // Network-only: don't intercept
  if (strategy === 'network') return;

  // Stale-while-revalidate: serve cache immediately, update in background
  if (strategy === 'stale-revalidate') {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request).then(response => {
            if (response.status === 200) {
              cache.put(e.request, response.clone());
            }
            return response;
          });
          // Return cached immediately if available, otherwise wait for network
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Cache-first: static assets (JS, images, fonts, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(response => {
        // Cache 200s and 404s — 404s prevent repeated retries for missing sprites
        if (response.status === 200 || response.status === 404) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (e.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});

// Listen for cache-bust message from client
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
