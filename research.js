/*!
 * Hadro · نظام إدارة الحضور
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 */
// Hadro — تقارير البحث العلمي (للمسؤول): مؤشرات مجمّعة ومجهّلة من سجلات المنصة، وتقرير Word أكاديمي، وملف بيانات Excel
(function () {
  const RS = window.RS = {};
  const esc = s => CM.esc(s);
  let X = null;   // { el, ctx, data, hash, opt }

  /* ---------------- أدوات حساب ---------------- */
  const num = (v, d = 1) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("en", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const pct = (a, b, d = 1) => !b ? "—" : num(a / b * 100, d) + "%";
  const med = a => { const s = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const q = (a, p) => { const s = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const sum = o => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
  const days = h => h == null ? null : h / 24;
  const dstr = d => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" });
  const ROLE = { admin: "المسؤول", lecturer: "محاضر", head: "رئيس قسم", ta: "معيد", system: "النظام (آلي)" };
  const METHOD = { code: "رمز رقمي يكتبه الطالب من شاشة القاعة", qr: "مسح رمز QR متغيّر كل 15 ثانية", scan: "مسح بطاقة الطالب بهاتف عضو الفريق", manual: "تسجيل يدوي من الفريق (حالة استثنائية)", import: "مستورد من كشوف ورقية أو إكسل (الطريقة اليدوية)" };
  const REASON = { replayed_qr: "استخدام رمز QR قديم (صورة أو رمز منقول)", expired_code: "رمز انتهت صلاحيته", wrong_code: "رمز خطأ", out_of_range: "خارج النطاق الجغرافي للقاعة", other: "أسباب أخرى" };
  const AP_R = { not_graded: "سلّم ولم تُرصد درجته", wrong_grade: "درجة مرصودة خطأ", other: "سبب آخر" };
  const AP_S = { accepted: "قُبل", rejected: "رُفض", withdrawn: "سحبه الطالب", pending: "قيد النظر" };
  const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const optGet = () => { try { return JSON.parse(CM.store.get("cm_rs") || "{}") || {}; } catch (e) { return {}; } };
  const optSet = o => CM.store.set("cm_rs", JSON.stringify(o));
  const termStart = () => { const n = new Date(), y = n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1; return y + "-09-01"; };
  const today = () => new Date().toISOString().slice(0, 10);

  async function sha256(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }

  // كل المؤشرات المشتقة في مكان واحد (نفس الأرقام في الشاشة والتقرير والإكسل)
  function derive(d, o) {
    const A = d.attendance || {}, I = d.integrity || {}, W = d.warnings || {}, S = d.submissions || {}, G = d.grading || {}, P = d.appeals || {}, L = d.workload || {}, M = d.meta || {};
    const ps = A.per_session || [];
    const p50 = med(ps.map(x => x.p50)), p90 = med(ps.map(x => x.p90)), nS = med(ps.map(x => x.n));
    const thr = med(ps.map(x => x.p90 > 0 ? x.n * .9 / x.p90 : null));
    const sa = svAnalyze(), stx = sa && sa.g.staff ? sa.g.staff.ex : {};
    const tMan = +o.manualSec || (stx.man_sec && stx.man_sec.med) || 0, gMan = +o.manualGradeSec || (stx.man_grade && stx.man_grade.med) || 0;
    const tSrc = +o.manualSec ? "الباحث من الملاحظة الميدانية" : tMan ? "وسيط تقديرات " + stx.man_sec.n + " من أعضاء الفريق في استطلاع الرأي" : "";
    const gSrc = +o.manualGradeSec ? "الباحث" : gMan ? "وسيط تقديرات " + stx.man_grade.n + " من أعضاء الفريق في استطلاع الرأي" : "";
    const manMin = tMan && nS ? nS * tMan / 60 : null;
    const bm = A.by_method || {}, appIn = (bm.code || 0) + (bm.qr || 0) + (bm.scan || 0) + (bm.manual || 0);
    const rej = sum(I.by_reason);
    const night = Object.entries(S.hour_of_day || {}).filter(([h]) => +h >= 21 || +h < 6).reduce((a, [, n]) => a + n, 0);
    const reached = sum(W.reached);
    return {
      p50, p90, nS, thr, manMin, saveMin: manMin != null && p90 != null ? manMin - p90 : null, tMan, gMan, tSrc, gSrc, sa,
      appIn, selfShare: appIn ? ((bm.code || 0) + (bm.qr || 0)) / appIn : null, manualShare: appIn ? (bm.manual || 0) / appIn : null,
      rej, rejPer100: A.checkins ? rej / A.checkins * 100 : null,
      rateApp: A.rate && A.rate.expected ? A.rate.present / A.rate.expected : null, rateImp: A.rate && A.rate.expected_imp ? A.rate.present_imp / A.rate.expected_imp : null,
      subRate: S.expected ? S.submitted / S.expected : null, lateRate: S.submitted ? S.late / S.submitted : null, night, nightShare: S.submitted ? night / S.submitted : null,
      okRate: S.checks && S.checks.checked ? S.checks.ok / S.checks.checked : null,
      secGrade: G.sec_per_grade ? G.sec_per_grade.p50 : null, gradeSaveSec: gMan && G.sec_per_grade && G.sec_per_grade.p50 != null ? gMan - G.sec_per_grade.p50 : null,
      apPer100: G.graded ? (P.total || 0) / G.graded * 100 : null,
      afterShare: L.events ? L.after_hours / L.events : null, reached,
      readRate: W.notifications && W.notifications.sent ? W.notifications.read / W.notifications.sent : null,
      pushShare: M.students ? (W.push_students || 0) / M.students : null
    };
  }

  /* ---------------- الشاشة ---------------- */
  RS.open = (el, ctx) => {
    const o = Object.assign({ from: termStart(), to: today(), manualSec: "", manualGradeSec: "", courses: null }, optGet());
    X = { el, ctx, data: null, hash: "", opt: o, svs: null, sv: null, val: null, vk: null };
    draw(); loadSurveys();
  };
  async function loadSurveys() { try { X.svs = await X.ctx.rpc("admin_surveys"); } catch (e) { X.svs = []; } const b = X.el.querySelector("#rsSvBox"); if (b) { b.outerHTML = svBox(); wireSv(); } }
  function draw() {
    const { el, ctx, opt: o } = X, list = ctx.courses.filter(c => !c.archived);
    el.innerHTML = `<div class="panel-h"><div><div class="eyebrow">للمسؤول فقط · بيانات مجمّعة ومجهّلة</div><h2>تقارير البحث العلمي</h2></div></div>
      <p class="muted small">مؤشرات محسوبة من سجلات المنصة التي تُكتب آليًا بتوقيت الخادم: الحضور، والتسليم، والتصحيح، والتظلمات، وعبء العمل. لا يظهر في أي ناتج اسم طالب أو كوده أو بريد أي عضو. التقرير يُنزَّل ملف Word مكتوبًا بصياغة أكاديمية بجداوله وتوثيقه، والبيانات تُنزَّل ملف Excel لتحليلها في SPSS أو غيره.</p>
      <div class="rs-form">
        <label class="f"><span>من تاريخ</span><input type="date" id="rsFrom" value="${esc(o.from)}"></label>
        <label class="f"><span>إلى تاريخ</span><input type="date" id="rsTo" value="${esc(o.to)}"></label>
        <label class="f"><span>زمن نداء الطالب الواحد يدويًا (ثانية) <small class="muted">من ملاحظتك الميدانية، اختياري</small></span><input type="text" inputmode="decimal" id="rsMan" value="${esc(o.manualSec)}" placeholder="مثلًا: 6"></label>
        <label class="f"><span>زمن رصد الدرجة الواحدة يدويًا (ثانية) <small class="muted">كشف ورقي ثم نقله، اختياري</small></span><input type="text" inputmode="decimal" id="rsManG" value="${esc(o.manualGradeSec)}" placeholder="مثلًا: 45"></label>
      </div>
      <details class="rs-cs"><summary>المواد المشمولة: ${o.courses ? o.courses.length + " مادة مختارة" : "كل المواد التي فيها نشاط في الفترة"}</summary>
        <div class="rs-cl">${list.map(c => `<label><input type="checkbox" data-rsc="${c.id}" ${!o.courses || o.courses.includes(c.id) ? "checked" : ""}> ${esc(c.name)} <small class="muted">${esc(ctx.clsLabel(c))}</small></label>`).join("")}</div>
        <div class="row"><button class="btn xs ghost" id="rsAll">الكل</button><button class="btn xs ghost" id="rsNone">ولا مادة</button></div></details>
      <div class="row"><button class="btn primary" id="rsRun">احسب المؤشرات</button>${X.data ? `<button class="btn" id="rsDoc">${ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>')} تنزيل التقرير (Word)</button><button class="btn" id="rsXl">${ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>')} تنزيل البيانات (Excel)</button>` : ""}<span class="small" id="rsMsg"></span></div>
      <div id="rsOut">${X.data ? dash() : ""}</div>
      ${svBox()}
      ${valBox()}`;
    const save = () => { o.from = $("#rsFrom").value; o.to = $("#rsTo").value; o.manualSec = $("#rsMan").value.trim(); o.manualGradeSec = $("#rsManG").value.trim();
      const ch = [...el.querySelectorAll("[data-rsc]")]; const on = ch.filter(x => x.checked).map(x => x.dataset.rsc); o.courses = on.length === ch.length ? null : on; optSet(o); };
    el.querySelectorAll("input").forEach(i => i.onchange = () => { save(); if (X.data && (i.id === "rsMan" || i.id === "rsManG")) { const out = $("#rsOut"); out.innerHTML = dash(); } });
    $("#rsAll").onclick = () => { el.querySelectorAll("[data-rsc]").forEach(x => x.checked = true); save(); };
    $("#rsNone").onclick = () => { el.querySelectorAll("[data-rsc]").forEach(x => x.checked = false); save(); };
    $("#rsRun").onclick = run;
    wireSv(); wireVal();
    const dc = $("#rsDoc"); if (dc) dc.onclick = () => exportDoc().catch(e => msg("!" + (e.message || e)));
    const xl = $("#rsXl"); if (xl) xl.onclick = () => exportXl().catch(e => msg("!" + (e.message || e)));
  }
  const $ = s => X.el.querySelector(s);
  const ic = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const msg = t => { const m = $("#rsMsg"); if (m) { m.className = "small " + (t.startsWith("!") ? "bad-t" : "ok-t"); m.textContent = t.replace(/^!/, ""); } };
  async function run() {
    const o = X.opt; if (o.courses && !o.courses.length) return msg("!اختر مادة واحدة على الأقل.");
    const b = $("#rsRun"); b.disabled = true; b.innerHTML = `<span class="spinner"></span> جارٍ الحساب…`;
    try {
      const from = new Date(o.from + "T00:00:00"), to = new Date(o.to + "T23:59:59");
      X.data = await X.ctx.rpc("research_stats", { p_from: from.toISOString(), p_to: to.toISOString(), p_courses: o.courses });
      const svId = o.sv || (X.svs && X.svs[0] && X.svs[0].id);
      const [rows, vals] = await Promise.all([svId ? X.ctx.rpc("admin_survey_responses", { sid: svId }).catch(() => []) : [], X.ctx.rpc("research_validations", { p_from: from.toISOString(), p_to: to.toISOString() }).catch(() => [])]);
      X.sv = svId ? { meta: (X.svs || []).find(x => x.id === svId), rows: rows || [] } : null; X.val = vals || [];
      X.data.survey_rows = X.sv ? X.sv.rows.length : 0; X.data.validations = X.val;
      X.hash = await sha256(JSON.stringify({ stats: X.data, survey: X.sv ? X.sv.rows : null }));
      draw(); msg("اتحسبت المؤشرات من " + num(X.data.meta.enrollments, 0) + " تسجيل طالب في " + X.data.meta.courses + " مادة.");
    } catch (e) { b.disabled = false; b.textContent = "احسب المؤشرات"; msg("!" + X.ctx.errText(e)); }
  }

  // لوحة سريعة قبل التنزيل
  function dash() {
    const d = X.data, o = X.opt, k = derive(d, o), A = d.attendance, S = d.submissions, G = d.grading, I = d.integrity;
    const card = (t, v, s) => `<div class="rs-k"><span>${t}</span><b>${v}</b>${s ? `<small>${s}</small>` : ""}</div>`;
    return `<div class="rs-ks">
      ${card("محاضرات سُجّل حضورها بالمنصة", num(A.sessions_app, 0), num(A.checkins, 0) + " تسجيل حضور")}
      ${card("نصف الطلبة سجّلوا خلال", num(k.p50) + " دقيقة", "و90% خلال " + num(k.p90) + " دقيقة (الوسيط)")}
      ${card("النداء اليدوي للعدد نفسه", k.manMin != null ? "≈ " + num(k.manMin) + " دقيقة" : "أدخل زمن النداء", k.manMin != null ? "تقدير: " + num(k.nS, 0) + " طالب × " + num(k.tMan) + " ث" : "من ملاحظتك الميدانية")}
      ${card("محاولات تسجيل غير صحيحة مُنعت", num(k.rej, 0), num(k.rejPer100) + " لكل 100 تسجيل · " + num(I.students_with_rejections, 0) + " طالب")}
      ${card("نسبة التسليم في الموعد", pct(S.submitted - S.late, S.expected), num(S.submitted, 0) + " تسليم من " + num(S.expected, 0) + " متوقع")}
      ${card("ملفات تطابقت بصمتها", k.okRate != null ? num(k.okRate * 100) + "%" : "—", num(S.checks.checked, 0) + " ملف فُحص · " + num(S.checks.missing, 0) + " محذوف")}
      ${card("زمن رصد الدرجة في المنصة", num(k.secGrade) + " ث", "الوسيط · " + num(G.sec_per_grade.n, 0) + " درجة متتالية")}
      ${card("تظلمات لكل 100 درجة", num(k.apPer100), num(d.appeals.total, 0) + " تظلم · الحسم خلال " + num(d.appeals.decide_p50_h) + " ساعة")}
      ${card("عمل خارج ساعات الدوام", k.afterShare != null ? num(k.afterShare * 100) + "%" : "—", "من " + num(d.workload.events, 0) + " إجراء")}
      ${k.sa ? card("استطلاع الرأي", num(k.sa.total - k.sa.declined, 0) + " إجابة", (k.sa.g.student ? "SUS الطلبة " + num(k.sa.g.student.sus.m) : "") + (k.sa.g.staff ? " · SUS الفريق " + num(k.sa.g.staff.sus.m) : "") + " · " + k.sa.declined + " اعتذار") : ""}
      ${X.val && X.val.length ? (() => { const t = X.val.reduce((a, v) => [a[0] + v.a, a[1] + v.b, a[2] + v.c, a[3] + v.d], [0, 0, 0, 0]); return card("التطابق مع الكشف الورقي", "κ = " + num(kappa(...t), 2), X.val.length + " محاضرة · اتفاق " + pct(t[0] + t[3], t[0] + t[1] + t[2] + t[3])); })() : ""}
    </div>
    <p class="small muted">رقم التحقق (SHA-256) لهذه النسخة من البيانات: <span class="mono" dir="ltr">${X.hash.slice(0, 16)}…</span> · يُكتب كاملًا في التقرير وملف البيانات ليُستشهد به.</p>`;
  }


  /* ---------------- استطلاع الرأي: إطلاق وإيقاف ونتائج ---------------- */
  const AUD = { all: "الطلبة والفريق", students: "الطلبة", staff: "الفريق (المحاضرون والمعيدون)" };
  function svBox() {
    const L = X.svs, o = X.opt, act = L && L.find(x => x.active);
    return `<section class="rs-box" id="rsSvBox"><div class="row between"><h3>استطلاع رأي المستخدمين</h3>${act ? `<span class="chip ok">مفتوح الآن</span>` : ""}</div>
      <p class="small muted">لما تطلقه، يظهر لكل مستخدم أول ما يفتح البرنامج ومايقدرش يكمل غير لما يجاوب. الاستطلاع: مقياس سهولة الاستخدام SUS (10 عبارات) ومحاور من نموذج قبول التقنية TAM (الفائدة، والثقة، والرضا، وعبء العمل للفريق)، وأسئلة مفتوحة. الإجابات تُحفظ بمعرّف مجهول.</p>
      ${L == null ? `<p class="small muted"><span class="spinner"></span> جارٍ التحميل…</p>` : `
      ${act ? "" : `<div class="row" style="gap:10px;align-items:end;flex-wrap:wrap"><label class="f" style="margin:0"><span>يظهر لـ</span><select id="rsAud">${Object.entries(AUD).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        <label class="row small" style="gap:6px"><input type="checkbox" id="rsDec" checked> اسمح بزرار «أعتذر عن المشاركة»</label>
        <button class="btn primary" id="rsSvGo">إطلاق الاستطلاع</button></div>
        <p class="small muted" id="rsDecNote">لجان أخلاقيات البحث بتشترط إن المشاركة تكون اختيارية، والإجابة الإجبارية بتقلل مصداقية البيانات (اللي مش عايز يجاوب بيعلّم أي اختيار وخلاص). الاستطلاع هيظهر للكل ولازم يتعاملوا معاه، بس اللي مش عايز يشارك يقدر يعتذر، وعدد المعتذرين بيتحسب في التقرير. لو شلت العلامة هيبقى الرد إجباري.</p>`}
      ${L.length ? `<div class="list">${L.map(x => `<div class="rs-sv"><div><b>${dstr(x.created_at)} · ${AUD[x.audience]}</b><div class="small muted">${x.n} إجابة · ${x.declined} اعتذار${x.allow_decline ? "" : " · إجباري"}${x.closed_at ? " · اتقفل " + dstr(x.closed_at) : ""}</div></div>
        <div class="row" style="gap:6px"><label class="small row" style="gap:4px"><input type="radio" name="rsSvPick" value="${x.id}" ${(o.sv || L[0].id) === x.id ? "checked" : ""}> في التقرير</label>${x.active ? `<button class="btn sm danger" data-svclose="${x.id}">إيقاف</button>` : ""}</div></div>`).join("")}</div>` : `<p class="small muted">لم يُطلق أي استطلاع بعد.</p>`}`}
    </section>`;
  }
  function wireSv() {
    const go = X.el.querySelector("#rsSvGo"); if (go) go.onclick = async () => {
      const aud = X.el.querySelector("#rsAud").value, dec = X.el.querySelector("#rsDec").checked;
      if (!confirm("إطلاق الاستطلاع لـ" + AUD[aud] + "؟ هيظهر لكل واحد منهم أول ما يفتح البرنامج" + (dec ? "، ويقدر يعتذر." : "، ومش هيقدر يكمل غير لما يجاوب."))) return;
      go.disabled = true; try { await X.ctx.rpc("admin_survey_start", { p_audience: aud, p_allow_decline: dec }); X.opt.sv = null; optSet(X.opt); await loadSurveys(); msg("اتطلق الاستطلاع."); } catch (e) { go.disabled = false; msg("!" + X.ctx.errText(e)); } };
    X.el.querySelectorAll("[data-svclose]").forEach(b => b.onclick = async () => { if (!confirm("إيقاف الاستطلاع؟ مش هيظهر لحد تاني.")) return; b.disabled = true; try { await X.ctx.rpc("admin_survey_close", { sid: b.dataset.svclose }); await loadSurveys(); } catch (e) { b.disabled = false; msg("!" + X.ctx.errText(e)); } });
    X.el.querySelectorAll('[name="rsSvPick"]').forEach(r => r.onchange = () => { X.opt.sv = r.value; optSet(X.opt); });
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  const alpha = mat => { const k = mat[0] ? mat[0].length : 0; if (k < 2 || mat.length < 3) return null; const vi = Array.from({ length: k }, (_, j) => sd(mat.map(r => r[j])) ** 2), vt = sd(mat.map(r => r.reduce((x, y) => x + y, 0))) ** 2; return vt ? k / (k - 1) * (1 - vi.reduce((x, y) => x + y, 0) / vt) : null; };
  const susOf = a => { let t = 0; for (let i = 1; i <= 10; i++) { const v = +a["sus" + i]; if (!v) return null; t += i % 2 ? v - 1 : 5 - v; } return t * 2.5; };
  const band = v => v == null ? "—" : v > 80.3 ? "ممتاز" : v > 68 ? "جيد" : v >= 51 ? "مقبول" : "ضعيف";
  function svAnalyze() {
    if (!X.sv || !X.sv.rows.length) return null;
    const all = X.sv.rows, ok = all.filter(r => !r.declined), grp = { student: ok.filter(r => r.role === "student"), staff: ok.filter(r => r.role !== "student") };
    const out = { total: all.length, declined: all.length - ok.length, meta: X.sv.meta, g: {} };
    Object.entries(grp).forEach(([g, rows]) => { if (!rows.length) return;
      const secs = CM.SURVEY[g === "student" ? "student" : "staff"];
      const sus = rows.map(r => susOf(r.answers)).filter(v => v != null), m = mean(sus), s = sd(sus);
      const susMat = rows.map(r => Array.from({ length: 10 }, (_, i) => { const v = +r.answers["sus" + (i + 1)]; return (i + 1) % 2 ? v - 1 : 5 - v; })).filter(r => r.every(v => !isNaN(v)));
      const cons = secs.filter(x => x.k !== "sus").map(x => { const mat = rows.map(r => x.items.map((_, i) => +r.answers[x.k + (i + 1)])).filter(r => r.every(v => v >= 1)); const per = mat.map(r => mean(r));
        return { k: x.k, t: x.t, n: mat.length, m: mean(per), sd: sd(per), a: alpha(mat), items: x.items.map((t, i) => { const v = mat.map(r => r[i]); return { t, m: mean(v), sd: sd(v), agree: v.length ? v.filter(z => z >= 4).length / v.length : null }; }) }; });
      const ex = {}; (CM.SURVEY.extra[g === "student" ? "student" : "staff"]).forEach(x => { const v = rows.map(r => r.answers[x.k]).filter(z => z != null && z !== ""); ex[x.k] = x.opts ? Object.fromEntries(x.opts.map(([k, l]) => [l, v.filter(z => z === k).length])) : { med: med(v.map(Number)), n: v.length }; });
      out.g[g] = { n: rows.length, sus: { m, sd: s, med: med(sus), ci: s != null ? 1.96 * s / Math.sqrt(sus.length) : null, a: alpha(susMat), n: sus.length, bands: ["ممتاز", "جيد", "مقبول", "ضعيف"].map(b => [b, sus.filter(v => band(v) === b).length]) },
        cons, ex, secs: med(rows.map(r => r.seconds).filter(Boolean)), levels: rows.reduce((a, r) => { if (r.level) a[r.level] = (a[r.level] || 0) + 1; return a; }, {}) }; });
    return out;
  }

  /* ---------------- عينة التحقق: كشف ورقي مقابل المنصة لنفس المحاضرة ---------------- */
  const kappa = (a, b, c, d) => { const n = a + b + c + d; if (!n) return null; const po = (a + d) / n, pe = ((a + b) * (a + c) + (c + d) * (b + d)) / (n * n); return pe === 1 ? 1 : (po - pe) / (1 - pe); };
  function valBox() {
    const v = X.vk || {}, list = X.ctx.courses.filter(c => !c.archived);
    return `<section class="rs-box" id="rsValBox"><h3>صدق التطابق: كشف ورقي مقابل المنصة</h3>
      <p class="small muted">اختار محاضرة اتاخد فيها الحضور بالمنصة وبكشف ورقي في نفس الوقت، والصق أكواد الحاضرين من الكشف الورقي (أو ارفع ملف إكسل فيه الأكواد). البرنامج يحسب نسبة الاتفاق ومعامل كابا لكوهين، ويحفظ النتيجة (من غير أكواد) عشان تدخل في التقرير.</p>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:end">
        <label class="f" style="margin:0;min-width:240px"><span>المادة</span><select id="rsVc"><option value="">اختر…</option>${list.map(c => `<option value="${c.id}" ${v.cid === c.id ? "selected" : ""}>${esc(c.name)} · ${esc(X.ctx.clsLabel(c))}</option>`).join("")}</select></label>
        <label class="f" style="margin:0;min-width:220px"><span>المحاضرة</span><select id="rsVs" ${v.sess ? "" : "disabled"}><option value="">اختر…</option>${(v.sess || []).map(x => `<option value="${x.id}" ${v.sid === x.id ? "selected" : ""}>المحاضرة ${x.n}${x.grp ? " · مجموعة " + esc(x.grp) : ""} · ${dstr(x.at)}${x.checked ? " ✓" : ""}</option>`).join("")}</select></label></div>
      ${v.sid ? `<label class="f"><span>أكواد الحاضرين في الكشف الورقي (كود في كل سطر أو مفصولة بمسافات)</span><textarea id="rsVt" rows="4" dir="ltr" placeholder="122401398&#10;122402138">${esc(v.txt || "")}</textarea></label>
        <div class="row"><label class="btn sm">رفع إكسل<input type="file" id="rsVx" accept=".xlsx" hidden></label><button class="btn sm primary" id="rsVgo">احسب الاتفاق</button></div>` : ""}
      ${v.res ? (() => { const r = v.res, n = r.a + r.b + r.c + r.d; return `<div class="tbl-wrap"><table class="rs-tbl"><thead><tr><th></th><th>حاضر ورقيًا</th><th>غائب ورقيًا</th></tr></thead><tbody>
        <tr><th>حاضر في المنصة</th><td>${r.a}</td><td>${r.b}</td></tr><tr><th>غائب في المنصة</th><td>${r.c}</td><td>${r.d}</td></tr></tbody></table></div>
        <p><b>نسبة الاتفاق: ${pct(r.a + r.d, n)} · كابا لكوهين: ${num(r.k, 3)}</b>${r.unknown ? ` <span class="small warn-t">(${r.unknown} كود في الكشف الورقي مش في كشف المحاضرة، اتجاهلوا)</span>` : ""}</p>
        ${r.diff.length ? `<details><summary class="small">الأكواد المختلفة (${r.diff.length}) · للمراجعة بس ومش بتتحفظ</summary><p class="small mono" dir="ltr">${r.diff.map(esc).join("، ")}</p></details>` : ""}
        <button class="btn sm" id="rsVsave" ${r.saved ? "disabled" : ""}>${r.saved ? "اتحفظت ✓" : "حفظ في عينة التحقق"}</button>`; })() : ""}
    </section>`;
  }
  function wireVal() {
    const box = () => { const b = X.el.querySelector("#rsValBox"); b.outerHTML = valBox(); wireVal(); };
    const c = X.el.querySelector("#rsVc"); if (c) c.onchange = async () => { X.vk = { cid: c.value }; if (c.value) { try { X.vk.sess = await X.ctx.rpc("research_sessions", { cid: c.value }); } catch (e) { msg("!" + X.ctx.errText(e)); } } box(); };
    const sEl = X.el.querySelector("#rsVs"); if (sEl) sEl.onchange = () => { X.vk.sid = sEl.value; X.vk.res = null; box(); };
    const t = X.el.querySelector("#rsVt"); if (t) t.oninput = () => { X.vk.txt = t.value; };
    const xf = X.el.querySelector("#rsVx"); if (xf) xf.onchange = async () => { const f = xf.files[0]; if (!f) return; await X.ctx.loadExcelJS(); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer()); const out = [];
      wb.eachSheet(ws => ws.eachRow(r => r.eachCell(cl => { const v = String(cl.text || cl.value || "").trim(); if (/^[0-9A-Za-z_-]{5,40}$/.test(v)) out.push(v); }))); X.vk.txt = out.join("\n"); box(); };
    const go = X.el.querySelector("#rsVgo"); if (go) go.onclick = async () => {
      const codes = new Set(String(X.vk.txt || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).split(/[\s,،;]+/).map(x => x.trim()).filter(Boolean));
      if (!codes.size) return msg("!الصق أكواد الحاضرين من الكشف الورقي الأول.");
      go.disabled = true;
      try { const ro = await X.ctx.rpc("research_session_roster", { sid: X.vk.sid }); const inR = new Set(ro.map(x => x.code)); let a = 0, b = 0, cc = 0, d = 0; const diff = [];
        ro.forEach(x => { const p = codes.has(x.code); if (x.app && p) a++; else if (x.app) { b++; diff.push(x.code + " (منصة فقط)"); } else if (p) { cc++; diff.push(x.code + " (ورقي فقط)"); } else d++; });
        X.vk.res = { a, b, c: cc, d, k: kappa(a, b, cc, d), diff, unknown: [...codes].filter(x => !inR.has(x)).length }; box(); }
      catch (e) { go.disabled = false; msg("!" + X.ctx.errText(e)); } };
    const sv = X.el.querySelector("#rsVsave"); if (sv) sv.onclick = async () => { const r = X.vk.res; sv.disabled = true;
      try { await X.ctx.rpc("research_validation_save", { sid: X.vk.sid, a: r.a, b: r.b, c: r.c, d: r.d, k: r.k == null ? null : Math.round(r.k * 10000) / 10000, p_note: "" }); r.saved = true; (X.vk.sess.find(x => x.id === X.vk.sid) || {}).checked = true; box(); msg("اتحفظت. اضغط «احسب المؤشرات» تاني عشان تدخل في التقرير."); }
      catch (e) { sv.disabled = false; msg("!" + X.ctx.errText(e)); } };
  }
  /* ---------------- ملف البيانات (Excel) ---------------- */
  async function exportXl() {
    const d = X.data, o = X.opt, k = derive(d, o), ctx = X.ctx; msg("جارٍ إعداد ملف البيانات…");
    await ctx.loadExcelJS();
    const wb = new ExcelJS.Workbook(); wb.creator = "Hadro"; wb.created = new Date();
    const sheet = (name, head, rows) => { const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] }); ws.addRow(head).font = { bold: true }; rows.forEach(r => ws.addRow(r)); ws.columns.forEach((c, i) => c.width = i === 0 ? 46 : 18); return ws; };
    sheet("المؤشرات", ["المؤشر", "القيمة", "الوحدة", "طريقة الحساب"], indicators(d, k).map(x => [x[0], x[1], x[2], x[3]]));
    sheet("جلسات الحضور", ["م", "عدد من سجّلوا", "دقائق حتى 50%", "دقائق حتى 90%", "دقائق حتى آخر تسجيل"], (d.attendance.per_session || []).map((x, i) => [i + 1, x.n, r2(x.p50), r2(x.p90), r2(x.span)]));
    sheet("طرق التسجيل", ["الطريقة", "العدد"], Object.entries(d.attendance.by_method || {}).map(([m, n]) => [METHOD[m] || m, n]));
    sheet("محاولات مرفوضة", ["السبب", "العدد"], Object.entries(d.integrity.by_reason || {}).map(([m, n]) => [REASON[m] || m, n]));
    sheet("توقيت التسليم", ["الساعة (بتوقيت القاهرة)", "عدد التسليمات"], Array.from({ length: 24 }, (_, h) => [h, (d.submissions.hour_of_day || {})[h] || 0]));
    sheet("أيام العمل", ["اليوم", "عدد الإجراءات"], [6, 0, 1, 2, 3, 4, 5].map(i => [WD[i], (d.workload.weekday || {})[i] || 0]));
    sheet("التظلمات", ["السبب / القرار", "العدد"], Object.entries(d.appeals.by || {}).map(([kk, n]) => { const [r, s] = kk.split("/"); return [(AP_R[r] || r) + " / " + (AP_S[s] || s), n]; }));
    if (X.sv && X.sv.rows.length) { const keys = [], ex = []; ["student", "staff"].forEach(g => CM.SURVEY[g].forEach(sec => sec.items.forEach((_, i) => { const kk = sec.k + (i + 1); if (!keys.includes(kk)) keys.push(kk); }))); ["student", "staff"].forEach(g => CM.SURVEY.extra[g].forEach(x => { if (!ex.includes(x.k)) ex.push(x.k); }));
      sheet("الاستطلاع (مجهّل)", ["المعرّف", "الفئة", "المستوى", "اعتذر", "زمن الإجابة (ث)", "SUS", ...keys, ...ex, ...CM.SURVEY.open.map(x => x[0])],
        X.sv.rows.map(r => [r.rid, r.role === "student" ? "طالب" : ROLE[r.role] || r.role, r.level || "", r.declined ? "نعم" : "", r.seconds || "", r.declined ? "" : susOf(r.answers), ...keys.map(kk => r.answers[kk] == null ? "" : r.answers[kk]), ...ex.map(kk => r.answers[kk] == null ? "" : r.answers[kk]), ...CM.SURVEY.open.map(x => r.answers[x[0]] || "")]));
      sheet("نص عبارات الاستطلاع", ["الرمز", "العبارة", "الفئة"], [].concat(...["student", "staff"].map(g => [].concat(...CM.SURVEY[g].map(sec => sec.items.map((t, i) => [sec.k + (i + 1), t, g === "student" ? "الطلبة" : "الفريق"]))))));
    }
    if (X.val && X.val.length) sheet("عينة التحقق الورقية", ["المحاضرة", "التاريخ", "حاضر في الاثنين", "المنصة فقط", "الورقي فقط", "غائب في الاثنين", "كابا"], X.val.map((v, i) => [i + 1, dstr(v.at), v.a, v.b, v.c, v.d, v.k]));
    sheet("التوثيق", ["البند", "القيمة"], docMeta(d).map(x => [x[0], x[1]]));
    const ws = wb.addWorksheet("البيانات الخام (JSON)"); ws.addRow(["research_stats output"]); ws.addRow([JSON.stringify(d)]);
    await ctx.saveWb(wb, "Hadro - بيانات البحث " + o.from + " - " + o.to + ".xlsx");
    msg("نزل ملف البيانات.");
  }
  const r2 = v => v == null ? null : Math.round(v * 100) / 100;

  // جدول المؤشرات بتعريفاتها (ملحق التقرير + ورقة في الإكسل)
  function indicators(d, k) {
    const A = d.attendance, S = d.submissions, G = d.grading, I = d.integrity, W = d.warnings, P = d.appeals, L = d.workload;
    return [
      ["محاضرات سُجّل حضورها بالمنصة", A.sessions_app, "محاضرة", "عدد جلسات الحضور في الفترة، باستثناء الجلسات التي أغلب حضورها مستورد من كشوف"],
      ["محاضرات حضورها مستورد من كشوف يدوية", A.sessions_imported, "محاضرة", "جلسات أكثر من نصف سجلاتها بطريقة «استيراد»"],
      ["تسجيلات الحضور بالمنصة", A.checkins, "تسجيل", "سجلات الحضور المعتمدة في جلسات المنصة"],
      ["الوسيط الزمني لتسجيل 50% من الحاضرين", r2(k.p50), "دقيقة", "لكل جلسة فيها 5 تسجيلات ذاتية أو أكثر: الزمن من بدء الجلسة حتى تسجيل نصف الحاضرين، ثم الوسيط بين الجلسات"],
      ["الوسيط الزمني لتسجيل 90% من الحاضرين", r2(k.p90), "دقيقة", "كالسابق حتى تسجيل 90% من الحاضرين"],
      ["معدل التسجيل", r2(k.thr), "طالب/دقيقة", "وسيط (90% من الحاضرين ÷ زمن الوصول إلى 90%) بين الجلسات"],
      ["زمن النداء اليدوي المقدَّر لجلسة نموذجية", r2(k.manMin), "دقيقة", "وسيط عدد الحاضرين × زمن نداء الطالب الذي أدخله الباحث ÷ 60"],
      ["نسبة التسجيل الذاتي (رمز أو QR)", k.selfShare != null ? r2(k.selfShare * 100) : null, "%", "تسجيلات الطلبة بأنفسهم ÷ كل تسجيلات المنصة"],
      ["نسبة التسجيل اليدوي الاستثنائي", k.manualShare != null ? r2(k.manualShare * 100) : null, "%", "تسجيلات الفريق اليدوية ÷ كل تسجيلات المنصة"],
      ["نسبة الحضور في جلسات المنصة", k.rateApp != null ? r2(k.rateApp * 100) : null, "%", "مجموع الحاضرين ÷ مجموع المطلوب حضورهم (حسب مجموعة الجلسة)"],
      ["نسبة الحضور في الجلسات المستوردة", k.rateImp != null ? r2(k.rateImp * 100) : null, "%", "كالسابق للجلسات المستوردة من كشوف"],
      ["محاولات تسجيل مرفوضة", k.rej, "محاولة", "محاولات لم تُقبل: رمز قديم أو منتهٍ أو خطأ، أو خارج نطاق القاعة"],
      ["المحاولات المرفوضة لكل 100 تسجيل", r2(k.rejPer100), "محاولة", "المحاولات المرفوضة ÷ تسجيلات المنصة × 100"],
      ["وسيط بُعد الطالب عن مركز القاعة", r2(A.dist_m && A.dist_m.p50), "متر", "من إحداثيات الهاتف لحظة التسجيل"],
      ["وسيط دقة تحديد الموقع", r2(A.acc_m && A.acc_m.p50), "متر", "الدقة التي يعلنها الهاتف نفسه"],
      ["طلبة وصلوا إلى إنذار", k.reached, "حالة", "حالات بلوغ مستوى إنذار (طالب × مادة × مستوى)"],
      ["الإشعارات المرسلة للطلبة", W.notifications.sent, "إشعار", "إشعارات المنصة للطلبة في الفترة"],
      ["نسبة قراءة الإشعارات", k.readRate != null ? r2(k.readRate * 100) : null, "%", "الإشعارات المقروءة ÷ المرسلة"],
      ["وسيط زمن قراءة الإشعار", r2(W.notifications.read_p50_h), "ساعة", "من الإرسال حتى القراءة"],
      ["نسبة الطلبة المفعّلين لإشعارات الهاتف", k.pushShare != null ? r2(k.pushShare * 100) : null, "%", "طلبة لهم اشتراك إشعارات ÷ طلبة العينة"],
      ["التسليمات المتوقعة", S.expected, "تسليم", "طلبة كل تكليف تسليم (حسب مجموعته) في الفترة"],
      ["التسليمات الفعلية", S.submitted, "تسليم", "تسليمات وصلت عبر المنصة"],
      ["نسبة التسليم", k.subRate != null ? r2(k.subRate * 100) : null, "%", "التسليمات ÷ المتوقع"],
      ["نسبة التسليم المتأخر", k.lateRate != null ? r2(k.lateRate * 100) : null, "%", "المتأخر ÷ التسليمات"],
      ["وسيط التسليم قبل الموعد", r2(S.lead_h.p50), "ساعة", "الفرق بين موعد التسليم ولحظة التسليم"],
      ["نسبة التسليم ليلًا (9 م – 6 ص)", k.nightShare != null ? r2(k.nightShare * 100) : null, "%", "حسب توقيت القاهرة"],
      ["ملفات لها بصمة رقمية (MD5)", S.checks.with_md5, "ملف", "بصمة الملف كما سجّلتها Google Drive لحظة التسليم"],
      ["ملفات فُحصت بعد التسليم", S.checks.checked, "ملف", "مقارنة الملف الحالي بالبصمة المسجّلة"],
      ["نسبة الملفات المطابقة", k.okRate != null ? r2(k.okRate * 100) : null, "%", "المطابقة ÷ المفحوصة"],
      ["طلبات إعادة رفع ملف", S.fix.requested, "طلب", "ملف محذوف أو غير واضح أو خطأ"],
      ["وسيط زمن إعادة الرفع", r2(S.fix.p50_h), "ساعة", "من الطلب حتى إعادة الرفع"],
      ["الدرجات المرصودة", G.graded, "درجة", "في تكليفات التسليم والرصد اليدوي"],
      ["وسيط زمن رصد الدرجة في المنصة", r2(G.sec_per_grade.p50), "ثانية", "الفاصل بين درجتين متتاليتين للمصحح نفسه (بين 2 و600 ثانية)"],
      ["الربيع الأدنى والأعلى لزمن الرصد", G.sec_per_grade.p25 != null ? r2(G.sec_per_grade.p25) + " – " + r2(G.sec_per_grade.p75) : null, "ثانية", "الربيعان الأول والثالث"],
      ["درجات أُدخلت دفعة واحدة من كشف إكسل", G.bulk_rows, "درجة", "5 درجات أو أكثر بالتوقيت نفسه للمصحح نفسه"],
      ["وسيط زمن إعلان النتيجة بعد التسليم", r2(days(G.turnaround_h.p50)), "يوم", "من آخر الموعد أو التسليم حتى الرصد"],
      ["درجات مصحوبة بملاحظة مكتوبة", G.with_feedback, "درجة", "تغذية راجعة نصية للطالب"],
      ["التظلمات", P.total, "تظلم", "تظلمات الطلبة على الدرجات"],
      ["التظلمات لكل 100 درجة", r2(k.apPer100), "تظلم", "التظلمات ÷ الدرجات × 100"],
      ["وسيط زمن الحسم في التظلم", r2(P.decide_p50_h), "ساعة", "من تقديم التظلم حتى القبول أو الرفض"],
      ["إجراءات الفريق المسجّلة", L.events, "إجراء", "بدء محاضرة + رصد درجة + كل تعديل في سجل المواد"],
      ["نسبة الإجراءات خارج الدوام", k.afterShare != null ? r2(k.afterShare * 100) : null, "%", "قبل 8 ص أو بعد 4 م أو يوم الجمعة"]
    ];
  }
  function docMeta(d) {
    return [["المنصة", "Hadro · " + CM.APP.title + " · الإصدار " + CM.APP.version + " " + (document.querySelector("footer") ? (document.querySelector("footer").textContent.match(/\(b\d+\)/) || [""])[0] : "")],
      ["الجهة", CM.APP.org], ["فترة البيانات", dstr(d.meta.from) + " إلى " + dstr(d.meta.to)], ["تاريخ استخراج البيانات", new Date(d.meta.generated_at).toLocaleString("ar-EG-u-nu-latn")],
      ["مصدر البيانات", "قاعدة بيانات المنصة (PostgreSQL)، الدالة research_stats"], ["رقم التحقق SHA-256", X.hash],
      ["طريقة التحقق", "يُعاد حساب SHA-256 لمحتوى ورقة «البيانات الخام (JSON)» فيطابق الرقم إن لم تُعدَّل البيانات"]];
  }

  /* ---------------- التقرير (Word) ---------------- */
  const loadDocx = () => window.docx ? Promise.resolve() : new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "vendor/docx.js"; s.onload = ok; s.onerror = () => bad({ message: "تعذّر تحميل أداة Word. تأكّد من الاتصال وأعد المحاولة." }); document.head.appendChild(s); });
  async function exportDoc() {
    msg("جارٍ إعداد التقرير…"); await loadDocx();
    const D = window.docx, d = X.data, o = X.opt, k = derive(d, o);
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle, Footer, PageNumber, ShadingType, PageBreak } = D;
    const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Simplified Arabic", eastAsia: "Simplified Arabic" };
    const run = (t, o2 = {}) => new TextRun({ text: String(t), rightToLeft: true, font: FONT, size: o2.size || 26, sizeComplexScript: o2.size || 26, bold: !!o2.b, boldComplexScript: !!o2.b, italics: !!o2.i, italicsComplexScript: !!o2.i, color: o2.color });
    const P = (t, o2 = {}) => new Paragraph({ bidirectional: true, alignment: o2.center ? AlignmentType.CENTER : AlignmentType.BOTH, spacing: { after: o2.after == null ? 120 : o2.after, line: 360 }, indent: o2.ind ? { firstLine: 400 } : undefined,
      children: (Array.isArray(t) ? t : [t]).map(x => typeof x === "string" ? run(x, o2) : x), heading: o2.h, keepNext: !!o2.keep });
    const H1 = t => new Paragraph({ bidirectional: true, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, keepNext: true, children: [run(t, { b: true, size: 32, color: "1D6B58" })] });
    const H2 = t => new Paragraph({ bidirectional: true, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, keepNext: true, children: [run(t, { b: true, size: 28 })] });
    const BL = t => new Paragraph({ bidirectional: true, alignment: AlignmentType.BOTH, bullet: { level: 0 }, spacing: { after: 80, line: 340 }, children: [run(t)] });
    let tn = 0;
    const cell = (t, o2 = {}) => new TableCell({ children: [new Paragraph({ bidirectional: true, alignment: o2.c ? AlignmentType.CENTER : AlignmentType.RIGHT, children: [run(t == null ? "—" : t, { size: 22, b: o2.b })] })],
      shading: o2.head ? { type: ShadingType.CLEAR, color: "auto", fill: "DCECE6" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 } });
    const TBL = (title, head, rows, note) => { tn++;
      const bd = { style: BorderStyle.SINGLE, size: 4, color: "8FA8A0" };
      return [new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 80 }, children: [run("جدول (" + tn + "): " + title, { b: true, size: 24 })] }),
        new Table({ visuallyRightToLeft: true, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd },
          rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { head: true, b: true, c: i > 0 })) }), ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, { c: i > 0 })) }))] }),
        new Paragraph({ bidirectional: true, spacing: { before: 60, after: 200 }, children: [run("المصدر: سجلات منصة Hadro، الفترة " + dstr(d.meta.from) + " – " + dstr(d.meta.to) + "." + (note ? " " + note : ""), { size: 20, i: true, color: "56645F" })] })]; };
    const A = d.attendance, S = d.submissions, G = d.grading, I = d.integrity, W = d.warnings, AP = d.appeals, L = d.workload, M = d.meta, SU = d.support;
    const roles = Object.entries(M.staff_roles || {}).map(([r, n]) => n + " " + (ROLE[r] || r)).join("، ");
    const body = [];
    // الغلاف
    body.push(P("تقرير إحصائي", { center: true, b: true, size: 40, after: 120 }),
      P("مؤشرات استخدام منصة Hadro لإدارة الحضور والتكليفات والدرجات", { center: true, b: true, size: 34, after: 120 }),
      P(CM.APP.org, { center: true, size: 26, after: 360 }),
      P("فترة البيانات: من " + dstr(M.from) + " إلى " + dstr(M.to), { center: true }),
      P("تاريخ الاستخراج: " + new Date(M.generated_at).toLocaleString("ar-EG-u-nu-latn"), { center: true }),
      P("أُعدّ هذا التقرير آليًا من سجلات المنصة لأغراض البحث العلمي، ولا يتضمن أي بيانات تعريفية للطلبة أو لأعضاء هيئة التدريس.", { center: true, size: 22, i: true, after: 240 }),
      P([run("رقم التحقق من سلامة البيانات (SHA-256):", { size: 20, b: true })], { center: true, after: 40 }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: X.hash, font: "Consolas", size: 18 })] }),
      new Paragraph({ children: [new PageBreak()] }));
    // ملخص
    body.push(H1("ملخص"),
      P("يعرض هذا التقرير مؤشرات كمية وصفية مستخرجة من السجلات الآلية لمنصة Hadro خلال الفترة المذكورة، وتشمل " + M.courses + " مقررًا دراسيًا و" + num(M.students, 0) + " طالبًا (" + num(M.enrollments, 0) + " تسجيلًا في المقررات)، وفريق تدريس فعّال من " + (roles || "—") + ". وتتناول المؤشرات خمسة محاور: كفاءة تسجيل الحضور وموثوقيته، والتواصل مع الطلبة بشأن الغياب، وتسليم التكليفات وسلامة ملفاتها، والتصحيح والتظلمات، وتوزيع عبء العمل على الفريق.", { ind: true }),
      BL("سُجّل الحضور في " + num(A.sessions_app, 0) + " محاضرة عبر المنصة بإجمالي " + num(A.checkins, 0) + " تسجيلًا، وبلغ الوسيط الزمني لتسجيل 90% من الحاضرين " + num(k.p90) + " دقيقة من بدء المحاضرة" + (k.manMin != null ? "، مقابل نحو " + num(k.manMin) + " دقيقة تقديرية للنداء اليدوي للعدد نفسه." : ".")),
      BL("مُنعت " + num(k.rej, 0) + " محاولة تسجيل غير صحيحة (" + num(k.rejPer100) + " محاولة لكل 100 تسجيل)، منها " + num((I.by_reason || {}).replayed_qr || 0, 0) + " محاولة باستخدام رمز QR قديم و" + num((I.by_reason || {}).out_of_range || 0, 0) + " محاولة من خارج النطاق الجغرافي للقاعة."),
      BL("بلغت نسبة التسليم " + (k.subRate != null ? num(k.subRate * 100) + "%" : "—") + " من التسليمات المتوقعة، ونسبة المتأخر منها " + (k.lateRate != null ? num(k.lateRate * 100) + "%" : "—") + "، وطابقت " + (k.okRate != null ? num(k.okRate * 100) + "%" : "—") + " من الملفات المفحوصة بصمتها الرقمية المسجّلة لحظة التسليم."),
      BL("بلغ الوسيط الزمني لرصد الدرجة الواحدة داخل المنصة " + num(k.secGrade) + " ثانية" + (k.gMan ? "، مقابل " + num(k.gMan) + " ثانية تقديرية للرصد اليدوي." : ".") + " وبلغت التظلمات " + num(k.apPer100) + " تظلمًا لكل 100 درجة، حُسم نصفها خلال " + num(AP.decide_p50_h) + " ساعة."),
      BL("وقع " + (k.afterShare != null ? num(k.afterShare * 100) + "%" : "—") + " من إجراءات الفريق المسجّلة خارج ساعات الدوام الرسمية."));
    // ١ مقدمة
    body.push(H1("1. مقدمة"),
      P("تُعد منصة Hadro نظامًا رقميًا لإدارة حضور المحاضرات، وتسليم التكليفات وتصحيحها، ورصد الدرجات والتظلمات، طُوِّر واستُخدم في قسم الديكور بكلية الفنون الجميلة. وتسجّل المنصة كل عملية بتوقيت الخادم في سجلات لا يحررها المستخدم، وهو ما يتيح استخراج مؤشرات سلوكية موضوعية عن الاستخدام الفعلي، بخلاف الاستبانات التي تقيس انطباعات المستخدمين.", { ind: true }),
      P("ويهدف هذا التقرير إلى وصف هذه المؤشرات وصفًا كميًا، وتوثيق طريقة حسابها وحدودها، تمهيدًا لاستخدامها في البحث العلمي مصدرًا من مصادر البيانات إلى جانب أدوات أخرى (كالملاحظة الميدانية والاستبانات). ولا يدّعي التقرير بذاته علاقة سببية بين استخدام المنصة وأي نتيجة تعليمية؛ إذ إن ذلك يتطلب تصميمًا بحثيًا مقارنًا مستقلًا (انظر قسم حدود البيانات في آخر التقرير).", { ind: true }),
      P("وتتضمن المنصة وظائف قائمة على المعالجة الذكية للبيانات، منها: رصد الدرجات بالإملاء الصوتي (التعرف الآلي على الكلام ومطابقة الاسم المنطوق بكشف المادة)، والمطابقة التقريبية للأسماء العربية، والتحقق الآلي من سلامة الملفات ببصماتها الرقمية، والتنبيه الآلي للطلبة عند بلوغ حدود الغياب. ويمكن النظر إليها بوصفها بنية رقمية تمهيدية لإدماج أدوات الذكاء الاصطناعي في العملية التعليمية، مع مراعاة أن هذه الوظائف ليست تطبيقات للذكاء الاصطناعي التوليدي.", { ind: true }));
    // ٢ المنهجية
    body.push(H1("2. المنهجية"),
      H2("2.1 مصدر البيانات وطبيعتها"),
      P("البيانات مستخرجة مباشرة من قاعدة بيانات المنصة (PostgreSQL) بدالة إحصائية واحدة (research_stats) تُعيد مؤشرات مجمّعة. وكل الأزمنة الواردة مأخوذة من ساعة الخادم لا من أجهزة المستخدمين، وسجل التعديلات في المنصة قابل للإضافة فقط ولا يمكن لأي مستخدم حذفه أو تعديله.", { ind: true }),
      H2("2.2 مجتمع الدراسة والفترة"),
      P("يشمل التحليل " + M.courses + " مقررًا لها نشاط (محاضرة أو تكليف) خلال الفترة من " + dstr(M.from) + " إلى " + dstr(M.to) + "، في المستويات الدراسية: " + (M.levels || []).join("، ") + ".", { ind: true }),
      H2("2.3 معايير التضمين والاستبعاد"),
      BL("تُستبعد من مؤشرات زمن التسجيل الجلسات التي أغلب حضورها مستورد من كشوف ورقية أو إكسل، وتُعرض منفصلة بوصفها جلسات «الطريقة اليدوية»."),
      BL("لا تُحسب أزمنة التسجيل إلا للتسجيلات الذاتية (رمز أو QR أو مسح البطاقة)، وفي الجلسات التي سُجّل فيها 5 طلبة أو أكثر، وخلال ساعتين من انتهاء التسجيل."),
      BL("لا يُحسب زمن رصد الدرجة إلا للفواصل بين درجتين متتاليتين للمصحح نفسه بين 2 و600 ثانية، ويُستبعد الرصد الجماعي من كشوف إكسل ويُعرض منفصلًا."),
      H2("2.4 التجهيل وأخلاقيات البحث"),
      P("لا يحتوي الناتج على أي اسم أو كود طالب أو بريد إلكتروني؛ فكل المؤشرات مجمّعة على مستوى المقررات أو الجلسات. ويُوصى قبل النشر بالحصول على موافقة لجنة أخلاقيات البحث المختصة، وإبلاغ المشاركين بأن بيانات الاستخدام المجمّعة قد تُستخدم لأغراض بحثية.", { ind: true }),
      H2("2.5 المقاييس الإحصائية"),
      P("نظرًا إلى أن توزيعات الأزمنة ملتوية عادةً (قليل من القيم الكبيرة جدًا)، يُستخدم الوسيط والربيعان الأول والثالث بدلًا من المتوسط الحسابي، وتُستخدم النسب المئوية للمتغيرات الفئوية.", { ind: true }),
      H2("2.6 التحقق من سلامة البيانات"),
      P("يُحسب رقم تحقق (SHA-256) لمحتوى البيانات المستخرجة، ويُدوَّن في هذا التقرير وفي ملف البيانات المصاحب. وأي تعديل في البيانات بعد استخراجها يغيّر هذا الرقم، مما يتيح لأي مراجع التأكد من أن الأرقام الواردة هي نفسها المستخرجة من المنصة.", { ind: true }));
    // ٣ العينة
    body.push(H1("3. خصائص العينة"), ...TBL("خصائص العينة", ["البند", "العدد"], [
      ["المقررات الدراسية", num(M.courses, 0)], ["الطلبة (بدون تكرار)", num(M.students, 0)], ["تسجيلات الطلبة في المقررات", num(M.enrollments, 0)],
      ["أعضاء الفريق في المقررات", roles || "—"], ["أعضاء الفريق الذين بدأوا محاضرة أو رصدوا درجة في الفترة", num(M.staff_active, 0)],
      ["محاضرات سُجّل حضورها بالمنصة", num(A.sessions_app, 0)], ["محاضرات حضورها مستورد من كشوف", num(A.sessions_imported, 0)],
      ["تكليفات تسليم إلكتروني", num(S.tasks, 0)], ["تكليفات رصد يدوي", num(S.tasks_manual, 0)]]));
    // ٤ الحضور
    const bm = A.by_method || {}, bmT = sum(bm);
    const sess = A.per_session || [];
    body.push(H1("4. كفاءة تسجيل الحضور"),
      H2("4.1 طرق التسجيل"), ...TBL("توزيع تسجيلات الحضور حسب الطريقة", ["الطريقة", "العدد", "النسبة"], Object.entries(bm).sort((a, b) => b[1] - a[1]).map(([m, n]) => [METHOD[m] || m, num(n, 0), pct(n, bmT)])),
      P("تشير هذه البيانات إلى أن " + (k.selfShare != null ? num(k.selfShare * 100) + "%" : "—") + " من تسجيلات المنصة تمت بواسطة الطلبة أنفسهم دون تدخل الفريق، بينما لم يتجاوز التسجيل اليدوي الاستثنائي " + (k.manualShare != null ? num(k.manualShare * 100) + "%" : "—") + ".", { ind: true }),
      H2("4.2 الزمن اللازم لتسجيل الحضور"),
      ...TBL("الزمن من بدء المحاضرة حتى تسجيل الحاضرين (جلسات المنصة)", ["المؤشر", "الوسيط", "الربيع الأدنى", "الربيع الأعلى"], [
        ["عدد الحاضرين في الجلسة", num(k.nS, 0), num(q(sess.map(x => x.n), .25), 0), num(q(sess.map(x => x.n), .75), 0)],
        ["دقائق حتى تسجيل 50%", num(k.p50), num(q(sess.map(x => x.p50), .25)), num(q(sess.map(x => x.p50), .75))],
        ["دقائق حتى تسجيل 90%", num(k.p90), num(q(sess.map(x => x.p90), .25)), num(q(sess.map(x => x.p90), .75))],
        ["معدل التسجيل (طالب/دقيقة)", num(k.thr), num(q(sess.map(x => x.p90 > 0 ? x.n * .9 / x.p90 : null), .25)), num(q(sess.map(x => x.p90 > 0 ? x.n * .9 / x.p90 : null), .75))]],
        "عدد الجلسات المحسوبة: " + sess.length + "."),
      H2("4.3 مقارنة تقديرية بالنداء اليدوي"),
      ...(k.manMin != null ? [P("بافتراض أن نداء الطالب الواحد يدويًا يستغرق " + num(k.tMan) + " ثانية (المصدر: " + k.tSrc + ")، يستغرق نداء " + num(k.nS, 0) + " طالبًا (وسيط عدد الحاضرين) نحو " + num(k.manMin) + " دقيقة من زمن المحاضرة، مقابل " + num(k.p90) + " دقيقة لتسجيل 90% من الحاضرين عبر المنصة، علمًا بأن التسجيل في المنصة يجري بالتوازي مع بدء الشرح ولا يتطلب توقف المحاضر.", { ind: true }),
        ...TBL("مقارنة تقديرية لزمن تسجيل الحضور في جلسة نموذجية", ["الطريقة", "الزمن (دقيقة)", "أساس التقدير"], [["النداء اليدوي", num(k.manMin), num(k.nS, 0) + " طالب × " + num(k.tMan) + " ثانية"], ["المنصة (حتى 90%)", num(k.p90), "قياس فعلي من السجلات"], ["الفرق", num(k.saveMin), "تقديري"]], "قيمة النداء اليدوي تقديرية، ويُوصى بقياسها قياسًا منهجيًا (انظر قسم حدود البيانات).")]
        : [P("لم يُدخل الباحث بعدُ متوسط زمن نداء الطالب الواحد يدويًا؛ لذا لا تُعرض المقارنة. ويمكن الحصول على هذه القيمة بملاحظة عدد من المحاضرات التي يُنادى فيها على الطلبة يدويًا وقياس الزمن بساعة إيقاف، ثم إدخال المتوسط في صفحة التقارير وإعادة تنزيل التقرير.", { ind: true })]),
      H2("4.4 نسب الحضور"),
      ...TBL("نسب الحضور في جلسات المنصة والجلسات المستوردة", ["نوع الجلسات", "الحاضرون", "المطلوب حضورهم", "النسبة"], [
        ["جلسات المنصة", num(A.rate.present, 0), num(A.rate.expected, 0), pct(A.rate.present, A.rate.expected)],
        ["جلسات مستوردة من كشوف", num(A.rate.present_imp, 0), num(A.rate.expected_imp, 0), pct(A.rate.present_imp, A.rate.expected_imp)]],
        "المقارنة وصفية؛ إذ تختلف المقررات والتوقيتات بين النوعين."));
    // ٥ الموثوقية
    const br = I.by_reason || {};
    body.push(H1("5. موثوقية بيانات الحضور"),
      P("تعتمد المنصة عدة ضوابط تمنع تسجيل الحضور لغير الموجودين في القاعة: رمز يتغير دوريًا وينتهي سريعًا، ورمز QR يتجدد كل 15 ثانية فلا تصلح صورته بعد التقاطها، والتحقق من موقع الهاتف ضمن نطاق القاعة، وربط حساب الطالب بجهاز واحد. وتُسجَّل كل محاولة مرفوضة بسببها.", { ind: true }),
      ...TBL("محاولات التسجيل التي رفضتها المنصة", ["السبب", "العدد", "النسبة من المرفوض"], Object.entries(br).sort((a, b) => b[1] - a[1]).map(([r, n]) => [REASON[r] || r, num(n, 0), pct(n, k.rej)]),
        "عدد الطلبة أصحاب محاولة مرفوضة واحدة على الأقل: " + num(I.students_with_rejections, 0) + "."),
      P("تجدر الإشارة إلى أن المحاولة المرفوضة لا تعني بالضرورة محاولة غش؛ فقد تنتج عن تأخر الطالب في إدخال الرمز أو ضعف إشارة الموقع. غير أن المحاولات باستخدام رمز QR قديم (" + num(br.replayed_qr || 0, 0) + ") ومن خارج نطاق القاعة (" + num(br.out_of_range || 0, 0) + ") تمثل حالات كانت ستُقبل في الطرق التي لا تتحقق من الحضور الفعلي.", { ind: true }),
      ...TBL("دقة الموقع الجغرافي لحظة التسجيل", ["المؤشر", "الوسيط (متر)", "المئين 90 (متر)", "عدد التسجيلات"], [
        ["بُعد الطالب عن مركز القاعة", num(A.dist_m.p50, 0), num(A.dist_m.p90, 0), num(A.dist_m.n, 0)], ["دقة تحديد الموقع المعلنة من الهاتف", num(A.acc_m.p50, 0), num(A.acc_m.p90, 0), num(A.acc_m.n, 0)]]));
    // ٦ الإنذارات والتواصل
    const wr = W.reached || {};
    body.push(H1("6. الإنذارات والتواصل مع الطلبة"),
      ...TBL("الإنذارات والإشعارات", ["البند", "العدد / القيمة"], [
        ["حالات بلوغ الإنذار الأول", num(wr[1] || 0, 0)], ["حالات بلوغ الإنذار الثاني", num(wr[2] || 0, 0)], ["حالات بلوغ الإنذار الثالث والنهائي", num(wr[3] || 0, 0)], ["حالات الانسحاب الإجباري", num(wr[4] || 0, 0)],
        ["إنذارات اطّلع عليها الطالب بنفسه في المنصة", num(W.seen, 0)], ["إبلاغات مسجّلة من الفريق", num(W.announced, 0)],
        ["إشعارات أُرسلت للطلبة", num(W.notifications.sent, 0)], ["نسبة الإشعارات المقروءة", k.readRate != null ? num(k.readRate * 100) + "%" : "—"], ["وسيط زمن القراءة (ساعة)", num(W.notifications.read_p50_h)],
        ["الطلبة المفعّلون لإشعارات الهاتف", num(W.push_students, 0) + " (" + (k.pushShare != null ? num(k.pushShare * 100) + "%" : "—") + ")"]]));
    // ٧ التسليم
    const hod = S.hour_of_day || {}, bins = [["9 ص – 3 م", [9, 10, 11, 12, 13, 14]], ["3 م – 9 م", [15, 16, 17, 18, 19, 20]], ["9 م – 12 ص", [21, 22, 23]], ["12 ص – 6 ص", [0, 1, 2, 3, 4, 5]], ["6 ص – 9 ص", [6, 7, 8]]];
    body.push(H1("7. تسليم التكليفات وسلامة الملفات"),
      ...TBL("مؤشرات التسليم", ["المؤشر", "القيمة"], [["التسليمات المتوقعة", num(S.expected, 0)], ["التسليمات الفعلية", num(S.submitted, 0) + " (" + (k.subRate != null ? num(k.subRate * 100) + "%" : "—") + ")"],
        ["تسليمات متأخرة", num(S.late, 0) + " (" + (k.lateRate != null ? num(k.lateRate * 100) + "%" : "—") + ")"], ["تسليمات أُعيد رفعها (نسخة ثانية فأكثر)", num(S.resubmitted, 0)],
        ["ملفات على Google Drive / روابط", num(S.kind.drive, 0) + " / " + num(S.kind.link, 0)], ["وسيط التسليم قبل الموعد (ساعة)", num(S.lead_h.p50) + " (الربيعان: " + num(S.lead_h.p25) + " – " + num(S.lead_h.p75) + ")"],
        ["فتح تسليم استثنائي لطالب بعذر", num(S.extensions, 0)]]),
      ...TBL("توزيع التسليمات على ساعات اليوم", ["الفترة (توقيت القاهرة)", "التسليمات", "النسبة"], bins.map(([l, hs]) => { const n = hs.reduce((a, h) => a + (hod[h] || 0), 0); return [l, num(n, 0), pct(n, S.submitted)]; })),
      P("يكشف توزيع التسليمات أن " + (k.nightShare != null ? num(k.nightShare * 100) + "%" : "—") + " منها تم ليلًا بين التاسعة مساءً والسادسة صباحًا، وهو ما يتعذر في التسليم الورقي المرتبط بوجود الطالب والمحاضر في الكلية.", { ind: true }),
      ...TBL("سلامة الملفات بعد التسليم", ["المؤشر", "القيمة"], [["ملفات لها بصمة رقمية MD5 مسجّلة", num(S.checks.with_md5, 0)], ["ملفات فُحصت بعد التسليم", num(S.checks.checked, 0)],
        ["مطابقة لبصمتها", num(S.checks.ok, 0) + " (" + (k.okRate != null ? num(k.okRate * 100) + "%" : "—") + ")"], ["عُدّلت بعد التسليم", num(S.checks.changed, 0)], ["محذوفة من حساب الطالب", num(S.checks.missing, 0)],
        ["طلبات إعادة رفع", num(S.fix.requested, 0)], ["أُعيد رفعها", num(S.fix.done, 0) + " (منها " + num(S.fix.match, 0) + " بالبصمة نفسها)"], ["وسيط زمن إعادة الرفع (ساعة)", num(S.fix.p50_h)]],
        "البصمة الرقمية تُثبت أن الملف لم يتغير بعد لحظة التسليم، وهي ضمانة غير متاحة في التسليم الورقي أو عبر تطبيقات المراسلة."));
    // ٨ التصحيح
    body.push(H1("8. التصحيح والتغذية الراجعة"),
      ...TBL("مؤشرات التصحيح ورصد الدرجات", ["المؤشر", "القيمة"], [["الدرجات المرصودة", num(G.graded, 0)], ["منها في تكليفات تسليم إلكتروني / رصد يدوي", num(G.graded_submit, 0) + " / " + num(G.graded_manual, 0)],
        ["أعضاء الفريق الذين رصدوا درجات", num(G.graders, 0)], ["وسيط زمن رصد الدرجة الواحدة داخل المنصة (ثانية)", num(G.sec_per_grade.p50) + " (الربيعان: " + num(G.sec_per_grade.p25) + " – " + num(G.sec_per_grade.p75) + "؛ ن = " + num(G.sec_per_grade.n, 0) + ")"],
        ["درجات أُدخلت دفعة واحدة من كشف إكسل", num(G.bulk_rows, 0) + " في " + num(G.bulk, 0) + " دفعة"], ["وسيط الزمن من الموعد حتى الرصد (يوم)", num(days(G.turnaround_h.p50))],
        ["درجات مصحوبة بملاحظة مكتوبة للطالب", num(G.with_feedback, 0)]]),
      ...(k.gMan ? [P("وبمقارنة الوسيط السابق بزمن تقديري للرصد اليدوي قدره " + num(k.gMan) + " ثانية للدرجة (تدوين في كشف ورقي ثم نقل إلى ملف الكنترول؛ المصدر: " + k.gSrc + ")، يكون الفرق نحو " + num(k.gradeSaveSec) + " ثانية للدرجة الواحدة، أي نحو " + num(k.gradeSaveSec * G.graded / 3600) + " ساعة عمل لكل الدرجات المرصودة في الفترة، مع التحفظ على أن الزمن اليدوي تقدير يحتاج إلى قياس منهجي.", { ind: true })] : []));
    // ٩ التظلمات
    body.push(H1("9. التظلمات"),
      ...TBL("التظلمات حسب السبب والقرار", ["السبب", "القرار", "العدد"], Object.entries(AP.by || {}).sort((a, b) => b[1] - a[1]).map(([kk, n]) => { const [r, s] = kk.split("/"); return [AP_R[r] || r, AP_S[s] || s, num(n, 0)]; }),
        "إجمالي التظلمات " + num(AP.total, 0) + " (" + num(k.apPer100) + " لكل 100 درجة)، ووسيط زمن الحسم " + num(AP.decide_p50_h) + " ساعة."),
      P("تتيح المنصة للطالب إرفاق صورة عمله بالتظلم، وتقارن بصمتها ببصمة الملف المسلَّم في الموعد، فيرى المحاضر ما إذا كان الطالب يقدّم العمل نفسه أم عملًا مختلفًا، وهو ما يدعم عدالة الحسم وسرعته.", { ind: true }));
    // ١٠ عبء العمل
    const wd = L.weekday || {}, wdT = sum(wd), abr = L.audit_by_role || {};
    body.push(H1("10. توزيع عبء العمل وتوقيته"),
      ...TBL("توزيع إجراءات الفريق على أيام الأسبوع", ["اليوم", "الإجراءات", "النسبة"], [6, 0, 1, 2, 3, 4, 5].map(i => [WD[i], num(wd[i] || 0, 0), pct(wd[i] || 0, wdT)])),
      ...TBL("التعديلات المسجّلة في سجل المقررات حسب الدور", ["الدور", "عدد التعديلات"], Object.entries(abr).sort((a, b) => b[1] - a[1]).map(([r, n]) => [ROLE[r] || r, num(n, 0)])),
      P("وقع " + (k.afterShare != null ? num(k.afterShare * 100) + "%" : "—") + " من إجراءات الفريق خارج ساعات الدوام (قبل الثامنة صباحًا أو بعد الرابعة عصرًا أو يوم الجمعة)، وهو مؤشر على مرونة العمل عن بُعد، وقد يكون في الوقت نفسه مؤشرًا على عبء إضافي يستحق الدراسة.", { ind: true }));
    // ١١ الدعم
    const tk = SU.tickets || {};
    body.push(H1("11. الدعم والمساعدة"),
      P("استقبلت المنصة " + num(sum(tk), 0) + " رسالة (استفسار أو شكوى أو مقترح) عبر مركز المساعدة، وطُرح على المساعد الآلي " + num(SU.faq.asked, 0) + " سؤالًا وجد لـ" + num(SU.faq.answered, 0) + " منها إجابة جاهزة، وحُوّل " + num(SU.faq.escalated, 0) + " منها إلى الإدارة.", { ind: true }));
    let sn = 12;
    // استطلاع الرأي
    const sa = k.sa;
    if (sa) {
      const G2 = [["student", "الطلبة"], ["staff", "أعضاء الفريق"]].filter(([g]) => sa.g[g]);
      body.push(H1((sn++) + ". نتائج استطلاع الرأي"),
        P("طُبّق استطلاع إلكتروني داخل المنصة على " + AUD[sa.meta ? sa.meta.audience : "all"] + " بدءًا من " + (sa.meta ? dstr(sa.meta.created_at) : "—") + "، يظهر للمستخدم عند فتح المنصة" + (sa.meta && sa.meta.allow_decline ? " مع إتاحة الاعتذار عن المشاركة" : "") + "، وتضمّن مقياس قابلية استخدام النظام (SUS) المكوّن من عشر عبارات (Brooke, 1996) بترجمة عربية، ومحاور مقتبسة من نموذج قبول التقنية (Davis, 1989): الفائدة المدركة، والثقة والمصداقية، والرضا ونية الاستمرار، وعبء العمل للفريق؛ على مقياس ليكرت خماسي (1 = لا أوافق بشدة، 5 = أوافق بشدة).", { ind: true }),
        ...TBL("المستجيبون لاستطلاع الرأي", ["الفئة", "أجابوا", "وسيط زمن الإجابة (ثانية)"], [...G2.map(([g, l]) => [l, num(sa.g[g].n, 0), num(sa.g[g].secs, 0)]), ["اعتذروا عن المشاركة", num(sa.declined, 0), "—"]],
          sa.meta ? "نسبة الاستجابة: الطلبة " + pct(sa.g.student ? sa.g.student.n : 0, sa.meta.students) + " من " + num(sa.meta.students, 0) + " طالب مسجّل، والفريق " + pct(sa.g.staff ? sa.g.staff.n : 0, sa.meta.staff) + " من " + num(sa.meta.staff, 0) + " عضو مفعّل." : ""),
        ...TBL("درجة قابلية الاستخدام (SUS) من 100", ["الفئة", "ن", "المتوسط", "الانحراف المعياري", "فترة الثقة 95%", "الوسيط", "معامل ألفا", "التقدير"], G2.map(([g, l]) => { const x = sa.g[g].sus;
          return [l, num(x.n, 0), num(x.m), num(x.sd), x.ci != null ? num(x.m - x.ci) + " – " + num(x.m + x.ci) : "—", num(x.med), num(x.a, 2), band(x.m)]; }),
          "التقدير وفق تصنيف Bangor وآخرين (2009): أعلى من 80.3 ممتاز، 68–80.3 جيد، 51–68 مقبول، أقل من 51 ضعيف؛ والمتوسط المرجعي العالمي للمقياس 68."),
        ...[].concat(...G2.map(([g, l]) => TBL("محاور نموذج قبول التقنية: " + l, ["المحور", "ن", "المتوسط (من 5)", "الانحراف المعياري", "معامل ألفا كرونباخ"], sa.g[g].cons.map(c => [c.t, num(c.n, 0), num(c.m, 2), num(c.sd, 2), num(c.a, 2)])))),
        ...[].concat(...G2.map(([g, l]) => TBL("عبارات المحاور تفصيليًا: " + l, ["العبارة", "المتوسط", "الانحراف المعياري", "نسبة الموافقة (4–5)"], [].concat(...sa.g[g].cons.map(c => c.items.map(it => [it.t, num(it.m, 2), num(it.sd, 2), it.agree != null ? num(it.agree * 100) + "%" : "—"])))))),
        P("ويُستدل بمعامل ألفا كرونباخ على الاتساق الداخلي لكل محور، وتُعد القيم من 0.70 فأكثر مقبولة عادةً، مع مراعاة أن المحاور القصيرة (عبارتان أو ثلاث) تميل إلى قيم أقل.", { ind: true }));
      if (sa.g.staff && (sa.g.staff.ex.man_sec || {}).n) body.push(P("وقدّر " + sa.g.staff.ex.man_sec.n + " من أعضاء الفريق متوسط زمن نداء الطالب الواحد يدويًا بوسيط " + num(sa.g.staff.ex.man_sec.med) + " ثانية" + ((sa.g.staff.ex.man_grade || {}).n ? "، وزمن رصد الدرجة الواحدة يدويًا ونقلها بوسيط " + num(sa.g.staff.ex.man_grade.med) + " ثانية" : "") + ".", { ind: true }));
    }
    // صدق التطابق
    const V = X.val || [];
    if (V.length) { const t = V.reduce((a, v) => [a[0] + v.a, a[1] + v.b, a[2] + v.c, a[3] + v.d], [0, 0, 0, 0]), n = t[0] + t[1] + t[2] + t[3];
      body.push(H1((sn++) + ". صدق التطابق بين المنصة والكشف الورقي"),
        P("سُجّل الحضور في " + V.length + " محاضرة بالمنصة وبكشف ورقي في الوقت نفسه، وقورنت الحالتان لكل طالب في كشف المحاضرة، وحُسبت نسبة الاتفاق ومعامل كابا لكوهين (Cohen, 1960) الذي يصحّح الاتفاق المتوقع بالصدفة.", { ind: true }),
        ...TBL("الاتفاق بين المنصة والكشف الورقي (مجمّع)", ["", "حاضر ورقيًا", "غائب ورقيًا"], [["حاضر في المنصة", num(t[0], 0), num(t[1], 0)], ["غائب في المنصة", num(t[2], 0), num(t[3], 0)]],
          "نسبة الاتفاق " + pct(t[0] + t[3], n) + "، ومعامل كابا المجمّع " + num(kappa(...t), 3) + " (ن = " + n + " حالة)."),
        ...TBL("معامل كابا لكل محاضرة", ["المحاضرة", "التاريخ", "الحالات", "الاتفاق", "كابا"], V.map((v, i) => [String(i + 1), dstr(v.at), num(v.a + v.b + v.c + v.d, 0), pct(v.a + v.d, v.a + v.b + v.c + v.d), num(v.k, 3)]),
          "تفسير كابا وفق Landis و Koch (1977): 0.81–1.00 شبه تام، 0.61–0.80 قوي، 0.41–0.60 متوسط."));
    }
    // حدود ومهددات
    body.push(H1((sn++) + ". حدود البيانات ومهددات الصدق، ومقترح لاستكمال المقارنة"),
      BL("المؤشرات وصفية مستمدة من سجلات الاستخدام، ولا تقيس التعلم أو جودة التصميم، ولا تثبت علاقة سببية."),
      BL("أثر الجِدّة: قد يختلف سلوك المستخدمين في الفصل الأول من استخدام المنصة عن الاستخدام المستقر."),
      BL("المقارنة بالطرق اليدوية في هذا التقرير تقديرية ما لم تُقَس الطرق اليدوية قياسًا مباشرًا."),
      BL("الجلسات المستوردة والمقررات تختلف في خصائصها، فلا تصلح المقارنة بينها لاستنتاج أثر المنصة."),
      BL("بعض الأزمنة (مثل زمن رصد الدرجة) مقياس تقريبي للجهد؛ إذ قد يتخلل الفاصل بين درجتين نشاطٌ آخر."),
      P("ولتحويل هذه المؤشرات إلى أدلة مقارنة قوية، يُقترح ما يلي:", { ind: true, keep: true }),
      BL("قياس الزمن والحركة (Time-and-Motion): ملاحظة عدد من المحاضرات بالنداء اليدوي وأخرى بالمنصة، وقياس زمن تسجيل الحضور وزمن انقطاع الشرح بساعة إيقاف، وتحليل الفرق باختبار مان-ويتني."),
      BL("صدق التطابق: اختيار عينة من المحاضرات يُسجَّل فيها الحضور بالمنصة وبكشف ورقي في الوقت نفسه، وحساب معامل الاتفاق كابا لكوهين بين الطريقتين."),
      BL("قابلية الاستخدام: تطبيق مقياس قابلية استخدام النظام (SUS) على الطلبة والفريق، ونموذج قبول التقنية (TAM) أو النظرية الموحدة لقبول التقنية واستخدامها (UTAUT) لقياس الفائدة المدركة وسهولة الاستخدام."),
      BL("المقابلات شبه المقننة مع عينة من المحاضرين والمعيدين لتفسير الأنماط الكمية."));
    // ملاحق
    const REFS = ["Bangor, A., Kortum, P., & Miller, J. (2009). Determining what individual SUS scores mean: Adding an adjective rating scale. Journal of Usability Studies, 4(3), 114–123.",
      "Brooke, J. (1996). SUS: A \"quick and dirty\" usability scale. In P. W. Jordan, B. Thomas, B. A. Weerdmeester, & I. L. McClelland (Eds.), Usability evaluation in industry (pp. 189–194). Taylor & Francis.",
      "Cohen, J. (1960). A coefficient of agreement for nominal scales. Educational and Psychological Measurement, 20(1), 37–46.",
      "Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. MIS Quarterly, 13(3), 319–340.",
      "Landis, J. R., & Koch, G. G. (1977). The measurement of observer agreement for categorical data. Biometrics, 33(1), 159–174.",
      "Venkatesh, V., Morris, M. G., Davis, G. B., & Davis, F. D. (2003). User acceptance of information technology: Toward a unified view. MIS Quarterly, 27(3), 425–478."];
    body.push(H1("المراجع"), ...REFS.map(r => new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 100, line: 300 }, indent: { left: 400, hanging: 400 }, children: [new TextRun({ text: r, font: "Times New Roman", size: 22 })] })));
    body.push(new Paragraph({ children: [new PageBreak()] }), H1("ملحق (أ): تعريف المؤشرات وطريقة حسابها"),
      ...TBL("قاموس المؤشرات", ["المؤشر", "القيمة", "الوحدة", "طريقة الحساب"], indicators(d, k).map(x => [x[0], x[1] == null ? "—" : typeof x[1] === "number" ? num(x[1], 2) : String(x[1]), x[2], x[3]])),
      H1("ملحق (ب): بيانات التوثيق"), ...TBL("بيانات التوثيق", ["البند", "القيمة"], docMeta(d)),
      P("صيغة مقترحة للإشارة إلى المنصة في المراجع:", { b: true, keep: true }),
      P("راشد، أحمد محمد. (" + new Date().getFullYear() + "). Hadro: " + CM.APP.title + " [منصة إلكترونية]. " + CM.APP.org + ". https://elrashdan.github.io/classmate/", { ind: false }));
    const doc = new Document({ creator: "Hadro", title: "تقرير إحصائي لمنصة Hadro", description: "مؤشرات استخدام مجمّعة ومجهّلة", styles: { default: { document: { run: { font: FONT, size: 26, rightToLeft: true } } } },
      sections: [{ properties: { page: { margin: { top: 1300, bottom: 1300, left: 1300, right: 1500 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("Hadro · تقرير إحصائي · صفحة ", { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
        children: body }] });
    const blob = await Packer.toBlob(doc), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "Hadro - تقرير البحث " + o.from + " - " + o.to + ".docx"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    msg("نزل التقرير.");
  }
})();
