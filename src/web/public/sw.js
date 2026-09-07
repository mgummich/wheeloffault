// App-shell cache. /api is never cached: history must always come from the server.
// Note: sw.test.ts runs this file in a VM and reads `cacheableResponse` from the
// context — that only works while this script stays sloppy-mode (no 'use strict').
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `schuldrad-shell:${SCOPE.pathname}:`;
const CACHE = `${CACHE_PREFIX}v2`;
const shellUrl = (path) => new URL(path, SCOPE).href;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icon.svg'].map(shellUrl);

function cacheableResponse(response) {
  return response.ok && response.type === 'basic';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== SCOPE.origin ||
    !url.pathname.startsWith(SCOPE.pathname)
  )
    return;
  const path = url.pathname.slice(SCOPE.pathname.length);
  if (path.startsWith('api/')) return;

  if (path.startsWith('assets/')) {
    // Hashed, immutable build output: cache first.
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            if (cacheableResponse(res)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Shell: network first, cache as offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (cacheableResponse(res)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (hit) =>
              hit ??
              (event.request.mode === 'navigate'
                ? caches.match(shellUrl('index.html'))
                : Response.error()),
          ),
      ),
  );
});
