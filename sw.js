/*!
 * Hadro · © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro offline cache: the student page (and its QR) must open with no internet.
// Network first (so updates arrive), cache as fallback. Never touches Supabase API calls.
const CACHE = "hadro-v99";
const CDN = [];
const LOCAL = ["./", "index.html", "style.css", "common.js", "drive.js", "catalog.js", "regform.js", "config.js", "vendor/qrcode.js", "vendor/jsQR.js", "icon.svg", "icon-192.png", "manifest.json"];
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
      // ملفاتنا: نتحقق من الخادم في كل مرة (no-cache) حتى يصل أي تحديث فورًا ولا يُستخدم نسخة قديمة من ذاكرة المتصفح
      const res = await Promise.race([mine ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 6000))]);
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

// إشعارات Hadro (Web Push): تصل حتى والموقع مغلق
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "Hadro", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Hadro", { body: d.body || "", icon: "icon-192.png", badge: "favicon-32.png", tag: d.tag, dir: "rtl", lang: "ar", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => { const w = ws.find(x => x.url.startsWith(self.registration.scope)); if (w) { w.focus(); return w.navigate ? w.navigate(url).catch(() => {}) : null; } return self.clients.openWindow(url); }));
});
