// Service Worker for Calculated Risk PWA
const CACHE_NAME = 'calculated-risk-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/js/main.js',
  '/js/game.js',
  '/js/ui.js',
  '/js/state.js',
  '/js/constants.js',
  '/js/ai.js',
  '/js/audio.js',
  '/js/combat.js',
  '/js/pathfinding.js',
  '/js/storage.js',
  '/js/controller.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install - cache assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          // Cache new requests
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        // Offline fallback
        if (e.request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});
