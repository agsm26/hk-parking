// Service worker for 搵車位 / Car Park HK.
//
// What it caches: the app shell (HTML, JS, CSS, Leaflet, icons) and the bundled
// data snapshots, so the app opens instantly and offline. What it never caches:
// the live government feeds, map tiles and address search — those are network
// only, and the page itself keeps the last successful feed in IndexedDB with
// its timestamp for offline display.
//
// Bump VERSION whenever any shell file changes; the old cache is dropped on
// activate and the page is told an update is ready.
const VERSION = "2026-09-11f";
const SHELL = `carpark-shell-${VERSION}`;
const SHELL_FILES = [
  "./", "./index.html", "./app.js", "./core.js", "./manifest.json",
  "./vendor/leaflet.js", "./vendor/leaflet.css",
  "./vendor/images/marker-icon.png", "./vendor/images/marker-icon-2x.png", "./vendor/images/marker-shadow.png",
  "./vendor/images/layers.png", "./vendor/images/layers-2x.png",
  "./data/osm_carparks.json", "./data/osm_entrances.json", "./data/curated_carparks.json", "./data/meter_zones.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png",
];
const NETWORK_ONLY = ["api.data.gov.hk", "resource.data.one.gov.hk", "www.als.gov.hk", "mapapi.geodata.gov.hk", "tile.openstreetmap.org", "nominatim.openstreetmap.org"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (NETWORK_ONLY.some((h) => url.hostname.endsWith(h))) return;   // live data: straight to the network
  if (url.origin !== self.location.origin) return;
  // Shell and data: cache first, refresh in the background so the next open is current.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  })());
});
