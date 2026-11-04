/*!
 * Hadro · نظام إدارة الحضور
 * © 2026 أحمد محمد راشد حامد (Ahmed Mohamed Rashed Hamed). جميع الحقوق محفوظة. All rights reserved.
 * لا يجوز النسخ أو التعديل أو إعادة النشر إلا بإذن كتابي من صاحب الحق.
 */
// Hadro — shared helpers for the student and staff apps
(function () {
  const cfg = window.CLASSMATE || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON");
  const CM = window.CM = {};
  CM.configured = configured;
  CM.sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: Object.assign({ persistSession: true, autoRefreshToken: true }, window.HADRO_AUTH_KEY ? { storageKey: window.HADRO_AUTH_KEY } : {}) }) : null;

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
    bad_level_private: "البرنامج الخاص من خمسة مستويات.",
    track_private: "البرنامج الخاص لشعبة العمارة الداخلية فقط.",
    bad_program: "اختر البرنامج: العام أو الخاص.",
    track_required: "يلزم اختيار شعبة لهذا المستوى: عمارة داخلية أو سينوغرافيا.",
    track_not_allowed: "المستويان الأول والثاني تخصص عام، دون شعبة.",
    reason_required: "اكتب سبب التسجيل اليدوي (3 أحرف على الأقل).",
    bad_date: "التاريخ غير مفهوم أو في المستقبل.",
    bad_code: "يجب أن يتكون كود الطالب من أرقام أو أحرف إنجليزية دون مسافات.",
    already_in_course: "هذا الكود مسجَّل في المادة من قبل.",
    already_owner: "هذا هو صاحب المادة بالفعل.",
    confirm_mismatch: "الاسم المكتوب لا يطابق اسم المادة.",
    not_enrolled: "هذا الكود غير موجود في ملف أي مادة. سجّل بزر «التسجيل باستمارة التسجيل» بالأعلى، أو تواصل مع المحاضر.",
    no_courses: "اختر مقررًا واحدًا على الأقل.",
    already_registered: "يوجد حساب بهذا الكود من قبل. ادخل من «دخول». إذا لم تكن أنت من أنشأه، فاطلب من المحاضر حذف الحساب.",
    weak_password: "يجب ألا تقل كلمة السر عن 6 أحرف.",
    bad_pin: "رمز التفعيل غير صحيح.",
    not_registered: "لا يوجد حساب بهذا الكود. أنشئ حسابًا من «إنشاء حساب».",
    bad_password: "كلمة السر غير صحيحة.",
    limited_session: "هذا الدخول لتسليم التكليفات فقط. افعل ذلك من هاتفك المرتبط بالحساب.",
    device_mismatch: "هذا الحساب مرتبط بهاتف أو متصفح آخر. ادخل بكودك وكلمة السر لترى أين، ولتنقله إلى هنا إن أردت.",
    absent_on_due: "لا يُقبل تسليمك لأنك غبت في محاضرة يوم طرح المشروع (أو يوم التسليم). إن كان لك عذر فراجِع المحاضر ليقبله.",
    bad_until: "اختر موعدًا بعد الآن، وفي حدود 60 يومًا.",
    bad_parts: "اكتب من 2 إلى 10 مشاريع فرعية، لكل منها اسم ودرجة عظمى أكبر من صفر.",
    parts_in_use: "رُصدت درجات على المشاريع الفرعية الحالية، فلا يمكن تغيير عددها. يمكنك تغيير أسمائها ودرجاتها العظمى فقط.",
    bad_rule: "اختيار غير صحيح.",
    unknown_passkey: "هذه البصمة غير مسجلة في Hadro. ادخل بكودك وكلمة السر، ثم فعّل الدخول بالبصمة من صفحتك.",
    challenge_expired: "انتهت مهلة العملية. حاول مرة أخرى.",
    bad_signature: "تعذّر التحقق من البصمة. حاول مرة أخرى.",
    passkey_cloned: "تعذّر التحقق من مفتاح المرور. فعّل البصمة من جديد.",
    passkey_failed: "تعذّر الدخول بالبصمة. حاول مرة أخرى أو ادخل بكلمة السر.",
    too_many_passkeys: "فعّلت البصمة على أجهزة كثيرة. تواصل مع المحاضر.",
    not_this_device: "هذا ليس المتصفح المرتبط بحسابك.",
    google_not_linked: "حساب Google هذا غير مربوط بهذا الكود. اختر الحساب الذي سلّمت منه تكليفاتك، أو اطلب موافقة المحاضر.",
    google_token: "تعذّر التحقق من حساب Google. حاول مرة أخرى.",
    reset_not_approved: "لم تتم الموافقة على الطلب بعد، أو انتهت صلاحيته.",
    move_too_soon: "نقلت حسابك مؤخرًا. يمكن النقل مرة كل 3 أيام، أو اطلب من المحاضر فك ربط الهاتف.",
    device_taken: "هذا المتصفح مرتبط بحساب طالب آخر، فلا يمكن نقل حسابك إليه.",
    locked: "محاولات كثيرة. انتظر ربع ساعة ثم أعد المحاولة.",
    not_signed_in: "انتهت جلستك. سجّل الدخول مرة أخرى.",
    bad_device: "المتصفح لا يحفظ البيانات. أغلق وضع التصفح الخفي وأعد المحاولة.",
    title_required: "اكتب عنوان التكليف.",
    due_required: "حدّد موعد التسليم.",
    bad_late: "اختر ما يحدث بعد موعد التسليم.",
    max_below_grades: "لا يمكن جعل الدرجة العظمى أقل من درجة رُصدت بالفعل لأحد الطلبة.",
    grade_range: "توجد درجة أكبر من الدرجة العظمى للتكليف أو أقل من صفر.",
    bad_grade: "الدرجة غير صحيحة.",
    task_closed: "انتهى موعد التسليم، وأُغلق التسليم في هذا التكليف.",
    already_graded: "رُصدت درجتك في هذا التكليف، فلا يمكن تغيير التسليم. راجع المحاضر إن احتجت إلى ذلك.",
    too_many_versions: "سلّمت هذا التكليف مرات كثيرة. راجع المحاضر.",
    bad_link: "الرابط غير صحيح. انسخ رابطًا كاملًا يبدأ بـ https://",
    bad_file: "تعذّر حفظ بيانات الملف. أعد المحاولة.",
    drive_script: "تعذّر الاتصال بـ Google. تأكّد من الاتصال بالإنترنت، أو سلّم رابطًا بدلًا من ذلك.",
    drive_closed: "أُغلقت نافذة Google قبل الموافقة. اضغط «سلّم» مرة أخرى واختر حسابك.",
    drive_denied: "لم يُسمح للتطبيق بالرفع إلى Google Drive. اضغط «سلّم» مرة أخرى ووافق، أو سلّم رابطًا.",
    drive_expired: "انتهت صلاحية إذن Google. اضغط «سلّم» مرة أخرى.",
    drive_full: "مساحة Google Drive في حسابك ممتلئة. أفرغ بعض المساحة أو استخدم حسابًا آخر.",
    drive_no_share: "حسابك لا يسمح بمشاركة الملفات لمن معه الرابط (غالبًا حساب جامعي مقيّد). استخدم حساب Gmail شخصيًّا.",
    drive_forbidden: "رفض Google هذا الطلب. جرّب مرة أخرى أو استخدم حساب Gmail شخصيًّا.",
    drive_missing: "الملف غير موجود على Drive الطالب، أو لم يعد متاحًا لمن معه الرابط.",
    bonus_range: "البونص أكبر من الدرجة العظمى للتكليف أو أقل من صفر.",
    manual_task: "هذا رصد يدوي، لا يُسلَّم من التطبيق.",
    bad_mode: "اختر نوع التكليف.",
    drive_http_: "تعذّر الاتصال بـ Google Drive. أعد المحاولة."
  };
  CM.errText = e => {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    for (const k in ERR) if (m.includes(k)) return ERR[k];
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "لا يوجد اتصال بالإنترنت. تأكّد من الاتصال وأعد المحاولة.";
    if (/email rate limit|over_email_send_rate_limit/i.test(m)) return "أُرسلت رسائل دخول كثيرة خلال الساعة الأخيرة، فأوقفها الخادم مؤقتًا. لا تطلب رسالة جديدة: افتح آخر رسالة وصلتك واكتب رمزها هنا، أو افتح رابطها في هذا المتصفح نفسه. وإن لم تكن لديك رسالة صالحة، فانتظر ساعة ثم أعد المحاولة.";
    if (/only request this after|security purposes/i.test(m)) return "انتظر دقيقة قبل طلب رسالة دخول جديدة. ويمكنك استخدام آخر رسالة وصلتك.";
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
  CM.APP = { name: "Hadro", title: "نظام إدارة الحضور", tagline: "Attendance Manager", version: "1.0", released: "أكتوبر 2026", author: "أحمد محمد راشد حامد", year: "2026",
    org: "قسم الديكور · كلية الفنون الجميلة · جامعة العاصمة" };
  // علامة Hadro: حرف h كطالب يرفع يده (الساق ذراع مائلة، والقوس الكتفان، والنقطة الرأس)
  CM.markHtml = () => `<div class="mark" aria-hidden="true"><svg viewBox="0 0 200 200"><g transform="translate(-14 -6)"><path d="M92 172V130L76 34" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><path d="M92 128Q92 98 121 98Q150 98 150 128V172" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><circle cx="122" cy="60" r="17" fill="var(--logo-dot)"/></g></svg></div>`;
  // شاشة التحميل: شعار Hadro يُرسَم ثم تقفز نقطته، حتى تجهز الصفحة
  CM.loaderHtml = (text) => `<div class="hd-loader" role="status" aria-live="polite"><div class="hd-lmark"><svg viewBox="0 0 200 200" aria-hidden="true"><g transform="translate(-14 -6)"><path class="l1" pathLength="1" d="M92 172V130L76 34" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><path class="l2" pathLength="1" d="M92 128Q92 98 121 98Q150 98 150 128V172" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><circle class="ld" cx="122" cy="60" r="17"/></g></svg></div><span class="hd-ltext">${text || "جارٍ التحميل…"}</span></div>`;
  CM.loader = (el, text) => { if (el) el.innerHTML = CM.loaderHtml(text); };
  // واجهة البطل: شبكة خفيفة وتوهّج بلون الثيم، وخلفية هادئة متصلة (تُولَّد مرة وتُحفظ)
  //  A: خطوط انسيابية بارامترية كأسطر كرّاسة تنحني بهدوء   B: ورقة رسم هندسي بنقاط متساوية القياس تتلاشى نحو الوسط
  let artCache = null;
  CM.heroArt = () => {
    if (artCache) return artCache;
    const W = 1200, H = 420, style = window.HADRO_ART || "A";
    let body = "";
    if (style === "A") {
      const N = 26, P = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1), base = 40 + t * 360, pts = [];
        for (let x = -20; x <= W + 20; x += 20) {
          const u = x / W;
          const y = base + 26 * Math.sin(u * Math.PI * 2 * 1.1 + t * 2.4) + 14 * Math.sin(u * Math.PI * 2 * 2.3 - t * 3.1) + 40 * (t - .5) * Math.cos(u * Math.PI);
          pts.push((x === -20 ? "M" : "L") + x + " " + y.toFixed(1));
        }
        P.push(`<path d="${pts.join("")}" opacity="${(.1 + .22 * Math.sin(t * Math.PI)).toFixed(2)}"/>`);
      }
      body = `<g class="hx-flow" fill="none" stroke="#7fd6bb" stroke-width="1.1">${P.join("")}</g>`;
    } else {
      const S = 26, h = S * Math.sqrt(3) / 2, D = [];
      for (let r = 0, y = 8; y < H; r++, y += h) for (let x = (r % 2) * S / 2; x < W; x += S) {
        const dx = (x - W / 2) / (W / 2), dy = (y - H * .4) / H, k = Math.min(1, Math.sqrt(dx * dx + dy * dy * 3) * 1.1);
        D.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(.8 + .9 * k).toFixed(2)}" opacity="${(.08 + .32 * k).toFixed(2)}"/>`);
      }
      body = `<g fill="#7fd6bb">${D.join("")}</g>`;
    }
    return artCache = `<svg class="hx-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
  };
  CM.hero = (o) => `<section class="hx${o.small ? " sm" : ""}">${CM.heroArt()}<div class="hx-in">
    <div class="hx-logo">${CM.markHtml()}</div>${o.eyebrow ? `<div class="hx-eb">${o.eyebrow}</div>` : ""}<h2>${o.title}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}${o.cta ? `<div class="hx-cta">${o.cta}</div>` : ""}${o.extra || ""}</div></section>`;
  // شريط القسم: خلفية الخطوط الانسيابية نفسها، وفوقها أيقونة القسم مكبّرة وصداها يتّسع ويخفت (تصميم مستمد من أيقونة كل صفحة)
  CM.iconEcho = d => `<svg class="sb-echo" viewBox="-48 -48 120 120" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${[4.4, 3.5, 2.75, 2.1, 1.55, 1.1].map((k, i) => `<g transform="translate(12 12) rotate(${(-i * 2.5).toFixed(1)}) scale(${k}) translate(-12 -12)" opacity="${[.05, .07, .1, .14, .2, .3][i]}" stroke-width="${(1.2 / k).toFixed(3)}">${d}</g>`).join("")}</svg>`;
  CM.band = o => `<section class="sband${o.cls ? " " + o.cls : ""}"${o.id ? ` id="${o.id}"` : ""}>${CM.heroArt()}${o.icon ? CM.iconEcho(o.icon) : ""}<div class="sb-in">${o.icon ? `<span class="sb-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${o.icon}</svg></span>` : ""}<div class="sb-t">${o.eyebrow ? `<div class="sb-eb">${o.eyebrow}</div>` : ""}<h2>${o.title}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.extra ? `<div class="sb-x">${o.extra}</div>` : ""}</div></section>`;
  CM.ICONS = {
    ug: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v5"/>',
    pg: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 17h5"/>',
    share: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
    admin: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  CM.rise = el => { if (!el) return; el.classList.remove("rise"); void el.offsetWidth; el.classList.add("rise"); clearTimeout(el._rt); el._rt = setTimeout(() => el.classList.remove("rise"), 900); };
  // الضغط على شعار Hadro أعلى الصفحة = «الرئيسية»: تتولاه الصفحة إن استمعت لحدث hadro:home، وإلا فالصفحة الموحدة
  document.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("header.top .brand");
    if (!b) return;
    const e = new CustomEvent("hadro:home", { cancelable: true });
    if (document.dispatchEvent(e)) location.href = "./";
  });
  document.addEventListener("keydown", ev => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches && ev.target.matches("header.top .brand")) { ev.preventDefault(); ev.target.click(); } });
  new MutationObserver(() => document.querySelectorAll("header.top .brand:not([tabindex])").forEach(b => { b.tabIndex = 0; b.setAttribute("role", "link"); b.title = "الرئيسية"; b.setAttribute("aria-label", "Hadro · الرئيسية"); })).observe(document.documentElement, { childList: true, subtree: true });
  CM.copyright = () => `© ${CM.APP.year} ${CM.APP.author}. جميع الحقوق محفوظة.`;
  function legal() {
    if (document.querySelector("footer.legal")) return;
    const A = CM.APP, f = document.createElement("footer");
    f.className = "legal";
    f.innerHTML = `<span><b>${A.name}</b> · ${A.title} · الإصدار ${A.version} <span class="muted" dir="ltr" style="font-size:.8em">(b50)</span></span><span>${CM.copyright()}</span><button type="button" class="linkish" data-about>عن البرنامج وحقوق الملكية</button>`;
    const app = document.getElementById("app"); (app && app.parentNode ? app.parentNode : document.body).insertBefore(f, app ? app.nextSibling : null);
    const d = document.createElement("dialog");
    d.className = "about"; d.id = "aboutDlg";
    d.innerHTML = `<div class="about-in">
      <div class="brand">${CM.markHtml()}<div><h2>${A.name} <span class="muted small" style="font-weight:500;letter-spacing:.08em">${A.tagline.toUpperCase()}</span></h2><p class="muted small">${A.title} · الإصدار ${A.version} (${A.released})</p></div></div>
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
