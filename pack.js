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
    const max = Number(o.max), withFile = !!o.files, NC = (o.withWork ? 8 : 7) + (withFile ? 1 : 0);
    const ws = wb.addWorksheet("كشف الرصد", { views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }] });
    sheetTitle(ws, NC, "كشف رصد: " + o.title, o.sub);
    ws.mergeCells(3, 1, 3, NC);
    ws.getCell(3, 1).value = "الدرجة العظمى " + gN(max) + " · اكتب الدرجة في خانتها والبونص (إن وجد) في خانته. لا تغيّر عمود الكود. بعد الملء يُرفع الملف من «رفع كشف إكسل» في صفحة التكليف على Hadro فتُرصد الدرجات.";
    ws.getCell(3, 1).font = { name: "Arial", size: 9.5, color: { argb: XC.muted } }; ws.getCell(3, 1).alignment = { horizontal: "right", readingOrder: "rtl", wrapText: true }; ws.getRow(3).height = 30;
    headRow(ws, 5, ["م", "الكود", "الاسم", "المجموعة", "الدرجة (من " + gN(max) + ")", "بونص", "ملاحظة", ...(o.withWork ? ["العمل المسلَّم"] : []), ...(withFile ? ["رقم الملف في المجلد"] : [])]);
    o.rows.forEach((x, i) => {
      const s = x.s, r = ws.getRow(6 + i);
      [x.n, codeVal(x.code), x.name + (x.refused ? " (مرفوض: غائب " + o.dl + ")" : ""), x.grp || "—", s && s.grade != null ? Number(s.grade) : null, s && Number(s.bonus) ? Number(s.bonus) : null, (s && s.feedback) || ""].forEach((v, j) => { r.getCell(j + 1).value = v; });
      if (o.withWork) r.getCell(8).value = s && s.url ? { text: (s.kind === "drive" ? s.file_name || "فتح الملف" : "فتح الرابط") + (s.late ? " (متأخر)" : ""), hyperlink: s.url } : x.refused ? "مرفوض: غائب " + o.dl : "لم يسلّم";
      if (withFile) r.getCell(NC).value = o.files[x.code] || (s && s.kind === "link" ? "رابط خارجي" : "");
      r.height = 24;
      r.eachCell({ includeEmpty: true }, (cl, j) => { if (j > NC) return; cl.border = { top: { style: "thin", color: { argb: "FF9AA7A3" } }, bottom: { style: "thin", color: { argb: "FF9AA7A3" } }, left: { style: "thin", color: { argb: "FF9AA7A3" } }, right: { style: "thin", color: { argb: "FF9AA7A3" } } };
        cl.font = { name: "Arial", size: j === 5 || j === 6 ? 13 : j >= 8 ? 10 : 11, bold: j === 5, ...(j === 8 && o.withWork && s && s.url ? { color: { argb: "FF1D6B58" }, underline: true } : {}) }; cl.alignment = { horizontal: j === 3 || j === 7 || j === 8 ? "right" : "center", vertical: "middle", readingOrder: "rtl", ...(j === 8 ? { shrinkToFit: true } : {}) }; if (i % 2) cl.fill = fill(XC.band); });
      [5, 6].forEach(j => { r.getCell(j).dataValidation = { type: "decimal", operator: "between", formulae: [0, max], allowBlank: true, showErrorMessage: true, errorTitle: "درجة غير صحيحة", error: "اكتب رقمًا من 0 إلى " + gN(max) }; r.getCell(j).protection = { locked: false }; });
      r.getCell(7).protection = { locked: false };
    });
    const end = 6 + o.rows.length;
    const sg = ws.getRow(end + 1); ws.mergeCells(end + 1, 1, end + 1, NC); sg.height = 34;
    sg.getCell(1).value = "اسم المصحح وتوقيعه: ……………………………………     التاريخ: ……… / ……… / ………"; sg.getCell(1).font = { name: "Arial", size: 11, bold: true }; sg.getCell(1).alignment = { horizontal: "right", vertical: "bottom", readingOrder: "rtl" };
    [5, 12, 32, 10, 15, 10, 30, ...(o.withWork ? [34] : []), ...(withFile ? [12] : [])].forEach((w, j) => { ws.getColumn(j + 1).width = w; });
    ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: "5:5", margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } };
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
})();
