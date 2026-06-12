const CACHE = 'snake-cats-v3';
const ASSETS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png',
  '/avatars/maru.png', '/avatars/xiaoyu1.png', '/avatars/xiaoyu2.png',
  '/avatars/abai.png', '/avatars/dian.png',
  '/avatars/maru_sheet.png', '/avatars/xiaoyu1_sheet.png', '/avatars/xiaoyu2_sheet.png',
  '/avatars/abai_sheet.png', '/avatars/dian_sheet.png'];

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
