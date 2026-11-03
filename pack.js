/*!
 * Hadro · نظام إدارة الحضور
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro — حزمة تسليمات تكليف: كل الملفات مرقّمة بأسماء الطلبة + «كشف الدرجات» (يُملأ ثم يُرفع فتُرصد الدرجات) + فهرس.
// يستخدمها فريق المادة (زر «تنزيل كل الملفات») وصفحة الرابط المرسل للدكتور (share.html).
(function () {
  const HP = window.HP = {};
  const script = (src, test, msg) => test() ? Promise.resolve() : new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad({ message: msg }); document.head.appendChild(s); });
  HP.loadExcelJS = () => script("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js", () => window.ExcelJS, "تعذّر تحميل أداة إكسل. تأكّد من الاتصال بالإنترنت وأعد المحاولة.");
  HP.loadJSZip = () => script("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", () => window.JSZip, "تعذّر تحميل أداة الضغط. تأكّد من الاتصال بالإنترنت.");

  const XC = { head: "FF16382F", headInk: "FFFFFFFF", line: "FFD5DDDA", band: "FFF6F8F7", title: "FF16382F", muted: "FF5A6A66" };
  const fill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const thin = { style: "thin", color: { argb: XC.line } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const gN = n => Number(n).toLocaleString("en", { maximumFractionDigits: 2 });
  const fmtDT = d => { const x = new Date(d); return x.toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) + " " + x.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" }); };
  const codeVal = c => isNaN(+c) ? c : +c;
  function sheetTitle(ws, cols, title, sub) {
    ws.mergeCells(1, 1, 1, cols); ws.mergeCells(2, 1, 2, cols);
    ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { name: "Arial", size: 15, bold: true, color: { argb: XC.title } };
    ws.getCell(2, 1).value = sub; ws.getCell(2, 1).font = { name: "Arial", size: 10, color: { argb: XC.muted } };
    ws.getRow(1).height = 26; ws.getRow(2).height = 18;
    [1, 2].forEach(r => ws.getCell(r, 1).alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" });
  }
  function headRow(ws, r, vals) {
    const row = ws.getRow(r); vals.forEach((v, j) => { row.getCell(j + 1).value = v; }); row.height = 46;
    row.eachCell(cl => { cl.fill = fill(XC.head); cl.font = { name: "Arial", bold: true, size: 10, color: { argb: XC.headInk } }; cl.alignment = { horizontal: "center", vertical: "middle", wrapText: true, readingOrder: "rtl" }; cl.border = box; });
  }
  HP.sheetTitle = sheetTitle; HP.headRow = headRow;

  // ترتيب الكشف: طلبة مجموعة التكليف أولًا (بالمجموعة ثم الاسم)، ثم المسلِّمون من مجموعات أخرى
  const GORD = g => { const i = ["أ", "ب", "ج", "د"].indexOf(g); return g ? (i < 0 ? 10 : i) : 99; };
  HP.byGroupName = (a, b) => GORD(a.grp) - GORD(b.grp) || String(a.grp || "").localeCompare(String(b.grp || ""), "ar") || a.name.localeCompare(b.name, "ar", { sensitivity: "base" }) || a.code.localeCompare(b.code, "en", { numeric: true });
  HP.sortRows = (rows, grp) => { const ex = r => grp && r.grp !== grp ? 1 : 0; return rows.slice().sort((a, b) => ex(a) - ex(b) || HP.byGroupName(a, b)); };

  const MIMEX = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "application/zip": ".zip", "application/x-zip-compressed": ".zip", "application/vnd.rar": ".rar", "application/x-rar-compressed": ".rar", "video/mp4": ".mp4" };
  HP.extOf = s => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(s.file_name || ""); return m ? "." + m[1].toLowerCase() : MIMEX[s.mime] || ""; };

  /* «كشف الرصد»: o = { title, sub, max, dl, withWork, taskId, taskTitle, cid, rows: [{ n, code, name, grp, s, refused }], files?: {code: اسم الملف} }
     يقرؤه «رفع كشف إكسل» في صفحة فريق المادة (أول ورقة ظاهرة + ورقة hadro المخفية بمعرّف التكليف) */
  HP.entrySheet = async (wb, o) => {
    const max = Number(o.max), withFile = !!o.files, P = Array.isArray(o.parts) && o.parts.length ? o.parts : null, np = P ? P.length : 0;
    // الأعمدة: م · الكود · الاسم · المجموعة · [المشاريع الفرعية…] · الدرجة · بونص · ملاحظة · [العمل] · [رقم الملف]
    const cG = 5 + np, cB = cG + 1, cF = cG + 2, cW = o.withWork ? cG + 3 : 0, cN = withFile ? cG + 3 + (o.withWork ? 1 : 0) : 0, NC = cG + 2 + (o.withWork ? 1 : 0) + (withFile ? 1 : 0);
    const L = n => { let x = ""; while (n > 0) { const m = (n - 1) % 26; x = String.fromCharCode(65 + m) + x; n = Math.floor((n - 1) / 26); } return x; };
    const ws = wb.addWorksheet("كشف الرصد", { views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }] });
    sheetTitle(ws, NC, "كشف رصد: " + o.title, o.sub);
    ws.mergeCells(3, 1, 3, NC);
    ws.getCell(3, 1).value = "الدرجة العظمى " + gN(max) + (P ? " (مقسّمة: " + P.map(p => p.name + " " + gN(p.max)).join(" + ") + ") · اكتب درجة كل مشروع فرعي في خانته، والمجموع يُحسب وحده" : " · اكتب الدرجة في خانتها") + "، والبونص (إن وجد) في خانته. لا تغيّر عمود الكود. بعد الملء يُرفع الملف من «رفع كشف إكسل» في صفحة التكليف على Hadro فتُرصد الدرجات.";
    ws.getCell(3, 1).font = { name: "Arial", size: 9.5, color: { argb: XC.muted } }; ws.getCell(3, 1).alignment = { horizontal: "right", readingOrder: "rtl", wrapText: true }; ws.getRow(3).height = P ? 42 : 30;
    headRow(ws, 5, ["م", "الكود", "الاسم", "المجموعة", ...(P ? P.map((p, i) => "جزء " + (i + 1) + ": " + p.name + " (من " + gN(p.max) + ")") : []), (P ? "المجموع" : "الدرجة") + " (من " + gN(max) + ")", "بونص", "ملاحظة", ...(o.withWork ? ["العمل المسلَّم"] : []), ...(withFile ? ["رقم الملف في المجلد"] : [])]);
    if (P) {   // صف فوق المشاريع الفرعية: اسم التكليف (المشروع) يعلوها كلها
      for (let j = 1; j <= NC; j++) { const cl = ws.getCell(4, j); cl.fill = fill(j >= 5 && j < cG ? XC.head : "FFFFFFFF"); cl.border = j >= 5 && j < cG ? box : {}; }
      ws.mergeCells(4, 5, 4, cG - 1);
      const hc = ws.getCell(4, 5); hc.value = o.title + " (من " + gN(max) + ")"; hc.font = { name: "Arial", bold: true, size: 10.5, color: { argb: XC.headInk } }; hc.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
      ws.getRow(4).height = 24;
    }
    const line = { style: "thin", color: { argb: "FF9AA7A3" } };
    o.rows.forEach((x, i) => {
      const s = x.s, rn = 6 + i, r = ws.getRow(rn);
      [x.n, codeVal(x.code), x.name + (x.refused ? " (مرفوض: غائب " + o.dl + ")" : ""), x.grp || "—"].forEach((v, j) => { r.getCell(j + 1).value = v; });
      if (P) {
        P.forEach((p, k) => { const v = s && Array.isArray(s.parts) ? s.parts[k] : null; r.getCell(5 + k).value = v != null ? Number(v) : null; });
        const has = s && s.grade != null;
        r.getCell(cG).value = { formula: `IF(COUNT(${L(5)}${rn}:${L(4 + np)}${rn})=0,"",SUM(${L(5)}${rn}:${L(4 + np)}${rn}))`, result: has ? Number(s.grade) : "" };
      } else r.getCell(cG).value = s && s.grade != null ? Number(s.grade) : null;
      r.getCell(cB).value = s && Number(s.bonus) ? Number(s.bonus) : null;
      r.getCell(cF).value = (s && s.feedback) || "";
      if (cW) r.getCell(cW).value = s && s.url ? { text: (s.kind === "drive" ? s.file_name || "فتح الملف" : "فتح الرابط") + (s.late ? " (متأخر)" : ""), hyperlink: s.url } : x.refused ? "مرفوض: غائب " + o.dl : "لم يسلّم";
      if (cN) r.getCell(cN).value = o.files[x.code] || (s && s.kind === "link" ? "رابط خارجي" : "");
      r.height = 24;
      r.eachCell({ includeEmpty: true }, (cl, j) => { if (j > NC) return; cl.border = { top: line, bottom: line, left: line, right: line };
        const num = (j >= 5 && j <= cB);
        cl.font = { name: "Arial", size: num ? 13 : j >= cW && cW ? 10 : 11, bold: j === cG, ...(j === cW && s && s.url ? { color: { argb: "FF1D6B58" }, underline: true } : {}) };
        cl.alignment = { horizontal: j === 3 || j === cF || j === cW ? "right" : "center", vertical: "middle", readingOrder: "rtl", ...(j === cW ? { shrinkToFit: true } : {}) };
        if (i % 2) cl.fill = fill(XC.band); });
      const val = (cell, mx) => { cell.dataValidation = { type: "decimal", operator: "between", formulae: [0, mx], allowBlank: true, showErrorMessage: true, errorTitle: "درجة غير صحيحة", error: "اكتب رقمًا من 0 إلى " + gN(mx) }; cell.protection = { locked: false }; };
      if (P) P.forEach((p, k) => val(r.getCell(5 + k), Number(p.max))); else val(r.getCell(cG), max);
      val(r.getCell(cB), max);
      r.getCell(cF).protection = { locked: false };
    });
    const end = 6 + o.rows.length;
    const sg = ws.getRow(end + 1); ws.mergeCells(end + 1, 1, end + 1, NC); sg.height = 34;
    sg.getCell(1).value = "اسم المصحح وتوقيعه: ……………………………………     التاريخ: ……… / ……… / ………"; sg.getCell(1).font = { name: "Arial", size: 11, bold: true }; sg.getCell(1).alignment = { horizontal: "right", vertical: "bottom", readingOrder: "rtl" };
    [5, 12, 32, 10, ...(P ? P.map(() => 13) : []), 15, 10, 30, ...(o.withWork ? [34] : []), ...(withFile ? [12] : [])].forEach((w, j) => { ws.getColumn(j + 1).width = w; });
    ws.pageSetup = { orientation: P && np > 2 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: P ? "4:5" : "5:5", margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } };
    await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
    return ws;
  };
  HP.metaSheet = (wb, o) => { const meta = wb.addWorksheet("hadro", { state: "veryHidden" }); meta.getCell("A1").value = o.taskId; meta.getCell("A2").value = o.taskTitle; meta.getCell("A3").value = o.cid || ""; };
  HP.finishWb = (wb, name) => {
    const A = (window.CM && CM.APP) || {}; wb.creator = A.author || "Hadro"; wb.lastModifiedBy = A.author || "Hadro"; wb.company = A.org || ""; wb.title = name.replace(/\.xlsx$/, "");
    const foot = window.CM && CM.copyright ? CM.copyright() : "";
    wb.eachSheet(ws => { ws.headerFooter = { oddFooter: "&L&8" + "Hadro · " + foot + "&R&8&P / &N" }; });
  };

  function indexSheet(wb, o, result) {
    const ws = wb.addWorksheet("فهرس التسليمات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
    sheetTitle(ws, 10, "فهرس تسليمات: " + o.title, o.sub);
    headRow(ws, 4, ["م", "الكود", "الاسم", "المجموعة", "الحالة", "تاريخ التسليم", "اسم الملف في المجلد", "رابط العمل", o.dl, "ملاحظة الطالب"]);
    o.rows.forEach((x, k) => {
      const s = x.s, rr = result[x.code], r = ws.getRow(5 + k);
      const state = !s || !s.url ? (x.refused ? "مرفوض: غائب " + o.dl : "لم يسلّم") : s.kind === "link" ? "رابط خارجي (لم يُنزَّل)" : rr && rr.ok ? (s.late ? "سُلِّم متأخرًا" : "سُلِّم") : (rr ? rr.why : "—");
      [x.n, codeVal(x.code), x.name, x.grp || "—", state, s && s.submitted_at ? fmtDT(s.submitted_at) : "", rr && rr.ok ? rr.name : "", s && s.url ? { text: "فتح", hyperlink: s.url } : "", x.absent ? (x.excused ? "غائب (مقبول بعذر)" : "غائب") : "", (s && s.note) || ""].forEach((v, j) => { r.getCell(j + 1).value = v; });
      r.eachCell({ includeEmpty: true }, (cl, j) => { if (j > 10) return; cl.font = { name: "Arial", size: 10.5, ...(j === 8 && s && s.url ? { color: { argb: "FF1D6B58" }, underline: true } : {}) }; cl.alignment = { horizontal: j === 3 || j === 7 || j === 10 ? "right" : "center", vertical: "middle", readingOrder: "rtl" }; if (k % 2) cl.fill = fill(XC.band); });
    });
    [5, 12, 30, 9, 22, 18, 50, 9, 14, 30].forEach((wd, j) => { ws.getColumn(j + 1).width = wd; });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + o.rows.length, column: 10 } };
  }

  /* تنزيل الحزمة كاملة.
     o = { base, title, sub, max, dl, taskId, taskTitle, cid, rows: [{ n, code, name, grp, s, absent, excused, refused }], status(txt) }
     يرجع { ok, total, bad, links, dir, parts } أو null إن ألغى المستخدم اختيار المجلد */
  HP.download = async o => {
    const w = Math.max(3, String(o.rows.length).length), pad = n => String(n).padStart(w, "0");
    const files = o.rows.filter(x => x.s && x.s.kind === "drive" && x.s.file_id);
    const nameFor = x => HD.fileName(pad(x.n) + " - " + x.code + " - " + x.name + (x.s.late ? " - متأخر" : "") + (x.absent && !x.excused ? " - غائب " + o.dl : "")) + HP.extOf(x.s);
    // كروم على الكمبيوتر: تُكتب الملفات مباشرة في مجلد تختاره (مهما كبر حجمها)، وإلا فملف مضغوط (أجزاء حتى 300 م.ب)
    let dir = null;
    if (window.showDirectoryPicker) {
      try { const root = await window.showDirectoryPicker({ mode: "readwrite", id: "hadro-dl" }); dir = await root.getDirectoryHandle(o.base, { create: true }); }
      catch (e) { if (e && e.name === "AbortError") return null; dir = null; }
    }
    const status = t => { try { o.status && o.status(t); } catch (e) {} };
    const result = {}; let done = 0, okN = 0;
    const LIMIT = 300 * 1048576, total = files.reduce((a, x) => a + Number(x.s.size || 0), 0), multi = !dir && total > LIMIT;
    let zip = null, zbytes = 0, part = 1, queue = Promise.resolve();
    if (!dir) { await HP.loadJSZip(); zip = new window.JSZip(); }
    const flush = async () => { if (!zip || !Object.keys(zip.files).length) return; const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }); HD.saveBytes(blob, o.base + (multi ? " - الجزء " + part : "") + ".zip", "application/zip"); part++; zip = new window.JSZip(); zbytes = 0; };
    const one = async x => {
      const nm = nameFor(x);
      try {
        const r = await HD.publicResponse(x.s.file_id);
        if (dir) { const fh = await dir.getFileHandle(nm, { create: true }); const wr = await fh.createWritable(); await r.body.pipeTo(wr); }
        else { const buf = await r.arrayBuffer(); queue = queue.then(async () => { if (zbytes && zbytes + buf.byteLength > LIMIT) await flush(); zip.file(nm, buf); zbytes += buf.byteLength; }); await queue; }
        result[x.code] = { ok: true, name: nm }; okN++;
      } catch (e) { result[x.code] = { ok: false, why: e && e.message === "drive_missing" ? "الملف محذوف أو غير متاح على Drive" : "تعذّر التنزيل" }; }
      done++; status("جارٍ التنزيل " + done + " / " + files.length + "…");
    };
    let i = 0; await Promise.all(Array.from({ length: 3 }, async () => { while (i < files.length) await one(files[i++]); }));
    // كشف الدرجات (أول ورقة: يُملأ ويُرفع) + الفهرس
    status("جارٍ تجهيز كشف الدرجات…");
    await HP.loadExcelJS();
    const wb = new ExcelJS.Workbook(), nums = {};
    o.rows.forEach(x => { if (result[x.code] && result[x.code].ok) nums[x.code] = pad(x.n); });
    await HP.entrySheet(wb, { ...o, withWork: true, files: nums });
    indexSheet(wb, o, result);
    HP.metaSheet(wb, o);
    const xname = pad(0) + " - كشف الدرجات والفهرس.xlsx"; HP.finishWb(wb, xname);
    const xbuf = await wb.xlsx.writeBuffer();
    if (dir) { const fh = await dir.getFileHandle(xname, { create: true }); const wr = await fh.createWritable(); await wr.write(xbuf); await wr.close(); }
    else { await queue; zip.file(xname, xbuf); await flush(); }
    return { ok: okN, total: files.length, bad: files.length - okN, links: o.rows.filter(x => x.s && x.s.kind === "link").length, dir: !!dir, parts: part - 1, sheet: xname };
  };

  /* ---------- تحويل أوراق إكسل (ExcelJS) إلى PDF بنفس الشكل: الخلايا المدمجة والألوان والخطوط وعرض الأعمدة،
     وتكرار صفوف العناوين (printTitlesRow) في كل صفحة. يُرسم بالـ canvas فيظهر الخط العربي كما في الصفحة. ---------- */
  const DPI = 150, A4 = [8.27 * DPI, 11.69 * DPI], MARGIN = 0.45 * DPI, FOOT = 34;
  const FONT = "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif";
  const colNum = s => s.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const cellRef = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return m ? { c: colNum(m[1]), r: +m[2] } : null; };
  const argb = (x, d) => x && x.argb ? "#" + String(x.argb).slice(-6) : d;
  function cellText(cell) {
    let v = cell.value;
    if (v == null) return "";
    if (v instanceof Date) return v.toLocaleDateString("ar-EG");
    if (typeof v === "object") {
      if (v.richText) v = v.richText.map(x => x.text).join("");
      else if ("formula" in v || "sharedFormula" in v) v = v.result == null || typeof v.result === "object" ? "" : v.result;
      else if (v.text != null) v = typeof v.text === "object" && v.text.richText ? v.text.richText.map(x => x.text).join("") : v.text;
      else v = "";
    }
    if (typeof v === "number") return /%/.test(cell.numFmt || "") ? Math.round(v * 100) + "%" : Number(v).toLocaleString("en", { maximumFractionDigits: 2, useGrouping: false });
    return String(v);
  }
  function wrap(ctx, text, w) {
    const out = [];
    String(text).split("\n").forEach(par => {
      const words = par.split(/\s+/); let line = "";
      words.forEach(wd => { const t = line ? line + " " + wd : wd; if (line && ctx.measureText(t).width > w) { out.push(line); line = wd; } else line = t; });
      out.push(line);
    });
    return out;
  }
  function layoutSheet(ws, ctx) {
    let N = 0, R = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => { row.eachCell({ includeEmpty: false }, (c, j) => { if (c.value != null && c.value !== "") { N = Math.max(N, j); R = Math.max(R, r); } }); });
    const merges = (ws.model.merges || []).map(m => { const [a, b] = m.split(":").map(cellRef); return { r1: a.r, c1: a.c, r2: b.r, c2: b.c }; });
    merges.forEach(m => { N = Math.max(N, m.c2); });
    const master = {}, covered = new Set();
    merges.forEach(m => { master[m.r1 + ":" + m.c1] = m; for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(r + ":" + c); });
    // الأعمدة الطويلة (مثل الملاحظات الفارغة) لا تستحق عرضها في الإكسل
    const used = Array.from({ length: N + 1 }, () => false);
    for (let r = 1; r <= R; r++) for (let c = 1; c <= N; c++) { const m = master[r + ":" + c]; if (m && m.c2 - m.c1 > 2) continue; if (cellText(ws.getRow(r).getCell(c)).trim()) used[c] = true; }
    const W = [0]; for (let c = 1; c <= N; c++) W[c] = Math.round(((ws.getColumn(c).width || 9) * (used[c] ? 7.2 : 4) + 10));
    const X = [0]; for (let c = 1; c <= N; c++) X[c] = X[c - 1] + W[c];   // المسافة من الحافة اليمنى (الورقة من اليمين لليسار)
    const tableW = X[N];
    const cells = {}, H = [0];
    for (let r = 1; r <= R; r++) {
      const row = ws.getRow(r);
      let h = row.height ? row.height * 1.333 : 26;
      for (let c = 1; c <= N; c++) {
        if (covered.has(r + ":" + c)) continue;
        const cell = row.getCell(c), m = master[r + ":" + c], txt = cellText(cell);
        const f = cell.font || {}, px = (f.size || 11) * 1.333;
        ctx.font = (f.bold ? "600 " : "400 ") + px + "px " + FONT;
        const w = (m ? X[m.c2] - X[m.c1 - 1] : W[c]) - 10;
        const lines = txt ? (cell.alignment && cell.alignment.wrapText) || /\n/.test(txt) || (m && m.c2 - m.c1 > 2) ? wrap(ctx, txt, w) : [txt] : [];
        cells[r + ":" + c] = { cell, m, txt, lines, px, bold: !!f.bold, color: argb(f.color, "#16231f"), u: !!f.underline };
        if (!m || m.r1 === m.r2) h = Math.max(h, lines.length * px * 1.35 + 10);
      }
      H[r] = h;
    }
    const titles = String((ws.pageSetup || {}).printTitlesRow || "").split(":").map(Number).filter(Boolean);
    const h1 = titles[0] || 0, h2 = titles[1] || h1;
    return { N, R, W, X, H, cells, tableW, h1, h2 };
  }
  function drawRows(ctx, L, rows, y0) {
    let y = y0; const ys = {};
    rows.forEach(r => { ys[r] = y; y += L.H[r]; });
    // الخلفيات ثم الحدود ثم النص
    const each = fn => rows.forEach(r => { for (let c = 1; c <= L.N; c++) { const k = L.cells[r + ":" + c]; if (!k) continue;
      const m = k.m, c2 = m ? m.c2 : c, r2 = m ? Math.min(m.r2, rows[rows.length - 1]) : r;
      let h = 0; for (let rr = r; rr <= r2; rr++) h += L.H[rr] || 0;
      const x = L.tableW - L.X[c2], w = L.X[c2] - L.X[c - 1];
      fn(k, x, ys[r], w, h); } });
    each((k, x, y, w, h) => { const fl = k.cell.fill && k.cell.fill.fgColor; if (fl && fl.argb) { ctx.fillStyle = argb(fl); ctx.fillRect(x, y, w, h); } });
    ctx.strokeStyle = "#9aa7a3"; ctx.lineWidth = 1;
    each((k, x, y, w, h) => { const b = k.cell.border; if (b && (b.top || b.bottom || b.left || b.right)) ctx.strokeRect(x + .5, y + .5, w, h); });
    each((k, x, y, w, h) => {
      if (!k.lines.length) return;
      const b = k.cell.border, boxed = b && (b.top || b.bottom || b.left || b.right);
      ctx.save(); if (boxed || k.m) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }   // النص خارج الجدول (التوقيعات) يمتد كما في الإكسل
      ctx.font = (k.bold ? "600 " : "400 ") + k.px + "px " + FONT; ctx.fillStyle = k.color; ctx.direction = "rtl"; ctx.textBaseline = "middle";
      const al = (k.cell.alignment || {}).horizontal || (typeof k.cell.value === "number" ? "center" : "right");
      const lh = k.px * 1.35, top = y + h / 2 - (k.lines.length - 1) * lh / 2;
      k.lines.forEach((ln, i) => { ctx.textAlign = al === "center" ? "center" : al === "left" ? "left" : "right";
        const tx = al === "center" ? x + w / 2 : al === "left" ? x + 5 : x + w - 5, ty = top + i * lh;
        ctx.fillText(ln, tx, ty);
        if (k.u) { const mw = ctx.measureText(ln).width, sx = al === "center" ? tx - mw / 2 : al === "left" ? tx : tx - mw; ctx.fillRect(sx, ty + k.px * .5, mw, 1); } });
      ctx.restore();
    });
    return y;
  }
  HP.sheetPages = async ws => {
    const land = ((ws.pageSetup || {}).orientation || "portrait") === "landscape";
    const PW = land ? A4[1] : A4[0], PH = land ? A4[0] : A4[1];
    const probe = document.createElement("canvas").getContext("2d");
    const L = layoutSheet(ws, probe);
    const scale = Math.min(1.7, (PW - 2 * MARGIN) / L.tableW), avail = (PH - 2 * MARGIN - FOOT) / scale;
    const head = L.h1 ? Array.from({ length: L.h2 - L.h1 + 1 }, (_, i) => L.h1 + i) : [];
    const pre = Array.from({ length: Math.max(0, (L.h1 || 1) - 1) }, (_, i) => i + 1);
    const body = Array.from({ length: L.R - (L.h2 || 0) }, (_, i) => (L.h2 || 0) + i + 1);
    const hh = rs => rs.reduce((a, r) => a + L.H[r], 0);
    const pages = []; let cur = [...pre, ...head], used = hh(cur);
    body.forEach(r => { if (used + L.H[r] > avail && cur.length > pre.length + head.length) { pages.push(cur); cur = [...head]; used = hh(cur); } cur.push(r); used += L.H[r]; });
    pages.push(cur);
    return pages.map((rows, i) => {
      const cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
      const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
      ctx.save(); ctx.translate(PW - MARGIN - L.tableW * scale, MARGIN); ctx.scale(scale, scale); drawRows(ctx, L, rows, 0); ctx.restore();
      ctx.font = "400 17px " + FONT; ctx.fillStyle = "#5a6a66"; ctx.textBaseline = "alphabetic"; ctx.direction = "rtl"; ctx.textAlign = "center";
      ctx.fillText((ws.name || "") + " · صفحة " + (i + 1) + " من " + pages.length + " · Hadro", PW / 2, PH - MARGIN / 2);
      return { cv, land };
    });
  };
  HP.wbToPdf = async (wb, names, fileName) => {
    await HD.loadPdfLib();
    try { await Promise.all(["400 20px 'IBM Plex Sans Arabic'", "600 20px 'IBM Plex Sans Arabic'"].map(f => document.fonts.load(f, "عربي"))); } catch (e) {}
    const pdf = await window.PDFLib.PDFDocument.create();
    pdf.setTitle(fileName.replace(/\.pdf$/i, "")); pdf.setCreator("Hadro"); pdf.setAuthor(((window.CM && CM.APP) || {}).author || "Hadro");
    for (const nm of names) {
      const ws = typeof nm === "string" ? wb.getWorksheet(nm) : nm; if (!ws) continue;
      for (const { cv, land } of await HP.sheetPages(ws)) {
        const bytes = await new Promise(ok => cv.toBlob(b => b.arrayBuffer().then(x => ok(new Uint8Array(x))), "image/jpeg", 0.9));
        const img = await pdf.embedJpg(bytes), W = land ? 841.89 : 595.28, H = land ? 595.28 : 841.89;
        pdf.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
      }
    }
    HD.saveBytes(await pdf.save(), fileName, "application/pdf");
  };
})();
