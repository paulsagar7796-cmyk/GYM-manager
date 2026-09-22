/**
 * App-shell service worker.
 *
 * The whole app is one static page plus hashed assets, and all data lives in
 * localStorage, so caching the shell is enough to make it work with no network
 * at all -- which is the point, because gym floors and basements rarely have a
 * usable signal.
 *
 * Bump CACHE when the caching strategy itself changes; hashed asset names mean
 * ordinary deploys do not need it.
 */
const CACHE = "gym-manager-shell-v1";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Hashed build assets never change contents, so cache wins and saves the trip. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/** Pages go to the network first so a deploy is picked up, cache is the safety net. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put("/", response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match("/"));
    if (cached) return cached;
    throw new Error("offline and nothing cached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs are cacheable, and another origin's responses are not ours to store.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(
    cacheFirst(request).catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
  );
});
