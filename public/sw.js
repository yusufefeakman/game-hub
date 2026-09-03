/* Pixel Arcade service worker — offline app shell caching */
const CACHE = "pixel-arcade-v1";
const BASE = "/game-hub";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        `${BASE}/`,
        `${BASE}/icons/icon-192.png`,
        `${BASE}/icons/icon-512.png`,
      ]).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for pages (so updates show), cache fallback offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match(`${BASE}/`))
    );
    return;
  }
  // Stale-while-revalidate for assets
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
