/*!
 * Hadro · © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro offline cache: the student page (and its QR) must open with no internet.
// Network first (so updates arrive), cache as fallback. Never touches Supabase API calls.
const VER = "b122";
const CACHE = "hadro-v122";
const CDN = [];
// ملفات الـJS والـCSS بتتطلب برقم النسخة (?v=bNN)، فينفع تتاخد من الذاكرة على طول من غير ما نستنى الشبكة
const V = u => u + "?v=" + VER;
const LOCAL = ["./", "index.html", V("style.css"), V("common.js"), V("drive.js"), V("catalog.js"), V("regform.js"), V("config.js"), V("vendor/qrcode.js"), V("vendor/supabase.js"), "vendor/jsQR.js", "icon.svg", "icon-192.png", "manifest.json"];
const CACHE_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([...LOCAL, ...CDN].map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  // الخطوط والمكتبات الخارجية مبتتغيرش: بننقلها للنسخة الجديدة بدل ما نحمّلها تاني
  e.waitUntil((async () => {
    const keys = await caches.keys(), now = await caches.open(CACHE);
    for (const k of keys.filter(k => k !== CACHE)) {
      const old = await caches.open(k);
      for (const r of await old.keys()) { const h = new URL(r.url).hostname; if (CACHE_HOSTS.includes(h)) { const m = await old.match(r); if (m) await now.put(r, m).catch(() => {}); } }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mine = url.origin === location.origin;
  if (!mine && !CACHE_HOSTS.includes(url.hostname)) return;
  const fixed = !mine || url.searchParams.has("v");   // ثابتة: خط/مكتبة خارجية أو ملف برقم نسخته
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (fixed) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    }
    try {
      // الصفحات: نتحقق من الخادم (no-cache) عشان التحديث يوصل فورًا، ولو الشبكة بطيئة نفتح النسخة المحفوظة
      const res = await Promise.race([fetch(req.url, { cache: "no-cache", credentials: "same-origin" }), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000))]);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
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
