const CACHE = 'caveli-v3';
const HTML_FILE = './distribucion-app.html';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add('./manifest.json')));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Para el HTML principal: red primero, caché como fallback offline
  if (e.request.url.includes('distribucion-app.html') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          var clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Para el resto: caché primero
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match(HTML_FILE)))
  );
});
