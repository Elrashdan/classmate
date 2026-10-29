/*!
 * Hadro · نظام إدارة الحضور
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro — تسليم التكليفات على Google Drive الخاص بالطالب، وفحص الملفات، والنسخة المختومة بالدرجة
(function () {
  const cfg = window.CLASSMATE || {};
  const HD = window.HD = {};
  const API = "https://www.googleapis.com/drive/v3", UP = "https://www.googleapis.com/upload/drive/v3";
  const FOLDER = "application/vnd.google-apps.folder";
  HD.clientId = (cfg.GOOGLE_CLIENT_ID || "").trim();
  HD.apiKey = (cfg.GOOGLE_API_KEY || "").trim();
  HD.ready = !!HD.clientId;          // الطالب يرفع إلى Drive
  HD.canCheck = !!HD.apiKey;         // فريق المادة يفحص الملفات وينزّلها
  HD.MAX = 1024 * 1024 * 1024;       // 1 جيجابايت حدًّا أقصى للملف الواحد

  const load = (src, test) => test() ? Promise.resolve() : new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = src; s.async = true; s.onload = ok;
    s.onerror = () => bad({ message: "drive_script" }); document.head.appendChild(s);
  });
  HD.loadGis = () => load("https://accounts.google.com/gsi/client", () => window.google && google.accounts && google.accounts.oauth2);
  HD.loadPdfLib = () => load("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", () => window.PDFLib);

  /* ---------- إذن Google (يظهر للطالب مرة واحدة تقريبًا) ---------- */
  let tok = null, tokUntil = 0, client = null, waiting = null;
  HD.hasToken = () => tok && Date.now() < tokUntil - 60000;
  // تُستدعى مباشرة من ضغطة زر (وإلا يمنع المتصفح النافذة المنبثقة)، بعد تحميل مكتبة Google مسبقًا
  HD.authorize = () => new Promise((resolve, reject) => {
    if (HD.hasToken()) return resolve(tok);
    if (!(window.google && google.accounts && google.accounts.oauth2)) return reject({ message: "drive_script" });
    if (!client) client = google.accounts.oauth2.initTokenClient({
      client_id: HD.clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: r => { const w = waiting; waiting = null; if (!w) return;
        if (r && r.access_token) { tok = r.access_token; tokUntil = Date.now() + (Number(r.expires_in) || 3600) * 1000; w.resolve(tok); }
        else w.reject({ message: "drive_denied" }); },
      error_callback: e => { const w = waiting; waiting = null; if (w) w.reject({ message: e && e.type === "popup_closed" ? "drive_closed" : "drive_denied" }); }
    });
    waiting = { resolve, reject };
    client.requestAccessToken({ prompt: "" });
  });

  async function g(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { Authorization: "Bearer " + tok, ...(opt.headers || {}) } });
    if (r.status === 401) { tok = null; throw { message: "drive_expired" }; }
    if (r.status === 403) { const t = await r.text(); throw { message: /storageQuota|quota/i.test(t) ? "drive_full" : /sharing|domain|permission/i.test(t) ? "drive_no_share" : "drive_forbidden", detail: t }; }
    if (!r.ok) throw { message: "drive_http_" + r.status, detail: await r.text() };
    return r.status === 204 ? null : r.json();
  }
  const q = s => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  const clean = s => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "—";

  async function folder(name, parent) {
    const r = await g(API + "/files?" + new URLSearchParams({
      q: `name=${q(name)} and mimeType='${FOLDER}' and ${q(parent)} in parents and trashed=false`,
      fields: "files(id)", spaces: "drive", pageSize: "1" }));
    if (r.files && r.files.length) return r.files[0].id;
    return (await g(API + "/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id;
  }
  // Hadro / المادة / التكليف
  HD.folders = async (courseName, taskTitle) => {
    const root = await folder("Hadro", "root");
    const c = await folder(clean(courseName), root);
    return folder(clean(taskTitle), c);
  };

  // رفع قابل للاستئناف، مع نسبة التقدم
  HD.upload = (file, parent, name, onProgress) => new Promise(async (resolve, reject) => {
    try {
      const init = await fetch(UP + "/files?uploadType=resumable&fields=id,name,mimeType,size,md5Checksum,modifiedTime,webViewLink", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": file.type || "application/octet-stream", "X-Upload-Content-Length": String(file.size) },
        body: JSON.stringify({ name, parents: [parent], mimeType: file.type || undefined })
      });
      if (init.status === 401) { tok = null; throw { message: "drive_expired" }; }
      if (!init.ok) { const t = await init.text(); throw { message: /storageQuota|quota/i.test(t) ? "drive_full" : "drive_http_" + init.status, detail: t }; }
      const loc = init.headers.get("Location");
      if (!loc) throw { message: "drive_http_0" };
      const x = new XMLHttpRequest();
      x.open("PUT", loc);
      x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject({ message: "drive_http_0" }); } }
        else reject({ message: /storageQuota|quota/i.test(x.responseText) ? "drive_full" : "drive_http_" + x.status, detail: x.responseText });
      };
      x.onerror = () => reject({ message: "Failed to fetch" });
      x.send(file);
    } catch (e) { reject(e); }
  });
  HD.shareAnyone = id => g(API + "/files/" + id + "/permissions?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }) });
  HD.trash = id => g(API + "/files/" + id + "?fields=id", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch(() => {});
  HD.myFile = async id => { const r = await fetch(API + "/files/" + id + "?alt=media", { headers: { Authorization: "Bearer " + tok } }); if (!r.ok) throw { message: "drive_http_" + r.status }; return r.arrayBuffer(); };

  /* ---------- فريق المادة: فحص الملف وتنزيله بمفتاح API (ملف مشارَك لمن معه الرابط) ---------- */
  HD.meta = async id => {
    const r = await fetch(API + "/files/" + encodeURIComponent(id) + "?" + new URLSearchParams({ fields: "id,md5Checksum,size,modifiedTime,trashed", key: HD.apiKey, supportsAllDrives: "true" }));
    if (r.status === 404 || r.status === 403) return { missing: true, status: r.status };
    if (!r.ok) throw { message: "drive_http_" + r.status };
    return r.json();
  };
  // ok | changed | missing
  HD.verdict = (s, m) => !m || m.missing || m.trashed ? "missing" : (s.md5 && m.md5Checksum && m.md5Checksum !== s.md5) || (s.size && m.size && Number(m.size) !== Number(s.size)) ? "changed" : "ok";
  HD.publicFile = async id => {
    const r = await fetch(API + "/files/" + encodeURIComponent(id) + "?" + new URLSearchParams({ alt: "media", key: HD.apiKey, supportsAllDrives: "true" }));
    if (!r.ok) throw { message: r.status === 404 || r.status === 403 ? "drive_missing" : "drive_http_" + r.status };
    return r.arrayBuffer();
  };

  HD.size = b => b == null ? "" : b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + " م.ب" : Math.max(1, Math.round(b / 1024)) + " ك.ب";
  HD.stampable = mime => /pdf|jpe?g|png/i.test(mime || "");

  /* ---------- الختم: يُرسم على لوحة ثم يوضع صورةً في PDF (يحفظ الحروف العربية كما هي) ---------- */
  const fmtN = n => Number(n).toLocaleString("en", { maximumFractionDigits: 2 });
  function stampCanvas(info) {
    const W = 1000, H = 520, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d"), ink = "#155e4c", F = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif";
    x.translate(W / 2, H / 2); x.rotate(-0.045); x.translate(-W / 2, -H / 2);
    const rr = (a, b, w, h, r) => { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); };
    x.fillStyle = "rgba(255,255,255,.97)"; rr(20, 20, W - 40, H - 40, 34); x.fill();
    x.strokeStyle = ink; x.lineWidth = 8; rr(20, 20, W - 40, H - 40, 34); x.stroke();
    x.lineWidth = 3; rr(40, 40, W - 80, H - 80, 22); x.stroke();
    x.fillStyle = ink; x.direction = "rtl"; x.textAlign = "right"; x.textBaseline = "alphabetic";
    const fit = (t, size, weight, maxW) => { let s = size; do { x.font = `${weight} ${s}px ${F}`; s -= 2; } while (x.measureText(t).width > maxW && s > 14); };
    fit("تم التصحيح", 44, 700, 420); x.fillText("تم التصحيح", W - 80, 110);
    x.textAlign = "left"; x.direction = "ltr"; x.font = `700 40px 'Readex Pro',${F}`; x.fillText("hadro", 80, 106);
    // الدرجة
    x.textAlign = "center"; x.font = `700 132px 'Readex Pro',${F}`;
    const big = fmtN(info.grade), small = " / " + fmtN(info.max);
    const bw = x.measureText(big).width; x.font = `600 64px 'Readex Pro',${F}`; const sw = x.measureText(small).width;
    const left = W / 2 - (bw + sw) / 2;
    x.textAlign = "left"; x.font = `700 132px 'Readex Pro',${F}`; x.fillText(big, left, 268);
    x.font = `600 64px 'Readex Pro',${F}`; x.fillText(small, left + bw, 268);
    x.direction = "rtl"; x.textAlign = "center";
    fit(info.task, 38, 600, W - 160); x.fillText(info.task, W / 2, 330);
    fit(info.course, 30, 500, W - 160); x.fillText(info.course, W / 2, 374);
    fit(info.student, 30, 500, W - 160); x.fillText(info.student, W / 2, 418);
    fit(info.by, 26, 400, W - 160); x.globalAlpha = .85; x.fillText(info.by, W / 2, 458);
    return c;
  }
  function lineCanvas(text) {
    const c = document.createElement("canvas"), x = c.getContext("2d"), F = "'IBM Plex Sans Arabic',Tahoma,sans-serif";
    x.font = `500 26px ${F}`; c.width = Math.ceil(x.measureText(text).width) + 30; c.height = 40;
    x.font = `500 26px ${F}`; x.fillStyle = "#155e4c"; x.direction = "rtl"; x.textAlign = "right"; x.fillText(text, c.width - 15, 29);
    return c;
  }
  const png = c => new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), "image/png"));

  // bytes: الملف الأصلي · mime · info {grade,max,task,course,student,by,footer}
  HD.stamped = async (bytes, mime, info) => {
    await HD.loadPdfLib();
    try { await document.fonts.load("700 40px 'Readex Pro'"); await document.fonts.load("600 30px 'IBM Plex Sans Arabic'"); } catch (e) {}
    const { PDFDocument } = window.PDFLib;
    let pdf;
    if (/pdf/i.test(mime)) pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    else {
      pdf = await PDFDocument.create();
      const img = /png/i.test(mime) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const k = Math.min(1, 1400 / Math.max(img.width, img.height)), w = img.width * k, h = img.height * k;
      pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    const st = await pdf.embedPng(await png(stampCanvas(info)));
    const ft = await pdf.embedPng(await png(lineCanvas(info.footer)));
    pdf.getPages().forEach((p, i) => {
      const { width: W, height: H } = p.getSize();
      if (i === 0) { const w = Math.min(W * 0.38, 300), h = w * st.height / st.width; p.drawImage(st, { x: 18, y: H - h - 18, width: w, height: h, opacity: 1 }); }
      const fh = Math.min(10, H * 0.02), fw = fh * ft.width / ft.height;
      p.drawImage(ft, { x: (W - fw) / 2, y: 6, width: fw, height: fh, opacity: 0.85 });
    });
    pdf.setProducer("Hadro"); pdf.setCreator("Hadro · " + (info.by || ""));
    return pdf.save();
  };
  HD.saveBytes = (bytes, name, type = "application/pdf") => {
    const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  HD.fileName = s => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
})();
