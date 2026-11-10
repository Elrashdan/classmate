/* Hadro · الجدول الدراسي وتوزيع العمل (TT)
   محرر للمسؤول: أيام × فترات، الفرق والشعب ومجموعاتها، لكل مادة فريق كل مجموعة ومكانها، وتصدير إكسل وPDF بنفس شكل الجدول الرسمي.
   وعرض «جدولي» لعضو هيئة التدريس. */
(function () {
  const TT = window.TT = {};
  const DAY = { 6: "السبت", 0: "الأحد", 1: "الإثنين", 2: "الثلاثاء", 3: "الأربعاء", 4: "الخميس", 5: "الجمعة" };
  const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
  const PN = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة"];
  const LV = n => ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"][n] || n;
  const TERMS = { 1: "الفصل الدراسي الأول", 2: "الفصل الدراسي الثاني", 3: "الفصل الصيفي" };
  const ar = s => String(s).replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
  const t12 = hm => { if (!hm) return ""; let [h, m] = hm.split(":").map(Number); const pm = h >= 12; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}`; };
  const rng = (a, b) => `\u2066${t12(a)}–${t12(b)}\u2069`; // عزل اتجاه الوقت حتى لا ينقلب داخل النص العربي
  const pTime = (tt, a, b) => { const P = tt.periods; return rng((P[a - 1] || {}).from, (P[(b || a) - 1] || {}).to); };
  TT.rng = rng;
  TT.DAY = DAY; TT.t12 = t12; TT.pTime = pTime;
  const cohortName = c => `المستوى ${LV(c.level)}${c.track ? " · " + c.track : ""}`;
  TT.cohortName = cohortName;
  const gName = g => /^\d+$/.test(g) ? ar(g) : g;
  const staffKey = s => s.e ? "e:" + s.e : "n:" + CM.normAr(s.n);
  const slotGroups = (s, c) => s.groups && s.groups.length ? s.groups : c.groups;
  // تسمية قصيرة لعضو هيئة التدريس كما في الجدول الورقي: د.سليمان ، م.م.خالد
  TT.shortName = (st, all) => {
    const t = String(st.title || ""), pre = /مدرس مساعد/.test(t) ? "م.م." : /معيد/.test(t) || st.role === "ta" ? "م." : "د.";
    const w = String(st.name || "").trim().split(/\s+/);
    const clash = (all || []).some(o => o.email !== st.email && String(o.name || "").trim().split(/\s+/)[0] === w[0]);
    return pre + (clash && w[1] ? w[0] + " " + w[1] : w[0]);
  };

  /* ---------------- الحالة ---------------- */
  let X = null; // { ctx, list, cur:{tt,cohorts,slots}, mode, day, who, edit, busy, msg }
  TT.open = async ctx => {
    X = { ctx, list: [], cur: null, mode: matchMedia("(max-width:900px)").matches ? "day" : "week", day: null, who: "", edit: null, cohortEdit: null, setOpen: false, newOpen: false, msg: "" };
    await loadList(); if (X.list.length) await loadTT(X.list[0].id); draw();
  };
  const rpc = (f, a) => X.ctx.rpc(f, a);
  const esc = s => CM.esc(s);
  async function loadList() { X.list = await rpc("tt_list") || []; }
  async function loadTT(id) {
    const r = await rpc("tt_get", { tid: id }); if (!r) return;
    X.cur = { tt: r.tt, cohorts: r.cohorts || [], slots: r.slots || [] };
    if (X.day == null || !X.cur.tt.days.includes(X.day)) { const today = new Date().getDay(); X.day = X.cur.tt.days.includes(today) ? today : X.cur.tt.days[0]; }
  }
  const say = (m, bad) => { X.msg = (bad ? "!" : "") + m; draw(); };
  const fail = e => { const m = String((e && e.message) || ""); const ov = /slot_overlap:(.*)/.exec(m); say(ov ? `في نفس الوقت عند نفس المجموعات مادة «${ov[1].split(" :: ")[0]}». غيّر الفترة أو المجموعات.` : CM.errText(e), true); };

  /* ---------------- التعارضات ---------------- */
  function conflicts() {
    const out = {}; if (!X.cur) return out; const S = X.cur.slots;
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j]; if (a.day !== b.day || a.p_from > b.p_to || b.p_from > a.p_to) continue;
      const ka = new Set(a.team.flatMap(t => t.staff.map(staffKey))), shared = b.team.flatMap(t => t.staff).filter(s => ka.has(staffKey(s)));
      const rooms = r => new Set([r.room, ...r.team.map(t => t.room)].flatMap(x => String(x || "").split("/")).map(x => x.trim().replace(/^ا(تيلي)/, "أ$1").replace(/ة(\s|$)/g, "ه$1")).filter(x => x && !/خارج|برجولا|[اأ]ونلاين|online/i.test(x)));
      const ra = rooms(a), sharedR = [...rooms(b)].filter(x => ra.has(x));
      const msg = [...new Set(shared.map(s => s.n))].map(n => `${n} في «${a.title}» و«${b.title}»`).concat(sharedR.map(r => `${r} محجوز لـ«${a.title}» و«${b.title}»`));
      if (msg.length) { (out[a.id] = out[a.id] || []).push(...msg); (out[b.id] = out[b.id] || []).push(...msg); }
    }
    return out;
  }

  /* ---------------- الرسم ---------------- */
  function draw() {
    const el = X.ctx.el, C = X.cur, admin = X.ctx.isAdmin;
    const msg = X.msg ? `<div class="msg ${X.msg[0] === "!" ? "bad" : "ok"}">${esc(X.msg.replace(/^!/, ""))}</div>` : ""; X.msg = "";
    if (!C) {
      el.innerHTML = `<section class="panel"><div class="panel-h"><div><div class="eyebrow">الجدول الدراسي وتوزيع العمل</div><h2>لا يوجد جدول بعد</h2></div></div>${msg}
        ${admin ? newFormHtml() : `<div class="empty">لم ينشر مسؤول القسم جدولًا بعد.</div>`}</section>`;
      return wire();
    }
    const tt = C.tt, cf = conflicts(), nCf = Object.keys(cf).length;
    const people = peopleList();
    el.innerHTML = `<section class="panel tt-wrap">
      <div class="panel-h"><div><div class="eyebrow">${esc(tt.academic_year)} · ${TERMS[tt.term]} · ${C.slots.length} مادة في الجدول${tt.published ? ` · <span class="chip ok">منشور للطلبة</span>` : ` · <span class="chip warn">مسودة (الطلبة لا يرونه)</span>`}</div><h2>الجدول الدراسي وتوزيع العمل</h2></div>
        <div class="row">
          ${X.list.length > 1 ? `<select id="ttPick" aria-label="الجدول">${X.list.map(x => `<option value="${x.id}" ${x.id === tt.id ? "selected" : ""}>${esc(x.academic_year)} · ${TERMS[x.term]}</option>`).join("")}</select>` : ""}
          ${CM.dd("تصدير", [`<button class="dd-i" id="ttXls">إكسل (نفس شكل الجدول الرسمي)</button>`, `<button class="dd-i" id="ttPdf">PDF للطباعة</button>`, X.who ? `<button class="dd-i" id="ttXlsWho">جدول ${esc(X.who.split("|")[1])} فقط</button>` : ""], { end: true })}
          ${admin ? CM.dd("إعدادات", [`<button class="dd-i" id="ttSet">الفترات والأيام والأماكن والعنوان</button>`, `<button class="dd-i" id="ttAddC">إضافة فرقة / شعبة</button>`, `<hr><button class="dd-i" id="ttNew">جدول لفصل دراسي جديد</button>`, `<button class="dd-i danger" id="ttDel">حذف هذا الجدول</button>`], { end: true }) : ""}
          ${admin ? `<button class="btn sm ${tt.published ? "" : "primary"}" id="ttPub">${tt.published ? "إخفاء عن الطلبة" : "نشر للطلبة"}</button>` : ""}
        </div></div>
      ${msg}
      ${X.newOpen ? newFormHtml() : ""}
      ${X.setOpen ? settingsHtml() : ""}
      ${X.cohortEdit ? cohortFormHtml() : ""}
      <div class="tt-bar">
        <div class="tkseg" role="tablist">${[["day", "يوم بيوم"], ["week", "الأسبوع كله"], ["load", "توزيع العمل"]].map(([k, l]) => `<button class="${X.mode === k ? "on" : ""}" data-ttm="${k}">${l}</button>`).join("")}</div>
        ${X.mode === "day" ? `<div class="tt-days">${tt.days.map(d => `<button class="cchip" aria-pressed="${X.day === d}" data-ttd="${d}">${DAY[d]}</button>`).join("")}</div>` : ""}
        ${X.mode !== "load" ? `<label class="tt-who"><span class="small muted">إبراز:</span><select id="ttWho"><option value="">كل الفريق</option>${people.map(p => `<option value="${esc(p.k + "|" + p.n)}" ${X.who === p.k + "|" + p.n ? "selected" : ""}>${esc(p.n)} (${p.periods} فترة)</option>`).join("")}</select></label>` : ""}
      </div>
      ${nCf ? `<div class="msg warn small">⚠ في ${nCf} مادة فيها تعارض (نفس الشخص أو نفس المكان في نفس الوقت). المواد المتعارضة عليها إطار أحمر، ودوس عليها تشوف التفاصيل.</div>` : ""}
      ${!C.cohorts.length ? `<div class="empty">ابدأ بإضافة الفرق والشعب. ${admin ? `<button class="btn sm primary" id="ttAddC2">إضافة فرقة</button>` : ""}</div>`
        : X.mode === "day" ? dayGrid(cf) : X.mode === "week" ? weekGrid(cf) : loadHtml(people)}
      <p class="small muted tt-legend">${tt.periods.map((p, i) => `الفترة ${PN[i]}: ${rng(p.from, p.to)}`).join(" · ")}</p>
    </section>
    ${X.edit ? slotSheetHtml(cf) : ""}`;
    wire();
  }

  function peopleList() {
    const C = X.cur, m = new Map();
    C.slots.forEach(s => { const per = s.p_to - s.p_from + 1; const seen = new Set(); s.team.forEach(t => t.staff.forEach(p => { const k = staffKey(p); if (seen.has(k)) return; seen.add(k); const o = m.get(k) || { k, n: p.n, e: p.e, kind: p.k, periods: 0, slots: [] }; o.periods += per; o.slots.push(s); m.set(k, o); })); });
    return [...m.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "lec" ? -1 : 1) || b.periods - a.periods || a.n.localeCompare(b.n, "ar"));
  }
  const whoHas = s => { if (!X.who) return null; const k = X.who.split("|")[0]; return s.team.some(t => t.staff.some(p => staffKey(p) === k)); };

  function slotHtml(s, cf, compact) {
    const c = X.cur.cohorts.find(x => x.id === s.cohort_id) || { groups: [] }, gs = slotGroups(s, c);
    const same = s.team.length <= 1 && (!s.team[0] || !s.team[0].g);
    const hit = whoHas(s), rooms = [...new Set([s.room, ...s.team.map(t => t.room)].filter(Boolean))];
    const teamLines = same ? (s.team[0] ? [s.team[0].staff.map(p => p.n).join("، ")] : []) : s.team.filter(t => t.staff.length).map(t => `<b>${gName(t.g)}</b> ${t.staff.map(p => p.n).join("، ")}`);
    return `<button class="tt-s ${cf[s.id] ? "cf" : ""} ${hit === false ? "dim" : hit ? "hit" : ""}" data-tts="${s.id}" style="grid-column:${s.p_from} / span ${s.p_to - s.p_from + 1}">
      <b>${esc(s.title)}</b>
      <span class="tt-meta">${s.groups && s.groups.length ? `مج ${s.groups.map(gName).join("،")}` : `${gs.length} مجموعات`}${rooms.length ? ` · <i class="tt-room">${esc(rooms.join(" / "))}</i>` : ""}</span>
      ${compact ? "" : teamLines.length ? `<span class="tt-team">${teamLines.map(l => `<span>${l.replace(/^(?!<b>)/, "")}</span>`).join("")}</span>` : `<span class="tt-team muted">بدون فريق بعد</span>`}
    </button>`;
  }
  function dayCell(c, d, cf, compact) {
    const tt = X.cur.tt, P = tt.periods.length;
    if ((c.off_days || []).includes(d)) return `<div class="tt-off">إجازة</div>`;
    const ss = X.cur.slots.filter(s => s.cohort_id === c.id && s.day === d).sort((a, b) => a.p_from - b.p_from);
    return `<div class="tt-day" style="--P:${P}">
      ${X.ctx.isAdmin ? `<div class="tt-bg">${Array.from({ length: P }, (_, i) => `<button class="tt-add" data-tta="${c.id}|${d}|${i + 1}" aria-label="إضافة مادة ${DAY[d]} الفترة ${PN[i]}" title="إضافة مادة">+</button>`).join("")}</div>` : ""}
      <div class="tt-fg">${ss.map(s => slotHtml(s, cf, compact) + (X.ctx.isAdmin && s.groups && s.groups.length && c.groups.some(g => !s.groups.includes(g)) ? `<button class="tt-add2" data-tta="${c.id}|${d}|${s.p_from}|${s.p_to}|${c.groups.filter(g => !s.groups.includes(g) && !ss.some(o => o !== s && o.p_from <= s.p_to && o.p_to >= s.p_from && o.groups.includes(g))).join(",")}" style="grid-column:${s.p_from} / span ${s.p_to - s.p_from + 1}">+ مادة لباقي المجموعات</button>` : "")).join("")}</div></div>`;
  }
  const cohortTh = c => `<th class="tt-c" scope="row"><button class="tt-cb" data-ttc="${c.id}" ${X.ctx.isAdmin ? "" : "disabled"}><b>${esc(cohortName(c))}</b><small>${c.students ? `${ar(c.students)} طالب · ` : ""}${c.groups.length} مجموعات</small>${(c.off_days || []).length ? `<small>إجازة: ${c.off_days.map(d => DAY[d]).join("، ")}</small>` : ""}</button></th>`;
  function dayGrid(cf) {
    const tt = X.cur.tt, d = X.day;
    return `<div class="tt-scroll"><table class="ttg day"><thead><tr><th class="tt-c">${DAY[d]}</th><th><div class="tt-ph" style="--P:${tt.periods.length}">${tt.periods.map((p, i) => `<span><b>${PN[i]}</b><small>${rng(p.from, p.to)}</small></span>`).join("")}</div></th></tr></thead>
      <tbody>${X.cur.cohorts.map(c => `<tr>${cohortTh(c)}<td>${dayCell(c, d, cf, false)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function weekGrid(cf) {
    const tt = X.cur.tt;
    return `<div class="tt-scroll"><table class="ttg week"><thead><tr><th class="tt-c">الفرقة</th>${tt.days.map(d => `<th>${DAY[d]}<div class="tt-ph" style="--P:${tt.periods.length}">${tt.periods.map((p, i) => `<span>${ar(i + 1)}</span>`).join("")}</div></th>`).join("")}</tr></thead>
      <tbody>${X.cur.cohorts.map(c => `<tr>${cohortTh(c)}${tt.days.map(d => `<td>${dayCell(c, d, cf, true)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function loadHtml(people) {
    if (!people.length) return `<div class="empty">لسه مفيش فريق متوزّع على المواد.</div>`;
    const tt = X.cur.tt;
    return `<div class="tbl-wrap"><table class="tt-load"><thead><tr><th>الاسم</th><th class="c">فترات في الأسبوع</th>${tt.days.map(d => `<th>${DAY[d]}</th>`).join("")}</tr></thead><tbody>
      ${people.map(p => `<tr><td><b>${esc(p.n)}</b>${p.e ? "" : ` <span class="chip none small" title="مش مربوط بحساب في Hadro">خارجي</span>`}</td><td class="c"><b>${ar(p.periods)}</b></td>${tt.days.map(d => { const ss = p.slots.filter(s => s.day === d).sort((a, b) => a.p_from - b.p_from); return `<td class="small">${ss.map(s => `<div>${esc(s.title)} <span class="muted">(${pTime(tt, s.p_from, s.p_to)})</span></div>`).join("") || `<span class="muted">—</span>`}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>`;
  }

  /* ---------------- النماذج ---------------- */
  function newFormHtml() {
    const y = new Date().getFullYear(), m = new Date().getMonth() + 1, start = m >= 8 ? y : y - 1;
    const years = [start + 1, start, start - 1].map(a => `${a}/${a + 1}`);
    return `<div class="tt-form"><b>جدول لفصل دراسي جديد</b>
      <div class="split-f">
        <label class="f"><span>العام الجامعي</span><select id="tnY">${years.map(a => `<option ${a === `${start}/${start + 1}` ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label class="f"><span>الفصل</span><select id="tnT"><option value="1">الأول</option><option value="2" ${m >= 2 && m < 7 ? "selected" : ""}>الثاني</option><option value="3">الصيفي</option></select></label>
        ${X.list.length ? `<label class="f"><span>ابدأ من</span><select id="tnC"><option value="">الفرق من مواد الفصل (فاضي)</option>${X.list.map(x => `<option value="${x.id}">نسخة من ${esc(x.academic_year)} · ${TERMS[x.term]}</option>`).join("")}</select></label>` : ""}
      </div>
      <p class="small muted">الفرق والشعب وعدد الطلبة ومجموعاتهم بتتعمل لوحدها من مواد الفصل المسجّلة في Hadro، وتقدر تعدّلها.</p>
      <div class="row"><button class="btn primary" id="tnGo">إنشاء الجدول</button>${X.cur ? `<button class="btn ghost" id="tnX">إلغاء</button>` : ""}</div></div>`;
  }
  function settingsHtml() {
    const tt = X.cur.tt;
    return `<div class="tt-form"><b>إعدادات الجدول</b>
      <label class="f"><span>عنوان الجدول</span><input id="tsTitle" value="${esc(tt.title)}"></label>
      <div class="f"><span>أيام الدراسة</span><div class="cchips">${DAY_ORDER.map(d => `<button type="button" class="cchip" aria-pressed="${tt.days.includes(d)}" data-tsd="${d}">${DAY[d]}</button>`).join("")}</div></div>
      <div class="f"><span>الفترات</span><div class="tt-pers">${tt.periods.map((p, i) => `<div class="tt-per"><b>${PN[i]}</b><input type="time" data-tsf="${i}" value="${esc(p.from)}" aria-label="بداية الفترة ${PN[i]}"><span>إلى</span><input type="time" data-tst="${i}" value="${esc(p.to)}" aria-label="نهاية الفترة ${PN[i]}"></div>`).join("")}</div>
        <div class="row"><button type="button" class="btn sm ghost" id="tsPAdd" ${tt.periods.length >= 8 ? "disabled" : ""}>+ فترة</button><button type="button" class="btn sm ghost" id="tsPDel" ${tt.periods.length <= 1 ? "disabled" : ""}>− آخر فترة</button></div></div>
      <label class="f"><span>الأماكن (اتيليهات وقاعات)، كل مكان في سطر</span><textarea id="tsRooms" rows="4">${esc(tt.rooms.join("\n"))}</textarea></label>
      <label class="f"><span>التوقيع أسفل الجدول</span><input id="tsSign" value="${esc(tt.signer)}"></label>
      <div class="row"><button class="btn primary" id="tsGo">حفظ</button><button class="btn ghost" id="tsX">إلغاء</button></div></div>`;
  }
  function cohortFormHtml() {
    const c = X.cohortEdit;
    return `<div class="tt-form"><b>${c.id ? "تعديل " + esc(cohortName(c)) : "فرقة / شعبة جديدة"}</b>
      <div class="split-f">
        <label class="f"><span>المستوى</span><select id="tcL">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${c.level === n ? "selected" : ""}>المستوى ${LV(n)}</option>`).join("")}</select></label>
        <label class="f"><span>الشعبة (اختياري)</span><input id="tcT" value="${esc(c.track || "")}" placeholder="مثلًا: عمارة داخلية، سينوجرافيا"></label>
        <label class="f"><span>عدد الطلبة</span><input id="tcN" type="number" min="0" value="${c.students || ""}"></label>
        <label class="f"><span>عدد المجموعات</span><input id="tcG" type="number" min="1" max="20" value="${c.groups.length}"></label>
      </div>
      <label class="f"><span>أسماء المجموعات (افصل بفاصلة)</span><input id="tcGN" value="${esc(c.groups.join("، "))}"></label>
      <div class="f"><span>أيام إجازة الفرقة</span><div class="cchips">${X.cur.tt.days.map(d => `<button type="button" class="cchip" aria-pressed="${(c.off_days || []).includes(d)}" data-tco="${d}">${DAY[d]}</button>`).join("")}</div></div>
      <div class="row"><button class="btn primary" id="tcGo">حفظ</button><button class="btn ghost" id="tcX">إلغاء</button>${c.id ? `<button class="btn ghost danger-t" id="tcDel">حذف الفرقة وموادها</button>` : ""}</div></div>`;
  }

  // نافذة المادة: اليوم والفترات والمادة والمجموعات وفريق كل مجموعة ومكانها
  function slotSheetHtml(cf) {
    const e = X.edit, tt = X.cur.tt, c = X.cur.cohorts.find(x => x.id === e.cohort_id) || X.cur.cohorts[0];
    const gs = e.groups.length ? e.groups : c.groups;
    const crs = X.ctx.courses.filter(x => !x.archived && x.academic_year === tt.academic_year && x.term === tt.term && x.level === c.level && (!c.track || !x.track || x.track === c.track));
    const roomOpts = (sel, grp) => `<option value="">${grp ? "نفس مكان المادة" : "—"}</option>${tt.rooms.map(r => `<option ${r === sel ? "selected" : ""}>${esc(r)}</option>`).join("")}`;
    const rows = e.same ? [e.team[0] || { g: "", staff: [], room: "" }] : gs.map(g => e.team.find(t => t.g === g) || { g, staff: [], room: "" });
    const issues = e.id ? (cf[e.id] || []) : [];
    return `<div class="hc tt-sheet" id="ttSheet" role="dialog" aria-modal="true" aria-label="مادة في الجدول"><div class="hc-c">
      <div class="hc-h"><b>${e.id ? "تعديل مادة" : "مادة جديدة"} · ${esc(cohortName(c))}</b><button class="btn sm ghost icon" id="tseX" aria-label="إغلاق">✕</button></div>
      <div class="hc-b tt-ed">
        ${issues.length ? `<div class="msg warn small">⚠ تعارض: ${issues.map(esc).join(" · ")}</div>` : ""}
        <label class="f"><span>المادة</span><select id="tseC"><option value="">— مادة غير مسجلة في Hadro (اكتب اسمها) —</option>${crs.map(x => `<option value="${x.id}" ${e.course_id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        ${!e.course_id ? `<label class="f"><span>اسم المادة</span><input id="tseT" value="${esc(e.title)}" placeholder="مثلًا: تصميم ٣"></label>` : `<p class="small muted">المادة مربوطة بـ Hadro، فهتظهر في جدول كل طالب مسجّل فيها بفريق مجموعته ومكانها.</p>`}
        <div class="f"><span>اليوم</span><div class="cchips">${tt.days.map(d => `<button type="button" class="cchip" aria-pressed="${e.day === d}" data-sed="${d}" ${(c.off_days || []).includes(d) ? "disabled title='إجازة الفرقة'" : ""}>${DAY[d]}</button>`).join("")}</div></div>
        <div class="split-f">
          <label class="f"><span>من الفترة</span><select id="tseA">${tt.periods.map((p, i) => `<option value="${i + 1}" ${e.p_from === i + 1 ? "selected" : ""}>${PN[i]} (${t12(p.from)})</option>`).join("")}</select></label>
          <label class="f"><span>إلى الفترة</span><select id="tseB">${tt.periods.map((p, i) => `<option value="${i + 1}" ${e.p_to === i + 1 ? "selected" : ""} ${i + 1 < e.p_from ? "disabled" : ""}>${PN[i]} (${t12(p.to)})</option>`).join("")}</select></label>
          <label class="f"><span>المكان</span><select id="tseR">${roomOpts(e.room).replace(">—<", ">اختر المكان<")}${e.room && !tt.rooms.includes(e.room) ? `<option selected>${esc(e.room)}</option>` : ""}</select></label>
        </div>
        <p class="small muted">الوقت: ${DAY[e.day]} من ${pTime(tt, e.p_from, e.p_to)}</p>
        <div class="f"><span>المجموعات</span><div class="cchips"><button type="button" class="cchip" aria-pressed="${!e.groups.length}" data-seg="*">كل المجموعات</button>${c.groups.map(g => `<button type="button" class="cchip" aria-pressed="${e.groups.includes(g)}" data-seg="${esc(g)}">${esc(gName(g))}</button>`).join("")}</div></div>
        <div class="tt-teamh"><b>الفريق</b><label class="small"><input type="checkbox" id="tseSame" ${e.same ? "checked" : ""}> نفس الفريق لكل المجموعات</label></div>
        <datalist id="ttStaffDL">${X.ctx.staff.filter(s => s.status !== "suspended").map(s => `<option value="${esc(TT.shortName(s, X.ctx.staff))}">${esc(s.name)}</option>`).join("")}</datalist>
        <div class="tt-team-ed">${rows.map((t, i) => `<div class="tt-grow">
          <div class="tt-gh">${e.same ? "كل المجموعات" : `مجموعة ${esc(gName(t.g))}`}${!e.same ? `<select data-ser="${esc(t.g)}" aria-label="مكان المجموعة">${roomOpts(t.room, true)}</select>` : ""}</div>
          <div class="tt-chips">${t.staff.map((p, j) => `<span class="tt-p ${p.k}">${esc(p.n)}${p.e ? "" : ` <i title="مش مربوط بحساب">•</i>`}<button type="button" data-sex="${esc(t.g)}|${j}" aria-label="إزالة ${esc(p.n)}">✕</button></span>`).join("")}
            <span class="tt-addp"><input list="ttStaffDL" data-sea="${esc(t.g)}" placeholder="+ اسم (د. أو م.)" aria-label="إضافة عضو للفريق"></span></div>
          ${!e.same && i === 0 && rows.length > 1 ? `<button type="button" class="linkish small" id="tseCopy">انسخ فريق ومكان المجموعة دي لكل المجموعات</button>` : ""}
        </div>`).join("")}</div>
        <label class="f"><span>ملاحظة (اختياري)</span><input id="tseN" value="${esc(e.note || "")}" maxlength="200"></label>
        <div class="row"><button class="btn primary" id="tseGo" ${X.busy ? "disabled" : ""}>${X.busy ? "جارٍ الحفظ…" : "حفظ"}</button>${e.id ? `<button class="btn ghost danger-t" id="tseDel">حذف من الجدول</button>` : ""}</div>
      </div></div></div>`;
  }

  /* ---------------- الربط ---------------- */
  function wire() {
    const el = X.ctx.el, $ = s => el.querySelector(s) || document.querySelector(s), on = (s, f) => { const b = $(s); if (b) b.onclick = f; };
    const pk = $("#ttPick"); if (pk) pk.onchange = async () => { await loadTT(pk.value); draw(); };
    el.querySelectorAll("[data-ttm]").forEach(b => b.onclick = () => { X.mode = b.dataset.ttm; draw(); });
    el.querySelectorAll("[data-ttd]").forEach(b => b.onclick = () => { X.day = +b.dataset.ttd; draw(); });
    const wh = $("#ttWho"); if (wh) wh.onchange = () => { X.who = wh.value; draw(); };
    on("#ttPub", () => act(() => rpc("tt_update", { tid: X.cur.tt.id, p: { published: !X.cur.tt.published } }), X.cur.tt.published ? "اتخفى الجدول عن الطلبة." : "اتنشر الجدول: كل طالب هيشوف مواده المسجّلة بفريق مجموعته ومكانها."));
    on("#ttSet", () => { X.setOpen = true; X.newOpen = false; X.cohortEdit = null; draw(); });
    on("#ttNew", () => { X.newOpen = true; X.setOpen = false; draw(); });
    on("#ttDel", () => { if (!confirm("حذف الجدول ده نهائيًا بكل مواده؟")) return; act(() => rpc("tt_delete", { tid: X.cur.tt.id }), "اتحذف الجدول.", true); });
    const addC = () => { X.cohortEdit = { level: 1, track: "", students: null, groups: ["1", "2", "3", "4"], off_days: [] }; X.setOpen = false; draw(); };
    on("#ttAddC", addC); on("#ttAddC2", addC);
    on("#ttXls", () => exportTT(false)); on("#ttPdf", () => exportTT(true)); on("#ttXlsWho", () => exportWho());
    // جدول جديد
    on("#tnX", () => { X.newOpen = false; draw(); });
    on("#tnGo", async () => { try { const id = await rpc("tt_create", { p_year: $("#tnY").value, p_term: +$("#tnT").value, p_copy: ($("#tnC") || {}).value || null }); X.newOpen = false; await loadList(); await loadTT(id); say("اتعمل الجدول. دوس على «+» في أي فترة عشان تضيف مادة."); } catch (e) { fail(e); } });
    // الإعدادات
    if (X.setOpen) {
      const tt = X.cur.tt, tmp = X.tmpSet || (X.tmpSet = { days: [...tt.days], periods: tt.periods.map(p => ({ ...p })) });
      el.querySelectorAll("[data-tsd]").forEach(b => b.onclick = () => { const d = +b.dataset.tsd; tmp.days = tmp.days.includes(d) ? tmp.days.filter(x => x !== d) : DAY_ORDER.filter(x => x === d || tmp.days.includes(x)); b.setAttribute("aria-pressed", tmp.days.includes(d)); });
      const readP = () => tmp.periods.forEach((p, i) => { const f = el.querySelector(`[data-tsf="${i}"]`), t = el.querySelector(`[data-tst="${i}"]`); if (f) p.from = f.value; if (t) p.to = t.value; });
      on("#tsPAdd", () => { readP(); const l = tmp.periods[tmp.periods.length - 1]; tmp.periods.push({ n: tmp.periods.length + 1, from: l ? l.to : "09:00", to: l ? l.to : "10:30" }); X.cur.tt = { ...X.cur.tt, periods: tmp.periods, days: tmp.days }; draw(); });
      on("#tsPDel", () => { readP(); tmp.periods.pop(); X.cur.tt = { ...X.cur.tt, periods: tmp.periods, days: tmp.days }; draw(); });
      on("#tsX", async () => { X.setOpen = false; X.tmpSet = null; await loadTT(X.cur.tt.id); draw(); });
      on("#tsGo", () => { readP(); const p = { title: $("#tsTitle").value, signer: $("#tsSign").value, days: tmp.days, periods: tmp.periods.map((x, i) => ({ n: i + 1, from: x.from, to: x.to })), rooms: $("#tsRooms").value.split(/\n|،|,/).map(s => s.trim()).filter(Boolean) };
        X.setOpen = false; X.tmpSet = null; act(() => rpc("tt_update", { tid: X.cur.tt.id, p }), "اتحفظت الإعدادات."); });
    }
    // الفرقة
    el.querySelectorAll("[data-ttc]").forEach(b => b.onclick = () => { const c = X.cur.cohorts.find(x => x.id === b.dataset.ttc); X.cohortEdit = { ...c, groups: [...c.groups], off_days: [...(c.off_days || [])] }; X.setOpen = false; draw(); el.querySelector(".tt-form").scrollIntoView({ block: "nearest" }); });
    if (X.cohortEdit) {
      const c = X.cohortEdit;
      el.querySelectorAll("[data-tco]").forEach(b => b.onclick = () => { const d = +b.dataset.tco; c.off_days = c.off_days.includes(d) ? c.off_days.filter(x => x !== d) : [...c.off_days, d]; b.setAttribute("aria-pressed", c.off_days.includes(d)); });
      const g = $("#tcG"); g.oninput = () => { const n = Math.max(1, Math.min(20, +g.value || 1)); $("#tcGN").value = Array.from({ length: n }, (_, i) => String(i + 1)).join("، "); };
      on("#tcX", () => { X.cohortEdit = null; draw(); });
      on("#tcDel", () => { if (!confirm("حذف الفرقة وكل موادها من الجدول؟")) return; X.cohortEdit = null; act(() => rpc("tt_cohort_delete", { cid: c.id }), "اتحذفت الفرقة."); });
      on("#tcGo", () => { const p = { id: c.id || "", level: +$("#tcL").value, track: $("#tcT").value, students: $("#tcN").value, groups: $("#tcGN").value.split(/[،,]/).map(s => s.trim()).filter(Boolean), off_days: c.off_days };
        X.cohortEdit = null; act(() => rpc("tt_cohort_save", { tid: X.cur.tt.id, p }), "اتحفظت الفرقة."); });
    }
    // المواد
    el.querySelectorAll("[data-tta]").forEach(b => b.onclick = () => { const [cid, d, p, q, gs] = b.dataset.tta.split("|"); X.edit = { cohort_id: cid, day: +d, p_from: +p, p_to: q ? +q : Math.min(+p + 1, X.cur.tt.periods.length), course_id: null, title: "", groups: gs ? gs.split(",").filter(Boolean) : [], room: "", team: [], same: false, note: "" }; draw(); });
    el.querySelectorAll("[data-tts]").forEach(b => b.onclick = () => { const s = X.cur.slots.find(x => x.id === b.dataset.tts); if (!X.ctx.isAdmin) return showSlot(s); X.edit = JSON.parse(JSON.stringify({ ...s, same: s.team.length <= 1 && (!s.team[0] || !s.team[0].g) })); draw(); });
    if (X.edit) wireSheet();
  }
  function wireSheet() {
    const e = X.edit, q = s => document.querySelector(s), on = (s, f) => { const b = q(s); if (b) b.onclick = f; };
    const keep = () => { const t = q("#tseT"); if (t) e.title = t.value; const n = q("#tseN"); if (n) e.note = n.value; };
    const redraw = () => { keep(); const sc = q(".tt-ed") && q(".tt-ed").scrollTop; draw(); const b = q(".tt-ed"); if (b && sc) b.scrollTop = sc; };
    const close = () => { X.edit = null; draw(); };
    on("#tseX", close); const sh = q("#ttSheet"); sh.onclick = ev => { if (ev.target === sh) close(); };
    q("#tseC").onchange = () => { e.course_id = q("#tseC").value || null; if (e.course_id) e.title = (X.ctx.courses.find(x => x.id === e.course_id) || {}).name || ""; redraw(); };
    document.querySelectorAll("[data-sed]").forEach(b => b.onclick = () => { e.day = +b.dataset.sed; redraw(); });
    q("#tseA").onchange = () => { e.p_from = +q("#tseA").value; if (e.p_to < e.p_from) e.p_to = e.p_from; redraw(); };
    q("#tseB").onchange = () => { e.p_to = +q("#tseB").value; redraw(); };
    q("#tseR").onchange = () => { e.room = q("#tseR").value; };
    document.querySelectorAll("[data-seg]").forEach(b => b.onclick = () => { const g = b.dataset.seg; e.groups = g === "*" ? [] : e.groups.includes(g) ? e.groups.filter(x => x !== g) : [...e.groups, g]; redraw(); });
    q("#tseSame").onchange = () => { const v = q("#tseSame").checked; if (v) { const first = e.team.find(t => t.staff.length) || { staff: [], room: "" }; e.team = [{ g: "", staff: first.staff, room: "" }]; } else { const base = e.team[0] || { staff: [] }; const c = X.cur.cohorts.find(x => x.id === e.cohort_id); e.team = (e.groups.length ? e.groups : c.groups).map(g => ({ g, staff: base.staff.map(p => ({ ...p })), room: "" })); } e.same = v; redraw(); };
    const tFor = g => { let t = e.team.find(x => (x.g || "") === g); if (!t) { t = { g, staff: [], room: "" }; e.team.push(t); } return t; };
    document.querySelectorAll("[data-ser]").forEach(s => s.onchange = () => { tFor(s.dataset.ser).room = s.value; });
    document.querySelectorAll("[data-sex]").forEach(b => b.onclick = () => { const [g, j] = b.dataset.sex.split("|"); tFor(g).staff.splice(+j, 1); redraw(); });
    document.querySelectorAll("[data-sea]").forEach(inp => {
      const add = () => { const v = inp.value.trim(); if (!v) return; const st = X.ctx.staff.find(s => TT.shortName(s, X.ctx.staff) === v || s.name === v);
        const k = st ? (st.role === "ta" || /^م\./.test(TT.shortName(st, X.ctx.staff)) ? "ta" : "lec") : /^م\.?/.test(v) ? "ta" : "lec";
        const n = st ? TT.shortName(st, X.ctx.staff) : /^(د|م|أ)\./.test(v) ? v : (k === "ta" ? "م." : "د.") + v;
        const t = tFor(inp.dataset.sea); if (!t.staff.some(p => p.n === n)) t.staff.push({ n, e: st ? st.email : null, k }); redraw(); const ni = document.querySelector(`[data-sea="${CSS.escape(inp.dataset.sea)}"]`); if (ni) ni.focus(); };
      inp.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); add(); } };
      inp.onchange = () => { if (X.ctx.staff.some(s => TT.shortName(s, X.ctx.staff) === inp.value)) add(); };
      inp.onblur = () => { if (inp.value.trim()) add(); };
    });
    on("#tseCopy", () => { const c = X.cur.cohorts.find(x => x.id === e.cohort_id), gs = e.groups.length ? e.groups : c.groups, f = tFor(gs[0]); e.team = gs.map(g => ({ g, staff: f.staff.map(p => ({ ...p })), room: f.room })); redraw(); });
    on("#tseDel", () => { if (!confirm("حذف «" + e.title + "» من الجدول؟")) return; const id = e.id; X.edit = null; act(() => rpc("tt_slot_delete", { sid: id }), "اتحذفت المادة من الجدول."); });
    on("#tseGo", async () => {
      keep(); if (!e.course_id && !e.title.trim()) return alert("اختار المادة أو اكتب اسمها.");
      const c = X.cur.cohorts.find(x => x.id === e.cohort_id), gs = e.groups.length ? e.groups : c.groups;
      const team = e.same ? [{ g: "", staff: (e.team[0] || { staff: [] }).staff, room: "" }] : e.team.filter(t => gs.includes(t.g) && (t.staff.length || t.room));
      X.busy = true; draw();
      try { await rpc("tt_slot_save", { tid: X.cur.tt.id, p: { id: e.id || "", cohort_id: e.cohort_id, day: e.day, p_from: e.p_from, p_to: e.p_to, course_id: e.course_id, title: e.title, groups: e.groups, room: e.room, team, note: e.note } });
        X.busy = false; X.edit = null; await loadTT(X.cur.tt.id); say("اتحفظت «" + (e.title || "المادة") + "».");
      } catch (err) { X.busy = false; fail(err); X.edit = e; draw(); }
    });
  }
  function showSlot(s) {
    const tt = X.cur.tt; const c = X.cur.cohorts.find(x => x.id === s.cohort_id);
    alert(`${s.title}\n${cohortName(c)}\n${DAY[s.day]} ${pTime(tt, s.p_from, s.p_to)}${s.room ? "\n" + s.room : ""}\n\n` + s.team.map(t => (t.g ? "مجموعة " + gName(t.g) + ": " : "") + t.staff.map(p => p.n).join("، ") + (t.room ? " (" + t.room + ")" : "")).join("\n"));
  }
  async function act(fn, ok, reloadList) {
    try { await fn(); if (reloadList) { await loadList(); X.cur = null; if (X.list.length) await loadTT(X.list[0].id); } else await loadTT(X.cur.tt.id); await loadList(); say(ok); } catch (e) { fail(e); }
  }

  /* ---------------- التصدير (نفس شكل الجدول الرسمي) ---------------- */
  function laneSlots(ss) { // توزيع المواد المتداخلة على أكثر من صف
    const lanes = []; ss.sort((a, b) => a.p_from - b.p_from).forEach(s => { let l = lanes.find(L => L.every(x => x.p_to < s.p_from || x.p_from > s.p_to)); if (!l) lanes.push(l = []); l.push(s); }); return lanes;
  }
  async function buildWb(onlyWho) {
    await X.ctx.loadExcelJS();
    const C = X.cur, tt = C.tt, P = tt.periods.length, D = tt.days, cols = 3 + D.length * P;
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("الجدول الدراسي", { views: [{ rightToLeft: true, state: "frozen", xSplit: 3, ySplit: 8 }] });
    ws.pageSetup = { orientation: "landscape", paperSize: 8, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .2, right: .2, top: .3, bottom: .3, header: .1, footer: .1 }, printTitlesRow: "7:8" };
    const B = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } }, Bd = { ...B, bottom: { style: "hair" }, top: { style: "hair" } };
    const F = (sz, b) => ({ name: "Arial", size: sz, bold: !!b });
    const colOf = (di, p) => 4 + di * P + (p - 1); // الورقة من اليمين لليسار: الفترة الأولى أقرب لعمود الفرقة
    // العنوان
    ws.mergeCells(1, 4, 1, cols); ws.getCell(1, 4).value = tt.title; ws.getCell(1, 4).font = F(14, true); ws.getCell(1, 4).alignment = { horizontal: "center" };
    ws.mergeCells(2, 4, 2, cols); ws.getCell(2, 4).value = `للعام الجامعي ${ar(tt.academic_year)} (${TERMS[tt.term]})${onlyWho ? " · " + onlyWho.n : ""}`; ws.getCell(2, 4).font = F(12, true); ws.getCell(2, 4).alignment = { horizontal: "center" };
    tt.periods.forEach((p, i) => { const r = 1 + i; if (r > 6) return; ws.getCell(r, 1).value = PN[i]; ws.getCell(r, 2).value = `${t12(p.from)} – ${t12(p.to)}`; [1, 2].forEach(k => { ws.getCell(r, k).border = B; ws.getCell(r, k).font = F(9, k === 1); ws.getCell(r, k).alignment = { horizontal: "center" }; }); });
    // رؤوس الأيام والفترات
    ws.mergeCells(7, 1, 8, 1); ws.getCell(7, 1).value = "الفرقة"; ws.getCell(7, 2).value = "اليوم"; ws.getCell(8, 2).value = "الفترة"; ws.mergeCells(7, 3, 8, 3); ws.getCell(7, 3).value = "";
    D.forEach((d, di) => { ws.mergeCells(7, colOf(di, 1), 7, colOf(di, P)); ws.getCell(7, colOf(di, 1)).value = DAY[d]; for (let p = 1; p <= P; p++) ws.getCell(8, colOf(di, p)).value = p; });
    for (let c = 1; c <= cols; c++) [7, 8].forEach(r => { const x = ws.getCell(r, c); x.font = F(10, true); x.alignment = { horizontal: "center", vertical: "middle" }; x.border = B; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1EE" } }; });
    let r = 9;
    for (const c of C.cohorts) {
      const mine = s => !onlyWho || s.team.some(t => t.staff.some(p => staffKey(p) === onlyWho.k));
      const byDay = D.map(d => laneSlots(C.slots.filter(s => s.cohort_id === c.id && s.day === d && mine(s))));
      const nL = Math.max(1, ...byDay.map(l => l.length)); const gs = c.groups; const top = r;
      if (onlyWho && !byDay.some(l => l.length)) continue;
      for (let L = 0; L < nL; L++) {
        const hr = r; ws.getCell(hr, 2).value = "المادة"; ws.getCell(hr, 2).font = F(9, true);
        gs.forEach((g, gi) => { ws.getCell(hr + 1 + gi, 2).value = gName(g); });
        D.forEach((d, di) => {
          if ((c.off_days || []).includes(d)) { if (L === 0) { ws.mergeCells(hr, colOf(di, 1), hr + gs.length, colOf(di, P)); const x = ws.getCell(hr, colOf(di, 1)); x.value = "إجازة"; x.alignment = { horizontal: "center", vertical: "middle" }; x.fill = { type: "pattern", pattern: "lightTrellis", fgColor: { argb: "FFBBBBBB" } }; } return; }
          (byDay[di][L] || []).forEach(s => {
            const a = colOf(di, s.p_from), b = colOf(di, s.p_to);
            if (a !== b) ws.mergeCells(hr, a, hr, b);
            const rooms = [...new Set([s.room, ...s.team.map(t => t.room)].filter(Boolean))];
            const h = ws.getCell(hr, a); h.value = s.title + (rooms.length ? `  (${rooms.join(" / ")})` : ""); h.font = F(9, true); h.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F8F6" } };
            const same = s.team.length <= 1 && (!s.team[0] || !s.team[0].g), sg = slotGroups(s, c);
            if (same && sg.length === gs.length) { // فريق واحد لكل المجموعات: الأسماء مرة واحدة تحت بعض كما في الجدول الورقي
              ws.mergeCells(hr + 1, a, hr + gs.length, b);
              const x = ws.getCell(hr + 1, a); x.value = s.team[0] ? s.team[0].staff.map(p => p.n).join("\n") : ""; x.font = F(8); x.alignment = { horizontal: "center", vertical: "top", wrapText: true };
              return;
            }
            gs.forEach((g, gi) => {
              const rr = hr + 1 + gi; if (!sg.includes(g)) return;
              const t = same ? s.team[0] : s.team.find(x => x.g === g); if (a !== b) ws.mergeCells(rr, a, rr, b);
              const x = ws.getCell(rr, a); x.value = t ? t.staff.map(p => p.n).join("  ") + (t.room && !same ? `  (${t.room})` : "") : ""; x.font = F(8); x.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            });
          });
        });
        for (let rr = hr; rr <= hr + gs.length; rr++) for (let cc = 2; cc <= cols; cc++) { const x = ws.getCell(rr, cc); x.border = rr === hr ? B : Bd; if (!x.alignment) x.alignment = { horizontal: "center", vertical: "middle" }; }
        ws.getRow(hr).height = 22; for (let gi = 0; gi < gs.length; gi++) ws.getRow(hr + 1 + gi).height = 15;
        r = hr + gs.length + 1;
      }
      ws.mergeCells(top, 1, r - 1, 1); const lc = ws.getCell(top, 1); lc.value = `${cohortName(c)}${c.students ? `\nعدد الطلبة ${ar(c.students)}` : ""}`; lc.font = F(11, true); lc.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; lc.border = B;
      ws.mergeCells(top, 3, r - 1, 3); ws.getCell(top, 3).value = "المجموعة"; ws.getCell(top, 3).alignment = { textRotation: 90, horizontal: "center", vertical: "middle" }; ws.getCell(top, 3).font = F(8); ws.getCell(top, 3).border = B;
      for (let rr = top; rr < r; rr++) { ws.getCell(rr, 1).border = B; }
      for (let cc = 1; cc <= cols; cc++) ws.getCell(r - 1, cc).border = { ...(ws.getCell(r - 1, cc).border || {}), bottom: { style: "medium" } };
    }
    r += 1; ws.getCell(r, cols - 6).value = tt.signer; ws.getCell(r, cols - 6).font = F(11, true); ws.getCell(r + 1, cols - 6).value = "يعتمد،";
    ws.getColumn(1).width = 16; ws.getColumn(2).width = 11; ws.getColumn(3).width = 4; for (let c = 4; c <= cols; c++) ws.getColumn(c).width = 9.5;
    return wb;
  }
  async function exportTT(pdf, who) {
    try {
      const wb = await buildWb(who), tt = X.cur.tt, nm = HD.fileName(`الجدول الدراسي ${tt.academic_year.replace("/", "-")} ${TERMS[tt.term]}${who ? " - " + who.n : ""}`);
      if (pdf) await HP.wbToPdf(wb, ["الجدول الدراسي"], nm + ".pdf"); else await X.ctx.saveWb(wb, nm + ".xlsx");
    } catch (e) { fail(e); }
  }
  function exportWho() { const [k, n] = X.who.split("|"); exportTT(false, { k, n }); }

  /* ---------------- «جدولي» لعضو هيئة التدريس ---------------- */
  TT.mine = async (ctx) => {
    const list = await ctx.rpc("tt_list") || []; if (!list.length) return null;
    const pub = list.find(x => x.published) || list[0]; const r = await ctx.rpc("tt_get", { tid: pub.id }); if (!r) return null;
    const me = ctx.me, keyE = "e:" + me.email, keyN = "n:" + CM.normAr(TT.shortName(me, ctx.staff));
    const out = [];
    r.slots.forEach(s => { const groups = []; let room = ""; s.team.forEach(t => { if (t.staff.some(p => [keyE, keyN].includes(staffKey(p)))) { groups.push(t.g); if (t.room) room = t.room; } }); if (groups.length) out.push({ ...s, myGroups: groups.filter(Boolean), myRoom: room || s.room, cohort: r.cohorts.find(c => c.id === s.cohort_id) }); });
    return { tt: r.tt, slots: out.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.p_from - b.p_from) };
  };
  TT.weekHtml = (data, opts = {}) => { // عرض أسبوعي بسيط (للطالب ولعضو هيئة التدريس)
    const tt = data.tt, slots = data.slots, today = new Date().getDay();
    const now = new Date(), hm = now.getHours() * 60 + now.getMinutes(), toM = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + m; };
    const days = (tt.days || []).filter(d => slots.some(s => s.day === d));
    if (!days.length) return `<div class="empty">مفيش محاضرات في الجدول ليك.</div>`;
    const sel = opts.day != null && days.includes(opts.day) ? opts.day : days.includes(today) ? today : days[0];
    return `<div class="tw"><div class="tw-days" role="tablist">${days.map(d => `<button role="tab" class="${d === sel ? "on" : ""}" aria-selected="${d === sel}" data-twd="${d}">${DAY[d]}${d === today ? `<i>النهارده</i>` : ""}</button>`).join("")}</div>
      <div class="tw-list">${slots.filter(s => s.day === sel).map(s => {
        const a = (tt.periods[s.p_from - 1] || {}).from, b = (tt.periods[s.p_to - 1] || {}).to, live = sel === today && hm >= toM(a) && hm < toM(b), next = sel === today && hm < toM(a);
        return `<div class="tw-s ${live ? "live" : ""}"><div class="tw-t"><b dir="ltr">${t12(a)}</b><small dir="ltr">${t12(b)}</small></div><div class="tw-b"><b>${CM.esc(s.title)}</b>${live ? `<span class="chip ok">الآن</span>` : ""}
          <div class="small">${[s.myRoom || s.room ? `📍 ${CM.esc(s.myRoom || s.room)}` : "", opts.staff ? `${CM.esc(cohortName(s.cohort || { level: 0 }))}${s.myGroups && s.myGroups.length ? " · مجموعة " + s.myGroups.map(gName).join("، ") : ""}` : (s.staff || []).map(p => CM.esc(p.n)).join("، ")].filter(Boolean).join(" · ")}</div>
          ${s.note ? `<div class="small muted">${CM.esc(s.note)}</div>` : ""}</div></div>`; }).join("")}</div></div>`;
  };
})();
