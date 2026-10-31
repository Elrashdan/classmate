/*!
 * Hadro · نظام إدارة الحضور
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro — رصد الدرجات بالإملاء الصوتي: تحويل الكلام إلى (طالب، درجة، بونص)، ومطابقة الاسم بكشف المادة
(function () {
  const HV = window.HV = {};

  /* ---------- تطبيع النص العربي ---------- */
  const norm = HV.norm = s => String(s || "")
    .replace(/[ً-ْٰـ]/g, "")           // التشكيل والتطويل
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٫,،]/g, m => m === "٫" ? "." : " ")
    .replace(/(^|\s)عبد\s+ال/g, "$1عبدال")
    .toLowerCase().replace(/[^\p{L}\p{N}.\s]/gu, " ").replace(/\s+/g, " ").trim();

  /* ---------- الأعداد بالكلام (مصري وفصيح) ---------- */
  const UNITS = { "صفر": 0, "زيرو": 0, "واحد": 1, "واحده": 1, "اتنين": 2, "اثنين": 2, "اثنان": 2, "تلاته": 3, "ثلاثه": 3, "تلات": 3, "ثلاث": 3,
    "اربعه": 4, "اربع": 4, "خمسه": 5, "خمس": 5, "سته": 6, "ست": 6, "سبعه": 7, "سبع": 7, "تمانيه": 8, "ثمانيه": 8, "تمن": 8, "ثمان": 8,
    "تسعه": 9, "تسع": 9, "عشره": 10, "عشر": 10 };
  const TEENS = { "حداشر": 11, "احداشر": 11, "اتناشر": 12, "اطناشر": 12, "تلاتاشر": 13, "تلتاشر": 13, "اربعتاشر": 14, "اربعطاشر": 14,
    "خمستاشر": 15, "خمسطاشر": 15, "ستاشر": 16, "سطاشر": 16, "سبعتاشر": 17, "سبعطاشر": 17, "تمنتاشر": 18, "تمنطاشر": 18, "تسعتاشر": 19, "تسعطاشر": 19 };
  const TENS = { "عشرين": 20, "عشرون": 20, "تلاتين": 30, "ثلاثين": 30, "اربعين": 40, "خمسين": 50, "ستين": 60, "سبعين": 70, "تمانين": 80, "ثمانين": 80, "تسعين": 90 };
  const HUND = { "ميه": 100, "مايه": 100, "مائه": 100, "ميت": 100 };
  const FRAC = { "نص": .5, "النص": .5, "نصف": .5, "ربع": .25, "الربع": .25, "تلت": 1 / 3 };
  const strip = w => w.replace(/^و(?=\S{2,})/, "");
  // يقرأ عددًا يبدأ عند الكلمة i، ويُرجع {v, n} (القيمة وعدد الكلمات) أو null
  function readNumber(ws, i) {
    let w = ws[i]; if (w == null) return null;
    if (/^\d+(\.\d+)?$/.test(w)) {
      let v = parseFloat(w), n = 1;
      const f = ws[i + 1] && FRAC[strip(ws[i + 1])]; if (f && /^و/.test(ws[i + 1])) { v += f; n++; }
      return { v, n };
    }
    let v = null, n = 0;
    const take = (dict, word) => { const x = dict[word]; return x == null ? null : x; };
    let x = take(TEENS, w) ?? take(TENS, w) ?? take(HUND, w) ?? take(UNITS, w);
    if (x == null) {
      // «احدعشر/اثناعشر … عشر» بالفصحى: «ثلاثه عشر»
      return null;
    }
    v = x; n = 1;
    // «خمسه عشر» (فصحى) = 15
    if (UNITS[w] != null && UNITS[w] < 10 && (ws[i + 1] === "عشر" || ws[i + 1] === "عشره")) { v = UNITS[w] + 10; n = 2; }
    // «خمسه وعشرين» = 25 · «ميه وعشره»
    for (;;) {
      const nx = ws[i + n]; if (!nx || !/^و/.test(nx)) break;
      const s = strip(nx), t = TENS[s] ?? UNITS[s] ?? TEENS[s];
      if (t != null && ((v < 10 && TENS[s] != null) || v >= 100)) { v += t; n++; continue; }
      if (FRAC[s] != null) { v += FRAC[s]; n++; }
      break;
    }
    return { v, n };
  }

  const BONUS = /^(بونص|بونس|بونيص|زياده|اضافي|اضافيه|والبونص|وبونص|وبونس|وزياده)$/;
  const SKIP = /^(الدرجه|درجه|درجته|درجتها|اخد|اخدت|خد|خدت|ياخد|تاخد|عليه|عليها|له|لها|يا|يعني|وبعدين|بعدين|الطالب|الطالبه|ده|دي|تمام|كده)$/;
  const ROWW = /^(رقم|نمره|نمرة|م)$/, CODEW = /^(كود|الكود|كوده)$/;

  // يحوّل نصًّا مسموعًا إلى قائمة {name, row, code, grade, bonus, raw}
  HV.parse = text => {
    const ws = norm(text).split(" ").filter(Boolean), out = [];
    let cur = { words: [], row: null, code: null, grade: null, bonus: null, raw: [] };
    const flush = () => { if (cur.grade != null && (cur.words.length || cur.row != null || cur.code != null)) out.push({ name: cur.words.join(" "), row: cur.row, code: cur.code, grade: cur.grade, bonus: cur.bonus, raw: cur.raw.join(" ") }); cur = { words: [], row: null, code: null, grade: null, bonus: null, raw: [] }; };
    for (let i = 0; i < ws.length;) {
      const w = ws[i];
      if (cur.grade == null && ROWW.test(w)) { const nb = readNumber(ws, i + 1); if (nb) { cur.row = Math.round(nb.v); cur.raw.push(w, ...ws.slice(i + 1, i + 1 + nb.n)); i += 1 + nb.n; continue; } }
      if (cur.grade == null && CODEW.test(w) && /^\d+$/.test(ws[i + 1] || "")) { cur.code = ws[i + 1]; cur.raw.push(w, ws[i + 1]); i += 2; continue; }
      if (BONUS.test(w) && cur.grade != null) {
        const nb = readNumber(ws, i + 1);
        if (nb) { cur.bonus = nb.v; cur.raw.push(w, ...ws.slice(i + 1, i + 1 + nb.n)); i += 1 + nb.n; continue; }
        i++; continue;
      }
      const nb = readNumber(ws, i);
      if (nb && (cur.words.length || cur.row != null || cur.code != null) && cur.grade == null) {
        cur.grade = nb.v; cur.raw.push(...ws.slice(i, i + nb.n)); i += nb.n;
        if ((ws[i] === "من") && readNumber(ws, i + 1)) { const m = readNumber(ws, i + 1); i += 1 + m.n; } // «سبعتاشر من عشرين»
        continue;
      }
      if (nb && cur.grade != null) { /* عدد ثانٍ بلا كلمة «بونص»: يبدأ طالبًا جديدًا بلا اسم، فنتجاهله */ i += nb.n; continue; }
      if (cur.grade != null) flush();          // بداية اسم طالب جديد
      if (!SKIP.test(w)) { cur.words.push(w); cur.raw.push(w); }
      i++;
    }
    flush();
    return out;
  };

  /* ---------- مطابقة الاسم بكشف المادة ---------- */
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
    let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[n];
  }
  const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);
  // roster: [{code, name}] بترتيب الكشف · يُرجع [{code, score}] مرتبة
  HV.match = (entry, roster) => {
    if (entry.row != null) { const e = roster[entry.row - 1]; return e ? [{ code: e.code, score: 1, by: "row" }] : []; }
    if (entry.code) { const hits = roster.filter(e => e.code === entry.code || e.code.endsWith(entry.code)); return hits.map(e => ({ code: e.code, score: hits.length === 1 ? 1 : .6, by: "code" })); }
    const h = norm(entry.name).split(" ").filter(w => w.length > 1);
    if (!h.length) return [];
    return roster.map(e => {
      const t = norm(e.name).split(" ").filter(w => w.length > 1);
      let tot = 0, last = -1, order = 0;
      h.forEach((w, k) => {
        let best = 0, at = -1;
        t.forEach((x, j) => { const s = Math.min(1, sim(w, x) + (w.length >= 3 && x.startsWith(w) ? .15 : 0)) * (j === k ? 1 : .85); if (s > best) { best = s; at = j; } });
        tot += best * (k === 0 ? 1.4 : 1);
        if (at > last) order++; last = at;
      });
      let score = tot / (h.length + .4);
      if (h.length > 1) score = score * .9 + .1 * (order / h.length);
      if (h.length === 1 && t.length) score *= .92;   // اسم واحد فقط: ثقة أقل
      return { code: e.code, score: Math.round(score * 100) / 100, by: "name" };
    }).sort((a, b) => b.score - a.score).slice(0, 4);
  };
  // مؤكد إذا كان الأول واضحًا والفرق عن الثاني كبيرًا
  HV.sure = c => !!c[0] && c[0].score >= .8 && (!c[1] || c[0].score - c[1].score >= .12);
  HV.supported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
})();
