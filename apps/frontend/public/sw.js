/* Retired worker: unregisters itself and clears caches from the previous app-shell build. */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  self.registration.unregister()
    .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .then((clients) => clients.forEach((client) => client.navigate(client.url)))
    .catch(() => undefined);

  if (self.caches) {
    self.caches.keys()
      .then((keys) => Promise.all(keys.map((key) => self.caches.delete(key))))
      .catch(() => undefined);
  }
});

self.addEventListener('fetch', () => {
  // Pass everything through to the network; no caching is performed.
});
