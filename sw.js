const CACHE_NAME = 'cse-portal-v3';

// Critical local files — এগুলো না থাকলে app চলবে না
const LOCAL_ASSETS = [
  '/',
  '/index.html',
  '/js/app.js',
  '/js/tailwind.js',
  '/css/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// pdfjs — offline PDF preview-এর জন্য আবশ্যক
const PDFJS_ASSETS = [
  '/pdfjs/web/viewer.html',
  '/pdfjs/web/viewer.css',
  '/pdfjs/web/viewer.mjs',
  '/pdfjs/build/pdf.mjs',
  '/pdfjs/build/pdf.worker.mjs',
  '/pdfjs/build/pdf.sandbox.mjs',
];

// CDN assets — font icon সহ
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

// একটা resource cache করতে ব্যর্থ হলেও বাকিগুলো চলবে
async function cacheIndividually(cache, urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) await cache.put(url, res);
    } catch (err) {
      console.warn('[SW] Cache failed (skipping):', url);
    }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Step 1: Local assets — এগুলো অবশ্যই cache হতে হবে
      await cache.addAll(LOCAL_ASSETS);
      console.log('[SW] Local assets cached.');

      // Step 2: pdfjs — fail হলেও চলবে
      await cacheIndividually(cache, PDFJS_ASSETS);
      console.log('[SW] pdfjs assets cached.');

      // Step 3: CDN assets — প্রতিটা আলাদাভাবে, fail হলেও চলবে
      await cacheIndividually(cache, CDN_ASSETS);
      console.log('[SW] CDN assets cached.');
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // API calls — SW bypass করো সবসময়
  if (url.includes('varsity-portal-api')) return;

  // GET ছাড়া অন্য method — bypass
  if (e.request.method !== 'GET') return;

  // Page navigation — offline হলে cached index.html দাও
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // বাকি সব — Cache First, তারপর Network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(response => {
        // Successful response হলে cache-এ রাখো (dynamic caching)
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // HTML request fail হলে index.html দাও
        if (e.request.headers.get('Accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
