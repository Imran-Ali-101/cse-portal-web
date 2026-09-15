const CACHE_NAME = 'cse-portal-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/js/app.js',
  '/js/tailwind.js',
  '/css/style.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // API calls — skip SW entirely
  if (e.request.url.includes('varsity-portal-api')) return;

  // Navigation requests (page load/refresh) — always serve index.html from cache if offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets — cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
