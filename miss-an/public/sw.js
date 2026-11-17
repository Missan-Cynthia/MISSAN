const cacheName = 'miss-an-m1-shell-v2';
const shell = ['./', './index.html', './style.css', './app.js', './config.js', './core.js', './cloud.js', './wardrobe.js', './logo.png', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
const urls = new Set(shell.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell))));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('miss-an-m1-shell-') && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!urls.has(url.href)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(cacheName).then(cache => cache.match(event.request))));
});
