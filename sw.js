// Classmate offline cache: the student page (and its QR) must open with no internet.
// Network first (so updates arrive), cache as fallback. Never touches Supabase API calls.
const CACHE = "classmate-v5";
const CDN = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"
];
const LOCAL = ["./", "index.html", "style.css", "common.js", "config.js", "icon.svg", "manifest.json"];
const CACHE_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([...LOCAL, ...CDN].map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mine = url.origin === location.origin;
  if (!mine && !CACHE_HOSTS.includes(url.hostname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 6000))]);
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: mine });
      if (hit) return hit;
      if (req.mode === "navigate") { const page = await cache.match("index.html"); if (page) return page; }
      throw err;
    }
  })());
});
