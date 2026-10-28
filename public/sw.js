/* Pixel Arcade service worker — offline app shell caching */
const CACHE = "pixel-arcade-v3";
const BASE = "/game-hub";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        `${BASE}/`,
        `${BASE}/icons/icon-192.png`,
        `${BASE}/icons/icon-512.png`,
        // manifest kısayollarıyla aynı oyunlar: ilk çevrimdışı ziyaret de garanti
        `${BASE}/tycoon.html`,
        `${BASE}/games/pixel-tycoon/`,
        `${BASE}/games/okey/`,
        `${BASE}/games/world-war-z/`,
        `${BASE}/games/chess/`,
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

  // Sayfalarda ağ-önce (güncellemeler görünsün); ağ yokken önce o
  // sayfanın daha önce önbelleğe alınmış kopyası, yoksa ana kabuk.
  // Böylece bir kez açılmış oyun/rota çevrimdışı da açılabilir.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match(`${BASE}/`))
        )
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
