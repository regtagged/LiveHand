/**
 * Offline shell. The whole app is static, so a plain cache-first strategy is
 * enough — and it is the point of the exercise: hands get typed at a table
 * where there is often no usable signal.
 */
// Stamped with the build id at deploy time. The cache is keyed by it, so a new
// deploy lands in a new cache and `activate` drops the old one — without that,
// a cache-first worker serves the first version it ever saw, for ever, and a
// fix pushed later never reaches a phone that has already opened the app.
const CACHE = 'livehand-__BUILD_ID__';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'canvas.js', 'store.js', 'icon.svg',
  'manifest.webmanifest',
  'src/core/amount.js', 'src/core/cards.js', 'src/core/engine.js', 'src/core/equity.js',
  'src/core/evaluate.js', 'src/core/hand.js', 'src/core/narrate.js', 'src/core/positions.js',
  'src/export/textHH.js', 'src/export/replayer.js',
  'src/render/scene.js', 'src/render/svg.js', 'src/render/ggSheet.js', 'src/render/tableSheet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('index.html'))),
  );
});
