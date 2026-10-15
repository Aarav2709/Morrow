// keeps the web version of morrow working offline, it only ever caches morrow's own files
const CACHE = 'morrow-shell-v1';
const SHELL = ['./', './index.html', './icon.svg', './icon.png', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const keep = (request, response) => {
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    void caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // pages come from the network when it is there, so updates arrive, and from the cache when it is not
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => keep(request, response))
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  // built files have content hashes in their names, a cached copy is always the right one
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((response) => keep(request, response))));
});
