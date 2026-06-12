const CACHE = 'snake-cats-v2';
const ASSETS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png',
  '/avatars/greycat.png', '/avatars/chinchilla.png', '/avatars/tabby.png',
  '/avatars/creamcat.png', '/avatars/puppy.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
// network-first, fallback to cache (game needs live server anyway)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
