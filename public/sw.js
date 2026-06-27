// Service Worker — MonPlan90J
// Cache pour fonctionnement hors-ligne, MAIS toujours la dernière version en priorité quand on est en ligne.

const CACHE_NAME = 'monplan90-v3'; // bump à chaque fix important du SW lui-même
const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg',
  '/manifest.json'
];

// Installation — mise en cache des assets statiques (icônes, manifest — changent rarement)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activation — nettoyage des vieux caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — Network First pour tout : toujours la dernière version si en ligne.
// Le cache ne sert que de secours si le réseau échoue (vraiment hors-ligne).
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls → toujours réseau, jamais de cache
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname) {
    return;
  }

  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      // Hors-ligne — on retombe sur le cache si on en a un
      return caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
