// オフライン用キャッシュ。オンラインなら最新を取りに行き、オフラインならキャッシュを使う
const CACHE = 'scenario-editor-v3';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/parser.js', 'js/layout.js', 'js/render.js', 'js/export.js',
  'icons/icon-180.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
