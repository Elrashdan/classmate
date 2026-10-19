/*!
 * Classmate · نظام تسجيل الحضور الإلكتروني
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 * لا يجوز النسخ أو التعديل أو إعادة النشر إلا بإذن كتابي من صاحب الحق.
 */
// Classmate — shared helpers for the student and staff apps
(function () {
  const cfg = window.CLASSMATE || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON");
  const CM = window.CM = {};
  CM.configured = configured;
  CM.sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  CM.$ = s => document.querySelector(s);
  CM.$$ = s => Array.from(document.querySelectorAll(s));
  CM.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  CM.fmtT = t => new Date(t).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  CM.fmtD = t => new Date(t).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
  CM.mmss = ms => { ms = Math.max(0, ms); const m = Math.floor(ms / 6e4), s = Math.floor(ms % 6e4 / 1000); return m + ":" + String(s).padStart(2, "0"); };
  CM.dist = m => m == null ? "" : m >= 1000 ? (m / 1000).toFixed(1) + " كم" : m + " م";
  CM.store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // absence warnings
  CM.WARN = [{ t: "منتظم", k: "ok" }, { t: "إنذار أول", k: "warn" }, { t: "إنذار ثانٍ", k: "warn" }, { t: "إنذار ثالث ونهائي", k: "bad" }, { t: "انسحاب إجباري", k: "out" }];
  // حدود الإنذارات بعدد مرات الغياب: غيابان إنذار أول، 3 إنذار ثانٍ، 4 إنذار ثالث ونهائي، 5 انسحاب إجباري
  CM.THR = [2, 3, 4, 5];
  CM.lvl = n => CM.THR.filter(t => (n || 0) >= t).length;
  CM.warnOf = n => CM.WARN[CM.lvl(n)];
  CM.warnChip = n => { const w = CM.warnOf(n); return `<span class="chip ${w.k}">${w.t}</span>`; };
  CM.times = n => n === 1 ? "مرة واحدة" : n === 2 ? "مرتين" : n <= 10 ? n + " مرات" : n + " مرة";
  CM.lvlChip = i => `<span class="chip ${CM.WARN[i].k}">${CM.WARN[i].t}</span>`;
  CM.nextWarn = n => { const l = CM.lvl(n); return l >= 4 ? "" : (CM.THR[l] - n === 1 ? "غياب آخر = " : `بعد ${CM.THR[l] - n} غيابات: `) + CM.WARN[l + 1].t; };

  // server errors -> Arabic
  const ERR = {
    not_allowed: "غير مسموح لك بهذا الإجراء.",
    not_found: "تعذّر العثور على هذه البيانات، وربما تغيّرت. حدّث الصفحة.",
    session_running: "توجد محاضرة جارية في هذه المادة. أنهِها أولًا.",
    session_ended: "انتهت هذه المحاضرة. تعديلها متاح لصاحب المادة فقط.",
    wrong_domain: "يجب أن يكون البريد على نطاق الجامعة.",
    bad_email: "البريد الإلكتروني غير صحيح.",
    name_required: "اكتب الاسم.",
    cannot_demote_self: "لا يمكنك إزالة صلاحية المسؤول عن نفسك.",
    cannot_change_self: "لا يمكنك إيقاف حسابك.",
    domain_locks_you_out: "هذا النطاق لن يسمح لك أنت نفسك بالدخول. اكتب نطاق بريدك.",
    empty_roster: "الملف فارغ أو لا يتضمن عمودًا للكود والاسم.",
    bad_year: "العام الدراسي غير صحيح.",
    bad_term: "اختر الفصل الدراسي.",
    bad_level: "اختر المستوى.",
    track_required: "يلزم اختيار شعبة لهذا المستوى: عمارة داخلية أو سينوغرافيا.",
    track_not_allowed: "المستويان الأول والثاني تخصص عام، دون شعبة.",
    reason_required: "اكتب سبب التسجيل اليدوي (3 أحرف على الأقل).",
    bad_date: "التاريخ غير مفهوم أو في المستقبل.",
    bad_code: "يجب أن يتكون كود الطالب من أرقام أو أحرف إنجليزية دون مسافات.",
    already_in_course: "هذا الكود مسجَّل في المادة من قبل.",
    already_owner: "هذا هو صاحب المادة بالفعل.",
    confirm_mismatch: "الاسم المكتوب لا يطابق اسم المادة.",
    not_enrolled: "هذا الكود غير موجود في ملف أي مادة. تأكّد منه أو تواصل مع المحاضر.",
    already_registered: "يوجد حساب بهذا الكود من قبل. ادخل من «دخول». إذا لم تكن أنت من أنشأه، فاطلب من المحاضر حذف الحساب.",
    weak_password: "يجب ألا تقل كلمة السر عن 6 أحرف.",
    bad_pin: "رمز التفعيل غير صحيح.",
    not_registered: "لا يوجد حساب بهذا الكود. أنشئ حسابًا من «إنشاء حساب».",
    bad_password: "كلمة السر غير صحيحة.",
    device_mismatch: "هذا الحساب مرتبط بهاتف آخر. إذا غيّرت هاتفك أو مسحت بيانات المتصفح، فاطلب من المحاضر فك ربط الجهاز.",
    locked: "محاولات كثيرة. انتظر ربع ساعة ثم أعد المحاولة.",
    not_signed_in: "انتهت جلستك. سجّل الدخول مرة أخرى.",
    bad_device: "المتصفح لا يحفظ البيانات. أغلق وضع التصفح الخفي وأعد المحاولة."
  };
  CM.errText = e => {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    for (const k in ERR) if (m.includes(k)) return ERR[k];
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "لا يوجد اتصال بالإنترنت. تأكّد من الاتصال وأعد المحاولة.";
    if (/rate limit|too many/i.test(m)) return "طلبات كثيرة متتالية. انتظر دقيقة ثم أعد المحاولة.";
    if (/Token has expired|invalid/i.test(m) && /otp|token/i.test(m)) return "الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.";
    return "حدثت مشكلة: " + m;
  };

  CM.rpc = async (name, args) => {
    if (!CM.sb) throw { message: "Failed to fetch" }; // supabase script didn't load (offline)
    const { data, error } = await CM.sb.rpc(name, args || {});
    if (error) throw error;
    if (data && typeof data === "object" && !Array.isArray(data) && data.error) throw { message: data.error };
    return data;
  };

  // fetch every row of a query (PostgREST returns at most 1000 per call)
  CM.fetchAll = async build => {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await build().range(from, from + step - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < step) break;
    }
    return out;
  };

  // GPS: resolves {lat,lng,acc} or {error:'denied'|'unavailable'|'timeout'|'unsupported'}
  CM.getPosition = (timeout = 15000) => new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ error: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => resolve({ error: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });

  // personal attendance QR: "CM1:<code>:<step>:<first 16 hex of HMAC-SHA256(key, code:step)>"
  CM.QR_STEP = 15000;
  CM.qrPayload = async (code, keyHex, step) => {
    const raw = new Uint8Array(keyHex.match(/../g).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(code + ":" + step)));
    return "CM1:" + code + ":" + step + ":" + Array.from(sig.slice(0, 8), b => b.toString(16).padStart(2, "0")).join("");
  };


  // theme: auto (follows the phone/computer) → light → dark. Saved per browser.
  const THEMES = { auto: "تلقائي", light: "فاتح", dark: "داكن" };
  const ICONS = {
    auto: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
  };
  CM.theme = () => { const t = CM.store.get("cm_theme"); return t === "light" || t === "dark" ? t : "auto"; };
  const applyTheme = () => {
    const t = CM.theme(), root = document.documentElement;
    if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
    const dark = t === "dark" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.content = dark ? "#0e1513" : "#1d6b58";
    document.querySelectorAll("[data-theme-btn]").forEach(b => { b.innerHTML = ICONS[t]; b.title = "الثيم: " + THEMES[t] + " (اضغط للتغيير)"; b.setAttribute("aria-label", b.title); });
  };
  CM.themeBtn = () => { const t = CM.theme(); return `<button class="btn sm ghost icon" data-theme-btn title="الثيم: ${THEMES[t]} (اضغط للتغيير)" aria-label="الثيم: ${THEMES[t]}">${ICONS[t]}</button>`; };
  document.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("[data-theme-btn]"); if (!b) return;
    const next = { auto: "light", light: "dark", dark: "auto" }[CM.theme()];
    if (next === "auto") CM.store.del("cm_theme"); else CM.store.set("cm_theme", next);
    applyTheme();
  });
  if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) {} }
  applyTheme();


  // ownership & copyright (shown on every page)
  CM.APP = { name: "Classmate", title: "نظام تسجيل الحضور الإلكتروني", version: "1.0", released: "أكتوبر 2026", author: "أحمد محمد راشد حامد", year: "2026",
    org: "قسم الديكور · كلية الفنون الجميلة · جامعة العاصمة" };
  CM.copyright = () => `© ${CM.APP.year} ${CM.APP.author}. جميع الحقوق محفوظة.`;
  function legal() {
    if (document.querySelector("footer.legal")) return;
    const A = CM.APP, f = document.createElement("footer");
    f.className = "legal";
    f.innerHTML = `<span><b>${A.name}</b> · ${A.title} · الإصدار ${A.version}</span><span>${CM.copyright()}</span><button type="button" class="linkish" data-about>عن البرنامج وحقوق الملكية</button>`;
    const app = document.getElementById("app"); (app && app.parentNode ? app.parentNode : document.body).insertBefore(f, app ? app.nextSibling : null);
    const d = document.createElement("dialog");
    d.className = "about"; d.id = "aboutDlg";
    d.innerHTML = `<div class="about-in">
      <div class="brand"><div class="mark">C</div><div><h2>${A.name}</h2><p class="muted small">${A.title} · الإصدار ${A.version} (${A.released})</p></div></div>
      <dl>
        <dt>الفكرة والتصميم والتطوير</dt><dd>${A.author}</dd>
        <dt>الجهة</dt><dd>${A.org}</dd>
        <dt>حقوق الملكية</dt><dd>${CM.copyright()}</dd>
      </dl>
      <p class="small">البرنامج بواجهاته وتصميمه وشفرته المصدرية وقواعد بياناته وأدلة استخدامه مصنَّف محمي بموجب قانون حماية حقوق الملكية الفكرية المصري رقم 82 لسنة 2002. ولا يجوز نسخه أو نسخ أي جزء منه أو تعديله أو إعادة نشره أو استخدامه في غير الغرض الذي أُتيح له، إلا بإذن كتابي مسبق من صاحب الحق.</p>
      <p class="small muted">يُتاح استخدام البرنامج لأعضاء هيئة التدريس والطلبة المسجَّلين فيه لأغراض تسجيل الحضور داخل الكلية.</p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn sm" data-about-close>إغلاق</button></div>
    </div>`;
    document.body.appendChild(d);
    document.addEventListener("click", ev => {
      if (ev.target.closest && ev.target.closest("[data-about]")) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
      if (ev.target.closest && ev.target.closest("[data-about-close]") || ev.target === d) d.close ? d.close() : d.removeAttribute("open");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", legal); else legal();

  CM.setupNotice = () => `<div class="panel setup"><h2>لم يُربط التطبيق بقاعدة البيانات بعد</h2>
    <p class="muted">افتح ملف <span class="mono">config.js</span> وضع فيه Project URL و anon key من Supabase، كما هو موضّح في دليل التشغيل.</p></div>`;
})();
