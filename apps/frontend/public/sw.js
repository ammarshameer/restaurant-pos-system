/*
 * Restaurant POS service worker.
 *
 * Makes the POS *load* when the device has no internet (after the first
 * successful visit). It ONLY handles the static app shell:
 *   - Navigations  -> network-first, falling back to the cached index.html.
 *   - Static assets -> stale-while-revalidate.
 *
 * API traffic (`/api`, `/socket.io`, `/health`) is never intercepted or
 * cached — offline data handling is owned by the app's IndexedDB sync engine,
 * which needs to see real network failures.
 */

const CACHE = 'restaurant-pos-shell-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        // Fetch the shell and precache every static asset it references so the
        // POS can cold-boot while offline after a single online visit.
        const response = await fetch('/index.html', { cache: 'reload' });
        if (response && response.ok) {
          await cache.put('/index.html', response.clone());
          const html = await response.text();
          const urls = new Set(SHELL);
          const attrRe = /(?:src|href)="([^"]+)"/g;
          let match;
          while ((match = attrRe.exec(html)) !== null) {
            const asset = match[1];
            if (asset.startsWith('/') && !asset.startsWith('//')) urls.add(asset);
          }
          await Promise.all([...urls].map((url) => cache.add(url).catch(() => undefined)));
        } else {
          await cache.addAll(SHELL).catch(() => undefined);
        }
      } catch {
        await cache.addAll(SHELL).catch(() => undefined);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

function isApiRequest(url) {
  return (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/health')
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Only same-origin requests; the API may live on another origin.
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  // App shell navigations.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
        }
      })()
    );
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      return cached || (await network) || Response.error();
    })()
  );
});
