/*!
 * Hadro · نظام إدارة الحضور
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro — قراءة «استمارة التسجيل» من نظام ابن الهيثم (PDF أو صورة) على جهاز الطالب نفسه:
// كود الطالب واسمه ومستواه والمقررات المسجلة، ثم مطابقتها بمقررات اللائحة (CATALOG). لا يُرفع الملف إلى أي خادم.
(function () {
  const HR = window.HR = {};
  const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const LANG = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/ara@1.0.0/4.0.0_best_int";
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFW = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const loaded = {};
  const load = src => loaded[src] || (loaded[src] = new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; no(new Error("load_failed")); }; document.head.appendChild(s); }));

  /* ---------- نص عربي موحّد ---------- */
  const digits = s => String(s || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  const norm = HR.norm = s => digits(String(s || "").normalize("NFKC"))
    .replace(/[ً-ْٰـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  /* ---------- قراءة الملف: صورة أو PDF ← صورة ← تعرّف على النص ---------- */
  async function toCanvas(file) {
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name || "")) {
      await load(PDFJS); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFW;
      const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await pdf.getPage(1), vp = page.getViewport({ scale: 2.5 });
      const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: cx, viewport: vp }).promise;
      return cv;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("bad_image")); i.src = url; });
      // الصورة الصغيرة تُكبَّر (لقطة شاشة هاتف) لتحسين القراءة
      const k = Math.min(3, Math.max(1, 2200 / Math.max(img.width, 1)));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      return cv;
    } finally { URL.revokeObjectURL(url); }
  }
  HR.read = async (file, progress) => {
    const say = (p, t) => { try { progress && progress(p, t); } catch (e) {} };
    say(.05, "تجهيز الملف…");
    const cv = await toCanvas(file);
    say(.15, "تحميل أداة القراءة (مرة واحدة)…");
    await load(TESS);
    const w = await window.Tesseract.createWorker("ara", 1, { langPath: LANG, logger: m => { if (m.status === "recognizing text") say(.2 + .78 * (m.progress || 0), "قراءة الاستمارة…"); } });
    try { const { data } = await w.recognize(cv); say(1, ""); return data.text || ""; }
    finally { w.terminate(); }
  };

  /* ---------- استخراج البيانات من النص ---------- */
  const LV = { "الاول": 1, "الأول": 1, "الثاني": 2, "الثانى": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5 };
  HR.parse = text => {
    const raw = digits(String(text || "").normalize("NFKC")).replace(/[‏‎]/g, "");
    const lines = raw.split(/\n+/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const all = lines.join("\n");
    const out = { name: "", code: "", level: null, program: "", items: [] };
    let m = all.match(/الاسم\s*[:：]?\s*(.+?)\s+(?:الكود|الكــود)\s*[:：]/);
    if (m) out.name = m[1].replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();
    m = all.match(/الكود\s*[:：]\s*(\d{6,12})/); if (m) out.code = m[1];
    m = all.match(/المستو[يى]\s*[:：]?\s*(ال[^\s:]+)/); if (m) out.level = LV[m[1].replace(/ى$/, "ي")] || LV[m[1]] || null;
    m = all.match(/البرنامج\s*[:：]?\s*(.+?)(?:\s+الساعات|\n|$)/); if (m) out.program = m[1].trim();
    // صفوف المقررات: «جرف40105 التشريح الفنى 2 1 2» · «كيم 40108 …» · «تعد 211 …» · «40105 …»
    const seen = new Set();
    lines.forEach(l => {
      const r = l.match(/^\s*([ء-ي]{2,4})?\s*(\d{3,5})\s+(.+)$/);
      if (!r || /الساعات|المسجلة|الكود\s*:/.test(l)) return;
      const pre = r[1] || "", code = r[2];
      if (code.length < 5 && !pre) return;                 // الأكواد القصيرة (البرنامج الخاص والاختيارية) لها رمز قسم دائمًا
      let name = r[3].replace(/(\s+\d+(\.\d+)?)+\s*$/, "").trim();   // الأرقام الأخيرة = الساعات
      name = name.replace(/\s+\d+$/, "").trim();
      if (!name || seen.has(pre + code)) return; seen.add(pre + code);
      out.items.push({ prefix: pre, code, name });
    });
    return out;
  };

  /* ---------- المطابقة بمقررات اللائحة ---------- */
  function lev(a, b) { if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n; let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }
  const sim = (a, b) => { a = norm(a).replace(/\s/g, ""); b = norm(b).replace(/\*$/, "").replace(/\s/g, ""); return 1 - lev(a, b) / Math.max(a.length, b.length, 1); };
  // يُرجع لكل مقرر: bid (رقمه في CATALOG) أو null
  HR.match = (items, level) => {
    const C = window.CATALOG || [];
    return items.map(it => {
      const priv = it.code.length === 3;                  // أكواد البرنامج الخاص من ثلاثة أرقام
      const cands = C.map((e, i) => ({ e, i })).filter(({ e }) => e.c === it.code && ((e.pr === "خاص") === priv));
      if (!cands.length) return { ...it, bid: null };
      const sc = cands.map(({ e, i }) => ({ i, e, s: sim(it.name, e.n) + (it.prefix && e.p === it.prefix ? .3 : 0) + (e.l && level ? -Math.abs(e.l - level) * .05 : 0) }))
        .sort((a, b) => b.s - a.s);
      const best = sc[0];
      return { ...it, bid: best.s > .25 ? best.i : null, cat: best.s > .25 ? best.e : null };
    });
  };
})();
