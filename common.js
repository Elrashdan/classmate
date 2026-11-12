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
    appeal_not_released: "لا يمكن التظلم قبل إعلان الدرجات.", appeal_note: "اكتب سبب التظلم.", appeal_photo: "أرفق صورة المشروع.", appeal_open: "لديك تظلم قيد المراجعة في هذا التكليف.", appeal_limit: "وصلت إلى الحد الأقصى للتظلمات في هذا التكليف (3).", appeal_decided: "تم البت في هذا التظلم بالفعل.", appeal_reply: "اكتب سبب الرفض.", bad_reason: "اختر سبب التظلم.", bad_groups: "أسماء المجموعات غير صالحة (من ٢ إلى ١٢ اسمًا مختلفًا).", no_ungrouped: "كل الطلبة موزَّعون على مجموعات بالفعل.", appeal_closed: "باب التظلم مغلق في هذا التكليف.", remind_wait: "ذكّرت الفريق بهذا منذ أقل من 6 ساعات. انتظر قليلًا أو افتح المادة وتصرّف بنفسك.", remind_done: "تم التعامل مع هذا العنصر بالفعل.", bad_window: "اختر موعد إغلاق بعد موعد الفتح (حتى 120 يومًا).", bad_mode: "اختيار غير صالح.",
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
    drive_http_: "تعذّر الاتصال بـ Google Drive. أعد المحاولة.",
    already_staff: "هذا البريد له حساب بالفعل. ادخل به من «دخول»، ولو نسيت كلمة السر اختر «نسيت كلمة السر».",
    name_3: "اكتب اسمك ثلاثيًا أو رباعيًا (3 كلمات على الأقل، بدون أرقام).",
    too_many_requests: "أرسلت طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
    request_decided: "تم البت في هذا الطلب بالفعل.",
    reply_required: "اكتب سبب الرفض.",
    bad_category: "اختر نوع الرسالة.",
    ticket_subject: "اكتب عنوانًا من 3 حروف على الأقل.",
    ticket_body: "اكتب التفاصيل.",
    ticket_closed: "أُغلقت هذه المحادثة. ابعت رسالة جديدة.",
    bad_subscription: "تعذّر تفعيل الإشعارات على هذا المتصفح.",
    bad_role: "اختر الصفة.",
    uni_email: "اكتب بريدك الجامعي (اللي آخره .edu.eg).",
    tt_exists: "في جدول لنفس العام والفصل بالفعل. اختاره من القائمة.",
    bad_term: "اختر العام والفصل.",
    bad_slot: "اختر يومًا من أيام الدراسة وفترات صحيحة.",
    slot_title: "اختر المادة أو اكتب اسمها."
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

  // استدعاء دالة على الخادم مباشرة (صفحة الطالب لا تحتاج مكتبة Supabase كلها؛ أخف وأسرع، ولا تعتمد على خادم خارجي للمكتبة)
  // ويُعاد الطلب تلقائيًّا مرتين إن انقطع الاتصال لحظيًّا (شائع على شبكات الهاتف وSafari)
  const REST = configured ? cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" : "";
  CM.rpcFetch = async (name, args) => {
    let r;
    for (let k = 0; ; k++) {
      try {
        const ctl = window.AbortController ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), 20000) : 0;
        r = await fetch(REST + name, { method: "POST", headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args || {}), signal: ctl ? ctl.signal : undefined, cache: "no-store" });
        clearTimeout(tm); break;
      } catch (e) {
        if (k >= 2) {
          // نحفظ وصف الفشل لنرسله للتشخيص حين يعود الاتصال (لمعرفة سبب «لا يوجد إنترنت» على آيفون)
          try { const f = JSON.parse(localStorage.getItem("hadro_netfail") || "null") || { n: 0 }; f.n++; f.at = new Date().toISOString(); f.fn = name; f.err = String((e && (e.name || "") + ": " + (e.message || "")) || e).slice(0, 160); f.online = navigator.onLine; f.ua = navigator.userAgent.slice(0, 180); f.sa = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)); localStorage.setItem("hadro_netfail", JSON.stringify(f)); } catch (x) {}
          throw { message: "Failed to fetch" };
        }
        await new Promise(ok => setTimeout(ok, 700 * (k + 1)));
      }
    }
    if (name !== "client_log") try { const f = localStorage.getItem("hadro_netfail"); if (f) { localStorage.removeItem("hadro_netfail"); const j = JSON.parse(f); CM.rpcFetch("client_log", { p_token: null, p_where: "net:" + j.fn, p_msg: j.n + "× " + j.err, p_info: j }).catch(() => {}); } } catch (x) {}
    const txt = await r.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!r.ok) throw { message: (data && data.message) || "http_" + r.status, code: data && data.code, details: data && data.details };
    return data;
  };
  CM.rpc = async (name, args) => {
    if (!CM.sb) {
      if (!configured) throw { message: "Failed to fetch" };
      const data = await CM.rpcFetch(name, args);
      if (data && typeof data === "object" && !Array.isArray(data) && data.error) throw { message: data.error };
      return data;
    }
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
  const LOOK_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7" r="1.2" fill="currentColor"/></svg>';
  CM.themeBtn = () => { const t = CM.theme(); return `<button class="btn sm ghost icon" data-theme-btn title="الثيم: ${THEMES[t]} (اضغط للتغيير)" aria-label="الثيم: ${THEMES[t]}">${ICONS[t]}</button><button class="btn sm ghost icon" data-look-btn title="المظهر: شكل الواجهة وألوانها" aria-label="المظهر: شكل الواجهة وألوانها">${LOOK_ICO}</button>`; };
  document.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("[data-theme-btn]"); if (!b) return;
    const next = { auto: "light", light: "dark", dark: "auto" }[CM.theme()];
    if (next === "auto") CM.store.del("cm_theme"); else CM.store.set("cm_theme", next);
    applyTheme();

  });
  if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) {} }
  applyTheme();

  /* ---------- المظهر: الواجهة الكلاسيكية أو الحديثة + مجموعة ألوان من 3 ألوان + الحركة مع التمرير ---------- */
  CM.PALETTES = [
    { id: "lime", n: "ليموني", c: ["#ececec", "#c6f432", "#0e0e0e"] },
    { id: "hadro", n: "Hadro", c: ["#eef2f0", "#9fe3c8", "#122320"] },
    { id: "sun", n: "برتقالي", c: ["#efebe6", "#ff8a3d", "#1b1712"] },
    { id: "violet", n: "بنفسجي", c: ["#ecebf3", "#b9a6ff", "#17142a"] },
    { id: "sky", n: "سماوي", c: ["#e8edf3", "#7cc8ff", "#0f1a2b"] },
    { id: "rose", n: "وردي", c: ["#f3eaee", "#ff9ec4", "#1d1418"] },
    { id: "sand", n: "رملي", c: ["#efe8dc", "#e9c46a", "#23201a"] },
    { id: "mint", n: "نعناعي", c: ["#e9f0ec", "#5fe3a1", "#0b1d16"] }
  ];
  const lookGet = () => { let o = {}; try { o = JSON.parse(CM.store.get("cm_look") || "{}") || {}; } catch (e) {} return { skin: o.skin === "nx" ? "nx" : "classic", pal: o.pal || "lime", own: Array.isArray(o.own) && o.own.length === 3 ? o.own : null, motion: o.motion !== false }; };
  const lookSet = o => { CM.store.set("cm_look", JSON.stringify(o)); applyLook(); };
  CM.setLook = o => lookSet(Object.assign({ skin: "classic", pal: "lime", motion: true }, o));
  CM.look = lookGet;
  const palColors = L => L.pal === "own" && L.own ? L.own : (CM.PALETTES.find(p => p.id === L.pal) || CM.PALETTES[0]).c;
  const lum = hex => { const h = String(hex).replace("#", ""); if (h.length < 6) return .5; const [r, g, b] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * r + .7152 * g + .0722 * b; };
  function applyLook() {
    const L = lookGet(), r = document.documentElement;
    if (L.skin === "nx") {
      const [b, h, d] = palColors(L); r.dataset.skin = "nx";
      r.style.setProperty("--nx-base", b); r.style.setProperty("--nx-hi", h); r.style.setProperty("--nx-dark", d);
      r.style.setProperty("--nx-on-hi", lum(h) > .35 ? d : b);
    } else { delete r.dataset.skin; ["--nx-base", "--nx-hi", "--nx-dark", "--nx-on-hi"].forEach(k => r.style.removeProperty(k)); }
    if (L.motion) delete r.dataset.motion; else r.dataset.motion = "off";
    document.dispatchEvent(new Event("cm-look"));
  }
  CM.appearance = function () {
    let L = lookGet();
    const d = document.createElement("div"); d.className = "ap-dlg"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "المظهر");
    const prev = (c, nx) => `<span class="ap-prev" style="background:${nx ? c[0] : "#eef2f0"}">${nx ? `<i style="background:${c[2]}"></i><i style="background:${c[1]}"></i><i style="background:#fff"></i><i style="background:#fff"></i><i style="background:${c[2]}"></i>` : `<i style="background:#122320"></i><i style="background:#fff"></i><i style="background:#dcece6"></i><i style="background:#fff"></i><i style="background:#1d6b58"></i>`}</span>`;
    const draw = () => {
      const c = palColors(L), own = L.own || c;
      d.innerHTML = `<div class="ap-box"><div class="ap-h"><b>المظهر</b><button class="btn sm ghost" data-apx aria-label="إغلاق">✕</button></div>
        <div class="ap-sec"><span>شكل الواجهة</span><div class="ap-skins">
          <button type="button" class="ap-skin" data-aps="classic" aria-pressed="${L.skin === "classic"}">${prev(null, false)}<b>Hadro الكلاسيكي</b><small>الشكل المعتاد بالأخضر والزجاج</small></button>
          <button type="button" class="ap-skin" data-aps="nx" aria-pressed="${L.skin === "nx"}">${prev(c, true)}<b>الواجهة الحديثة</b><small>كروت كبيرة، شريط داكن، وحركة مع التمرير</small></button></div></div>
        <div class="ap-sec${L.skin === "nx" ? "" : " ap-dis"}"><span>ألوان الواجهة الحديثة</span><div class="ap-pals">${CM.PALETTES.map(p => `<button type="button" class="ap-pal" data-app="${p.id}" aria-pressed="${L.pal === p.id}"><span class="ap-dots">${p.c.map(x => `<i style="background:${x}"></i>`).join("")}</span>${p.n}</button>`).join("")}
          <button type="button" class="ap-pal" data-app="own" aria-pressed="${L.pal === "own"}"><span class="ap-dots">${own.map(x => `<i style="background:${x}"></i>`).join("")}</span>ألواني</button></div>
          ${L.pal === "own" ? `<div class="ap-own">${[["الخلفية", 0], ["اللون المميز", 1], ["الداكن", 2]].map(([t, i]) => `<label>${t}<input type="color" data-apo="${i}" value="${own[i]}"></label>`).join("")}</div><small class="muted">اختار خلفية فاتحة ولون داكن غامق علشان الكلام يبان.</small>` : ""}</div>
        <div class="ap-sec${L.skin === "nx" ? "" : " ap-dis"}"><label class="ap-row"><span>حركة مع التمرير (ظهور الكروت وتراكب الأقسام)</span><input type="checkbox" data-apm ${L.motion ? "checked" : ""}></label></div>
        <small class="muted">الاختيار بيتحفظ على الجهاز ده بس، والوضع الفاتح/الداكن من زرار الثيم جنبه.</small></div>`;
      d.querySelector("[data-apx]").onclick = close;
      d.querySelectorAll("[data-aps]").forEach(b => b.onclick = () => { L.skin = b.dataset.aps; lookSet(L); draw(); });
      d.querySelectorAll("[data-app]").forEach(b => b.onclick = () => { L.pal = b.dataset.app; if (L.pal === "own" && !L.own) L.own = palColors({ pal: "lime" }).slice(); lookSet(L); draw(); });
      d.querySelectorAll("[data-apo]").forEach(i => i.oninput = () => { L.own[+i.dataset.apo] = i.value; lookSet(L); const dots = d.querySelector('[data-app="own"] .ap-dots'); if (dots) dots.children[+i.dataset.apo].style.background = i.value; });
      const m = d.querySelector("[data-apm]"); if (m) m.onchange = () => { L.motion = m.checked; lookSet(L); };
    };
    const close = () => { d.remove(); document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") close(); };
    d.onclick = e => { if (e.target === d) close(); };
    document.addEventListener("keydown", esc);
    draw(); document.body.appendChild(d); const f = d.querySelector(".ap-skin[aria-pressed=true]"); if (f) f.focus();
  };
  document.addEventListener("click", ev => { const b = ev.target.closest && ev.target.closest("[data-look-btn]"); if (b) CM.appearance(); });
  applyLook();

  /* ---------- الحركة مع التمرير (الواجهة الحديثة بس) ---------- */
  (function motion() {
    const R = document.documentElement, SEL = ".panel, .tile, .walert-c, .sec-t, .now-c, .sband, .tw-panel, .gb-box, .bl-g, .ap-box, .msg.warn, .tiles.small > *";
    const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const on = () => R.dataset.skin === "nx" && R.dataset.motion !== "off" && !reduce();
    let io = null, ticking = false;
    const mark = () => {
      if (!on()) { document.querySelectorAll(".nx-r").forEach(e => e.classList.remove("nx-r", "nx-in")); return; }
      if (!io && "IntersectionObserver" in window) io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("nx-in"); io.unobserve(e.target); } }), { threshold: .08, rootMargin: "0px 0px -6% 0px" });
      const vh = innerHeight;
      document.querySelectorAll(SEL).forEach(el => {
        if (el.dataset.nxr || el.closest(".bell-pop, .ap-dlg, #overlay, .cpk-pop, .gb-box.full")) return; el.dataset.nxr = "1";
        const r = el.getBoundingClientRect(); if (r.top < vh * .92 && r.bottom > 0) return;     // الظاهر أصلًا ما يتحركش
        const sib = el.parentElement ? [...el.parentElement.children].indexOf(el) % 4 : 0; el.style.setProperty("--nxd", (sib * .07) + "s");
        el.classList.add("nx-r"); if (io) io.observe(el); else el.classList.add("nx-in");
      });
      document.querySelectorAll(".home .tiles:not(.small)").forEach(t => [...t.children].forEach((c, i) => c.style.setProperty("--nxi", i)));
      frame();
    };
    const frame = () => {
      ticking = false; if (!on()) return;
      const y = scrollY; R.classList.toggle("nx-sc", y > 24);
      document.querySelectorAll(".hx, .sband").forEach(h => { const r = h.getBoundingClientRect(); const p = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height))); h.style.setProperty("--nxp", p.toFixed(3)); });
      if (innerWidth <= 760) document.querySelectorAll(".home .tiles:not(.small)").forEach(t => { const ks = [...t.children];
        ks.forEach((k, i) => { const n = ks[i + 1]; if (!n) { k.style.setProperty("--nxc", 0); return; } const a = k.getBoundingClientRect(), b = n.getBoundingClientRect(); const ov = Math.max(0, Math.min(1, (a.bottom - b.top) / Math.max(1, a.height))); k.style.setProperty("--nxc", ov.toFixed(3)); }); });
    };
    // شريط الأقسام في الموبايل: بيختفي وإنت نازل ويرجع وإنت طالع، وخلفية ملوّنة بتتزحلق للقسم المفتوح
    let lastY = scrollY, acc = 0, dkRaf = 0;
    const dock = () => {
      if (R.dataset.skin !== "nx") return;
      const y = Math.max(0, scrollY), max = Math.max(1, document.documentElement.scrollHeight - innerHeight), d = y - lastY; lastY = y;
      R.style.setProperty("--nxsp", Math.min(1, y / max).toFixed(3));
      if ((d > 0) !== (acc > 0)) acc = 0;   // اتجاه جديد: نبدأ العدّ من الأول
      acc += d;
      const hid = R.classList.contains("nx-dn");
      if (!hid && acc > 36 && y > 120) R.classList.add("nx-dn");
      else if (hid && (acc < -18 || y < 60 || y > max - 24)) R.classList.remove("nx-dn");
    };
    const docks = () => document.querySelectorAll(".ctabs, .nx-dock");
    const activeOf = n => n.querySelector('[aria-selected="true"], [aria-pressed="true"], .on');
    const pillTo = (n, anim) => {
      let p = n.querySelector(":scope > .dk-pill"); const a = activeOf(n);
      if (!p) { p = document.createElement("i"); p.className = "dk-pill na"; n.prepend(p); anim = false; }
      if (!a || innerWidth > 760) return;
      if (!anim) p.classList.add("na");
      p.style.width = a.offsetWidth + "px"; p.style.transform = `translate3d(${a.offsetLeft}px, 0, 0)`;
      if (!anim) { p.offsetWidth; requestAnimationFrame(() => p.classList.remove("na")); }
      const want = a.offsetLeft + a.offsetWidth / 2 - n.clientWidth / 2;
      if (n.scrollWidth > n.clientWidth && Math.abs(n.scrollLeft - want) > 2) { if (anim) n.scrollTo({ left: want, behavior: "smooth" }); else n.scrollLeft = want; }
    };
    // يتنده بعد أي تغيير في الصفحة: الشريط الجديد يتظبط فورًا، ولو القسم اتغيّر الخلفية تتزحلق
    CM.dockSync = () => {
      if (R.dataset.skin !== "nx" || innerWidth > 760) return;
      docks().forEach(n => { const a = activeOf(n), k = a ? (a.dataset.ct || a.dataset.tile || a.dataset.tab || a.dataset.at || a.textContent.trim() || "home") : "";
        if (!n.dataset.dk) { n.dataset.dk = k; pillTo(n, false); }
        else if (n.dataset.dk !== k) { n.dataset.dk = k; pillTo(n, true); } });
    };
    document.addEventListener("click", e => { if (e.target.closest && e.target.closest(".ctabs button, .nx-dock button")) requestAnimationFrame(() => CM.dockSync()); });
    addEventListener("resize", () => docks().forEach(n => pillTo(n, false)));
    document.addEventListener("cm-look", () => docks().forEach(n => { delete n.dataset.dk; }));
    addEventListener("scroll", () => { if (!dkRaf) dkRaf = requestAnimationFrame(() => { dkRaf = 0; dock(); }); if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
    addEventListener("resize", () => requestAnimationFrame(frame));
    let mt = null; const sched = () => { clearTimeout(mt); mt = setTimeout(() => { mark(); CM.dockSync(); }, 40); };
    const start = () => { new MutationObserver(sched).observe(document.body, { childList: true, subtree: true }); sched(); };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    document.addEventListener("cm-look", () => { document.querySelectorAll("[data-nxr]").forEach(e => delete e.dataset.nxr); sched(); });
    // ميل خفيف للكروت مع حركة الماوس
    document.addEventListener("pointermove", e => { if (!on() || e.pointerType !== "mouse") return; const t = e.target.closest && e.target.closest(".tile, .me-card"); if (t) { const r0 = t.getBoundingClientRect(); t.style.setProperty("--mx", (e.clientX - r0.left) + "px"); t.style.setProperty("--my", (e.clientY - r0.top) + "px"); } document.querySelectorAll(".tile[data-tilt], .me-card[data-tilt]").forEach(x => { if (x !== t) { x.style.transform = ""; delete x.dataset.tilt; } });
      if (!t || innerWidth <= 760) return; const r = t.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width - .5, dy = (e.clientY - r.top) / r.height - .5;
      t.dataset.tilt = "1"; t.style.transform = `perspective(700px) rotateX(${(-dy * 6).toFixed(2)}deg) rotateY(${(dx * 8).toFixed(2)}deg) translateY(-4px)`; }, { passive: true });
  })();


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
  CM.iconEcho = d => `<svg class="sb-echo" viewBox="-14 -14 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="23" stroke-width=".25" opacity=".22"/><circle cx="12" cy="12" r="19" stroke-width=".25" opacity=".14" stroke-dasharray="1 1.6"/><g opacity=".34" stroke-width=".9">${d}</g></svg>`;
  CM.band = o => `<section class="sband${o.cls ? " " + o.cls : ""}"${o.id ? ` id="${o.id}"` : ""}>${CM.heroArt()}${o.icon ? CM.iconEcho(o.icon) : ""}<div class="sb-in">${o.icon ? `<span class="sb-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${o.icon}</svg></span>` : ""}<div class="sb-t">${o.eyebrow ? `<div class="sb-eb">${o.eyebrow}</div>` : ""}<h2>${o.title}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}</div>${o.extra ? `<div class="sb-x">${o.extra}</div>` : ""}</div></section>`;
  CM.ICONS = {
    ug: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v5"/>',
    pg: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 17h5"/>',
    share: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
    admin: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  // زجاج سائل: فلتر انكسار خفيف (يعمل في كروم، وغيره يكتفي بالتغبيش)، ولمعة تتبع المؤشر
  (function liquidGlass() {
    if (document.getElementById("lgDefs")) return;
    const put = () => {
      if (document.getElementById("lgDefs") || !document.body) return;
      const d = document.createElement("div"); d.id = "lgDefs"; d.setAttribute("aria-hidden", "true"); d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      d.innerHTML = `<svg width="0" height="0"><filter id="lgRefract" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="4" result="n"/><feGaussianBlur in="n" stdDeviation="2" result="nb"/><feDisplacementMap in="SourceGraphic" in2="nb" scale="64" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
      document.body.appendChild(d);
    };
    if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
    let raf = 0, last = null;
    document.addEventListener("pointermove", e => {
      last = e; if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const el = last.target.closest && last.target.closest(".lg");
        if (!el) return; const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", ((last.clientX - r.left) / r.width * 100).toFixed(1) + "%");
        el.style.setProperty("--my", ((last.clientY - r.top) / r.height * 100).toFixed(1) + "%");
      });
    }, { passive: true });
  })();
  // قائمة منسدلة بسيطة (details/summary): تجمع الأزرار الثانوية تحت زر واحد. تُغلق عند اختيار عنصر أو الضغط خارجها
  /* ================= مركز المساعدة: مساعد بالأسئلة الشائعة + مراسلة الإدارة (b72) ================= */
  // كل عنصر: who (student/staff/all)، q سؤال، k كلمات بحث، a إجابة (HTML بسيط)
  CM.FAQ = [
    { who: "student", q: "إزاي أسجّل حضوري في المحاضرة؟", k: "حضور تسجيل سجل احضر المحاضره بدأت كود رمز qr باركود امسح", a: "أول ما المحاضرة تبدأ هتلاقي فوق خالص في صفحتك «محاضرة جارية الآن». اضغط عليها، وبعدين:<br>• لو المحاضرة في القاعة: اسمح للموقع يعرف مكانك، واكتب الرمز اللي على شاشة المحاضر أو اضغط «امسح رمز QR من الشاشة».<br>• لو أونلاين: اكتب الرمز اللي المحاضر بيقوله.<br>لو الرمز اتقفل أو ماعرفتش تسجّل، كلّم المعيد يسجّلك يدويًا." },
    { who: "student", q: "بيقولي «الحساب مرتبط بهاتف آخر»", k: "مرتبط هاتف اخر تليفون جديد غيرت موبايل جهاز تاني متصفح اخر نقل الحساب", a: "حسابك مربوط بموبايل واحد عشان محدش يسجّل حضور مكانك.<br>• لو مفعّل الدخول بالبصمة: اضغط «الدخول ببصمة الوجه أو الإصبع» وهيتنقل على طول.<br>• لو غيّرت موبايلك: ادخل بكلمة السر من الموبايل الجديد واطلب نقل الحساب، أو اطلب من المعيد «فك ربط الهاتف».<br>• لو عايز تسلّم تكليف من الكمبيوتر بس: اختار «ادخل لتسليم التكليفات فقط»." },
    { who: "student", q: "نسيت كلمة السر", k: "نسيت كلمه السر باسورد الباسورد مش فاكر استعادة تغيير", a: "في صفحة الدخول اضغط «نسيت كلمة السر؟» واختار طريقة من دول: نفس الموبايل المربوط، أو البصمة، أو حساب Google اللي سلّمت بيه قبل كده، أو موافقة المعيد (هيظهرلك رقم تحقق تقوله للمعيد)." },
    { who: "student", q: "الموقع بيقول «لا يوجد اتصال» والنت شغال", k: "نت انترنت اتصال لا يوجد مش بيحمل بيحمل واقف ايفون سفاري خطأ مشكلة الموقع مش شغال", a: "• استنى ثواني، الموقع بيعيد المحاولة لوحده كل 5 ثواني.<br>• حدّث الصفحة.<br>• على الآيفون: افتح الموقع من أيقونته على الشاشة الرئيسية مش من Safari.<br>• جرّب تقفل الـ VPN أو أي برنامج حجب، أو جرّب Wi-Fi بدل الداتا (أو العكس).<br>• لو لسه، جرّب متصفح تاني (Chrome)." },
    { who: "all", q: "إزاي أفعّل الإشعارات؟", k: "اشعارات اشعار تنبيهات نوتفكيشن تفعيل مش بيوصلني", a: "اضغط «تفعيل الإشعارات» واختار «سماح».<br>• على الآيفون: لازم الأول تضيف الموقع للشاشة الرئيسية (زر المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية»)، وتفتحه من الأيقونة، وبعدين تفعّل.<br>• لو رفضتها قبل كده: من إعدادات المتصفح ← إعدادات المواقع ← الإشعارات، اسمح لـ Hadro." },
    { who: "all", q: "إزاي أضيف الموقع للشاشة الرئيسية؟", k: "شاشة رئيسية ايقونة تطبيق تنزيل تثبيت ابلكيشن home screen", a: "• آيفون (Safari): زر المشاركة ⬆︎ تحت ← «إضافة إلى الشاشة الرئيسية» ← «إضافة».<br>• أندرويد (Chrome): القائمة ⋮ ← «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».<br>بعدها افتح Hadro دايمًا من الأيقونة: أسرع، ومابيخرجكش من حسابك، والإشعارات بتشتغل." },
    { who: "student", q: "إزاي أسلّم تكليف؟", k: "تسليم سلم تكليف مشروع رفع ملف صوره درايف google drive", a: "افتح المادة ← التكليف ← اختار الملف. الملف بيترفع على Google Drive بتاعك ويتبعت للمعيد. لو نافذة Google قفلت أو ماكملتش، اضغط «جرّب طريقة أخرى» أو «سلّم رابطًا بدلًا من ذلك» وحط رابط الملف." },
    { who: "student", q: "تسليمي مكتوب عليه «متأخر» أو «مرفوض»", k: "متاخر مرفوض غائب يوم الطرح عذر", a: "«متأخر» معناه إنك سلّمت بعد الموعد أو كنت غايب يوم طرح المشروع. «مرفوض» معناه إن التكليف مابيقبلش تسليم الغايب إلا بعذر. لو عندك عذر كلّم المعيد، يقدر يقبله أو يفتحلك تسليم استثنائي." },
    { who: "student", q: "أعرف غيابي وإنذاراتي منين؟", k: "غياب انذار انذارات كام مرة غبت حرمان انسحاب", a: "افتح المادة من صفحتك هتلاقي عدد مرات غيابك ومستوى الإنذار. الإنذارات بالترتيب: أول، ثانٍ، ثالث ونهائي، وبعدها انسحاب إجباري من المادة. وبيوصلك إشعار أول ما توصل لإنذار جديد." },
    { who: "student", q: "إزاي أتظلّم على درجة؟", k: "تظلم درجه غلط مرصوده مترصدتش اعتراض", a: "افتح التكليف بعد إعلان الدرجات ← «تظلم على الدرجة» ← اختار السبب ← ارفع صورة المشروع باين فيها اسمك ودرجتك ← «إرسال التظلم». هيوصلك إشعار بالقبول أو الرفض. التظلم متاح بس وباب التظلم مفتوح (المعيد بيحدد مهلته)." },
    { who: "student", q: "درجتي مش ظاهرة", k: "درجه درجتي مش ظاهره الدرجات فين نتيجه", a: "الدرجات بتظهر بعد ما المعيد «يعلنها». لو اتعلنت ودرجتك مش موجودة رغم إنك سلّمت، قدّم تظلم واختار «سلّمت ولم تُرصد»." },
    { who: "student", q: "ليه الموقع بيطلب مكاني (الموقع الجغرافي)؟", k: "موقع جغرافي لوكيشن gps مكاني القاعة بعيد", a: "في محاضرات القاعة الموقع بيتأكد إنك في الكلية فعلًا. اسمح بالموقع وشغّل GPS. لو قالك إنك بعيد وأنت في القاعة، استنى ثواني لحد ما الدقة تتحسن أو اطلع جنب الشباك، أو اطلب من المعيد يسجّلك." },
    { who: "staff", q: "إزاي أبدأ محاضرة؟", k: "ابدا محاضره جديده بدء حضور قاعه اونلاين رمز", a: "افتح المادة ← «المحاضرة» ← اختار المجموعة ونوعها (قاعة أو أونلاين) ← «ابدأ المحاضرة». هيظهر رمز وQR تعرضهم على الشاشة. لما تخلّص اضغط «إغلاق التسجيل» وبعدين إنهاء المحاضرة (ده اللي بيبعت إشعارات الإنذار للطلبة)." },
    { who: "staff", q: "طالب مش عارف يسجّل حضور", k: "طالب مش عارف يسجل يدوي حضرته تحضير غائب", a: "من «الكشف» دوس على خانة الطالب في المحاضرة وسجّله يدويًا، أو من شاشة المحاضرة الجارية. ولو موبايله مربوط غلط، من «الطلبة» اختار «فك ربط الهاتف»." },
    { who: "staff", q: "إزاي أضيف طلبة أو أستورد كشف؟", k: "اضافه طلبه طالب كشف استيراد اكسل قائمه", a: "من «الطلبة» ← «إضافة طالب» لطالب واحد، أو استورد كشف إكسل فيه الكود والاسم والمجموعة." },
    { who: "staff", q: "إزاي أعمل تكليف وأرصد الدرجات؟", k: "تكليف جديد رصد درجات مشروع تسليم اعلان", a: "«التكليفات» ← «تكليف أو رصد جديد». بعد التسليم افتح التكليف واكتب الدرجات (أو «رصد بالصوت» أو «رفع درجات» من إكسل)، واضغط «حفظ الدرجات»، وبعدين «إعلان» عشان الطلبة يشوفوها." },
    { who: "staff", q: "إزاي أصدّر كشف الكنترول؟", k: "تصدير كشف الكنترول اكسل pdf طباعه درجات مجموعه", a: "«التكليفات» ← «تصدير واستيراد» ← اختار المجموعة ← إكسل أو PDF." },
    { who: "staff", q: "إزاي أتحكم في مهلة التظلم؟", k: "مهله تظلم فتح قفل اغلاق تظلمات", a: "افتح التكليف، هتلاقي شريط «باب التظلم». تقدر تقفله، أو تفتحه لمدة (يوم/يومين/3 أيام/أسبوع)، أو «حدّد موعد الفتح والإغلاق». التظلمات بتظهر في نفس الصفحة بـ «قبول ورصد الدرجة» أو «رفض التظلم»." },
    { who: "staff", q: "إزاي أقسّم الطلبة على مجموعات؟", k: "تقسيم مجموعات مجموعه جروب أ ب", a: "«الطلبة» ← «تقسيمهم تلقائيًا» (للطلبة اللي من غير مجموعة) أو «إعادة تقسيم المجموعات» (للكل). تختار العدد والتسمية والترتيب." },
    { who: "staff", q: "الطلبة اللي عندهم إنذارات", k: "انذارات طلبه انذار تنبيه ابلاغ", a: "هتلاقي تنبيه في الرئيسية وفي «التقرير». تقدر «إرسال تنبيه للطلاب» (إشعار على موبايلاتهم)، أو تنزّل الكشف، أو تنسخ نص إعلان للجروب." },
    { who: "staff", q: "إزاي أضيف معيد للمادة؟", k: "اضافه معيد فريق محاضر مشارك", a: "من «الفريق» في المادة اكتب بريده الجامعي. لازم يكون عنده حساب الأول؛ لو ماعندوش، يطلب حساب من صفحة الدخول («طلب حساب جديد») والمسؤول يوافق." },
    { who: "staff", q: "نسيت كلمة السر (هيئة التدريس)", k: "نسيت كلمه السر باسورد معيد محاضر دخول", a: "في صفحة الدخول اختار «نسيت كلمة السر»، واكتب كلمة سر جديدة، وهيوصلك رمز على بريدك الجامعي تكتبه. لو الرمز ماوصلش، راجع البريد غير المرغوب أو اطلب من المسؤول «كلمة سر مؤقتة»." }
  ];
  CM.normAr = x => String(x || "").toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ًٌٍَُِّْـ]/g, "").replace(/[؟?!.,،:«»"()]/g, " ").replace(/\s+/g, " ").trim();
  CM.faqSearch = (q, who) => {
    const words = CM.normAr(q).split(" ").filter(w => w.length > 1 && !["ازاي", "اعمل", "عايز", "ممكن", "انا", "في", "من", "علي", "على", "مش", "ليه", "هو", "دي", "ده"].includes(w));
    const list = CM.FAQ.filter(f => f.who === "all" || f.who === who);
    if (!words.length) return list.slice(0, 6);
    return list.map(f => { const hay = CM.normAr(f.q + " " + f.k); let s = 0; words.forEach(w => { if (hay.includes(w)) s += 2; else if (w.length > 3 && hay.includes(w.slice(0, -1))) s += 1; else if (w.length > 4 && hay.includes(w.slice(1))) s += 1; }); return [s, f]; })
      .filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, f]) => f);
  };

  // إشعارات الهاتف: حالة الدعم، والاشتراك
  CM.pushState = () => {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const sa = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));
    const vapid = (window.CLASSMATE || {}).VAPID_PUBLIC_KEY;
    if (ios && !sa) return "ios-install";
    if (!vapid || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "none";
    if (Notification.permission === "denied") return "denied";
    return Notification.permission === "granted" ? "granted" : "ask";
  };
  CM.pushSubscribe = async () => {
    const vapid = (window.CLASSMATE || {}).VAPID_PUBLIC_KEY;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw { message: perm === "denied" ? "الإشعارات مرفوضة. اسمح بها من إعدادات المتصفح للموقع ثم أعد المحاولة." : "لم تُفعَّل الإشعارات. اضغط «سماح» عندما يسألك المتصفح." };
    const reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(vapid.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return sub.toJSON();
  };
  CM.IOS_STEPS = `<ol class="pg-steps"><li>اضغط زر المشاركة <b>⬆︎</b> أسفل Safari.</li><li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ثم «إضافة».</li><li>افتح <b>Hadro</b> من الأيقونة الجديدة وأكمل من هناك.</li></ol>`;

  // نافذة المساعدة: who = student | staff ، api = { list(), create(cat, subject, body, course), reply(id, body) } ، courses = [{id, name}]
  const HC_CATS = { question: "استفسار", problem: "مشكلة في الموقع", complaint: "شكوى", suggestion: "اقتراح" };
  const HC_ST = { open: ["بانتظار الرد", "warn"], answered: ["تم الرد", "ok"], closed: ["مغلقة", "none"] };
  CM.helpCenter = (o) => {
    const esc = CM.esc;
    const st = { tab: o.tab || "ask", q: "", items: null, open: null, busy: false, msg: "", form: { cat: "question", subject: "", body: "", course: "" } };
    let el = document.getElementById("hcBox"); if (el) el.remove();
    el = document.createElement("div"); el.id = "hcBox"; el.className = "hc"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "المساعدة");
    document.body.appendChild(el); document.body.classList.add("hc-on");
    const close = () => { if (st.tab === "ask") { clearTimeout(st.lt); logQ(false); } el.remove(); document.body.classList.remove("hc-on"); if (o.onClose) o.onClose(); };
    const load = async () => { try { st.items = await o.api.list(); } catch (e) { st.items = st.items || []; st.msg = CM.errText(e); } draw(); if (o.onRead) o.onRead(); };
    const fmt = d => new Date(d).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    function faqHtml() {
      const res = CM.faqSearch(st.q, o.who);
      return `<div class="hc-ask"><div class="hc-bot"><span class="hc-av">${CM.ICONS ? "" : ""}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5"/></svg></span><p>أهلًا! أنا مساعد Hadro. اكتب سؤالك بكلامك، وهطلعلك الإجابة.</p></div>
        <input type="search" id="hcQ" value="${esc(st.q)}" placeholder="مثلًا: نسيت كلمة السر، إزاي أسجل حضوري…" autocomplete="off" aria-label="سؤالك">
        <div class="hc-res">${res.length ? res.map((f, i) => `<details class="hc-faq" ${st.q && i === 0 ? "open" : ""}><summary>${esc(f.q)}</summary><div>${f.a}</div></details>`).join("") : `<p class="small muted">مالقيتش إجابة جاهزة لسؤالك.</p>`}</div>
        <div class="hc-more"><span class="small muted">مالقيتش اللي بتدور عليه؟</span>${o.api ? `<button class="btn sm primary" data-hct="new">راسل الإدارة</button>` : `<span class="small">${o.loginHint || "سجّل دخولك الأول عشان تقدر تراسل الإدارة."}</span>`}</div></div>`;
    }
    function newHtml() {
      const f = st.form;
      return `<div class="hc-new">
        <div class="hc-cats" role="radiogroup" aria-label="نوع الرسالة">${Object.entries(HC_CATS).map(([k, l]) => `<button type="button" class="cchip" role="radio" aria-pressed="${f.cat === k}" data-hcc="${k}">${l}</button>`).join("")}</div>
        ${(o.courses || []).length ? `<label class="f"><span>تخص مادة؟ (اختياري)</span><select id="hcCourse"><option value="">لا تخص مادة بعينها</option>${o.courses.map(c => `<option value="${c.id}" ${f.course === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
        <label class="f"><span>العنوان</span><input id="hcSubj" maxlength="120" value="${esc(f.subject)}" placeholder="جملة قصيرة توضح الموضوع"></label>
        <label class="f"><span>التفاصيل</span><textarea id="hcBody" rows="5" maxlength="3000" placeholder="اكتب المشكلة أو الاقتراح بالتفصيل: حصل إيه، وإمتى، وعلى أنهي جهاز…">${esc(f.body)}</textarea></label>
        ${st.msg ? `<p class="small bad-t">${esc(st.msg)}</p>` : ""}
        <div class="row"><button class="btn primary" id="hcSend" ${st.busy ? "disabled" : ""}>${st.busy ? "جارٍ الإرسال…" : "إرسال الرسالة"}</button></div>
        <p class="small muted">هيوصلك إشعار لما المسؤول يرد، وتلاقي الرد في «رسائلي».</p></div>`;
    }
    function listHtml() {
      if (!st.items) return `<p class="small muted">جارٍ التحميل…</p>`;
      if (st.open) {
        const t = st.items.find(x => x.id === st.open); if (!t) { st.open = null; return listHtml(); }
        return `<div class="hc-th"><button class="btn sm ghost" data-hcback>→ كل رسائلي</button>
          <div class="hc-th-h"><b>${esc(t.subject)}</b><span class="chip ${HC_ST[t.status][1]}">${HC_ST[t.status][0]}</span></div>
          <p class="small muted">${HC_CATS[t.category]}${t.course ? " · " + esc(t.course) : ""}</p>
          <div class="hc-msgs">${t.msgs.map(m => `<div class="hc-m ${m.admin ? "adm" : "me"}"><small>${m.admin ? esc(m.author || "المسؤول") : "أنت"} · ${fmt(m.at)}</small><p>${esc(m.body).replace(/\n/g, "<br>")}</p></div>`).join("")}</div>
          ${t.status === "closed" ? `<p class="small muted">أُغلقت هذه المحادثة. لو عندك موضوع جديد ابعت رسالة جديدة.</p>` : `<label class="f"><span>ردّك</span><textarea id="hcRe" rows="3" maxlength="3000"></textarea></label>${st.msg ? `<p class="small bad-t">${esc(st.msg)}</p>` : ""}<div class="row"><button class="btn sm primary" id="hcReSend" ${st.busy ? "disabled" : ""}>إرسال</button></div>`}</div>`;
      }
      if (!st.items.length) return `<div class="empty small">لسه مابعتش رسائل. <button class="linkish" data-hct="new">ابعت أول رسالة</button></div>`;
      return `<div class="hc-list">${st.items.map(t => `<button class="hc-it ${t.unread ? "unread" : ""}" data-hco="${t.id}"><span><b>${esc(t.subject)}</b><small>${HC_CATS[t.category]} · ${fmt(t.updated_at)}</small></span><span class="chip ${HC_ST[t.status][1]}">${HC_ST[t.status][0]}</span></button>`).join("")}</div>`;
    }
    function draw() {
      const unread = (st.items || []).filter(t => t.unread).length;
      el.innerHTML = `<div class="hc-c">
        <div class="hc-h"><b>المساعدة والتواصل</b><button class="btn sm ghost icon" id="hcX" aria-label="إغلاق">✕</button></div>
        ${o.api ? `<div class="hc-tabs" role="tablist">${[["ask", "اسأل المساعد"], ["new", "راسل الإدارة"], ["list", "رسائلي" + (unread ? ` <i class="hc-dot">${unread}</i>` : "")]].map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" data-hct="${k}">${l}</button>`).join("")}</div>` : ""}
        <div class="hc-b">${st.tab === "ask" ? faqHtml() : st.tab === "new" ? newHtml() : listHtml()}</div></div>`;
      wire();
    }
    function wire() {
      $$("#hcX").forEach(b => b.onclick = close);
      el.onclick = e => { if (e.target === el) close(); };
      el.querySelectorAll("[data-hct]").forEach(b => b.onclick = () => { if (b.dataset.hct === "new" && st.tab === "ask") { clearTimeout(st.lt); logQ(true); } st.tab = b.dataset.hct; st.msg = ""; st.open = null; if (st.tab === "list" && !st.items) load(); draw(); if (st.tab === "new") { const s = document.getElementById("hcSubj"); if (s && st.q && !st.form.subject) { s.value = st.q; st.form.subject = st.q; } } });
      const q = document.getElementById("hcQ"); if (q) { q.oninput = () => { st.q = q.value; clearTimeout(st.lt); st.lt = setTimeout(() => logQ(false), 1800); const r = el.querySelector(".hc-res"); const tmp = document.createElement("div"); tmp.innerHTML = faqHtml(); r.replaceWith(tmp.querySelector(".hc-res")); }; if (st.tab === "ask" && matchMedia("(min-width:700px)").matches) q.focus(); }
      el.querySelectorAll("[data-hcc]").forEach(b => b.onclick = () => { st.form.cat = b.dataset.hcc; el.querySelectorAll("[data-hcc]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
      const sj = document.getElementById("hcSubj"); if (sj) sj.oninput = () => { st.form.subject = sj.value; };
      const bd = document.getElementById("hcBody"); if (bd) bd.oninput = () => { st.form.body = bd.value; };
      const cs = document.getElementById("hcCourse"); if (cs) cs.onchange = () => { st.form.course = cs.value; };
      const sd = document.getElementById("hcSend"); if (sd) sd.onclick = async () => {
        const f = st.form; if (f.subject.trim().length < 3) { st.msg = "اكتب عنوانًا من 3 حروف على الأقل."; return draw(); } if (f.body.trim().length < 10) { st.msg = "اكتب التفاصيل (10 حروف على الأقل)."; return draw(); }
        st.busy = true; st.msg = ""; draw();
        try { const id = await o.api.create(f.cat, f.subject.trim(), f.body.trim(), f.course || null); st.form = { cat: "question", subject: "", body: "", course: "" }; st.busy = false; st.tab = "list"; await load(); st.open = id; draw(); }
        catch (e) { st.busy = false; st.msg = CM.errText(e); draw(); }
      };
      el.querySelectorAll("[data-hco]").forEach(b => b.onclick = () => { st.open = b.dataset.hco; st.msg = ""; draw(); const m = el.querySelector(".hc-msgs"); if (m) m.scrollTop = m.scrollHeight; });
      el.querySelectorAll("[data-hcback]").forEach(b => b.onclick = () => { st.open = null; draw(); });
      const rs = document.getElementById("hcReSend"); if (rs) rs.onclick = async () => {
        const v = (document.getElementById("hcRe").value || "").trim(); if (v.length < 2) return;
        st.busy = true; st.msg = ""; draw();
        try { await o.api.reply(st.open, v); st.busy = false; await load(); } catch (e) { st.busy = false; st.msg = CM.errText(e); draw(); }
      };
    }
    const $$ = s => el.querySelectorAll(s);
    // نسجّل السؤال (بدون أي بيانات شخصية) لنعرف ما يجيب عنه المساعد وما ينقصه
    function logQ(esc) {
      const v = (st.q || "").trim(); if (v.length < 3) return;
      const key = v + "|" + esc; if (st.logged === key) return; st.logged = key;
      const r = CM.faqSearch(v, o.who); CM.rpc("faq_log_add", { p_who: o.who, p_q: v, p_hits: r.length, p_top: r[0] ? r[0].q : "", p_escalated: !!esc }).catch(() => {});
    }
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape" && document.getElementById("hcBox")) { close(); document.removeEventListener("keydown", k); } });
    if (!o.api) st.tab = "ask";
    draw(); if (!o.api) return { close }; if (st.tab === "list") load(); else o.api.list().then(r => { st.items = r; if (st.tab === "list") draw(); else { const t = el.querySelector('[data-hct="list"]'); const n = r.filter(x => x.unread).length; if (t && n) t.innerHTML = `رسائلي <i class="hc-dot">${n}</i>`; } }).catch(() => {});
    return { close };
  };

  CM.dd = (label, items, o = {}) => items.filter(Boolean).length ? `<details class="dd${o.end ? " end" : ""}${o.cls ? " " + o.cls : ""}"><summary class="btn sm${o.primary ? " primary" : ""}${o.ghost ? " ghost" : ""}"${o.title ? ` title="${o.title}"` : ""}>${label}<svg class="dd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary><div class="dd-m" role="menu">${items.filter(Boolean).join("")}</div></details>` : "";
  document.addEventListener("click", e => {
    document.querySelectorAll("details.dd[open]").forEach(d => {
      if (!d.contains(e.target)) d.open = false;
      else if (e.target.closest(".dd-m") && e.target.closest("button, a") && !e.target.closest("[data-keep]")) setTimeout(() => { d.open = false; }, 0);
    });
  });
  // أبقِ القائمة داخل حدود الشاشة (على الموبايل أي جزء خارج الشاشة يصغّر الصفحة كلها)
  document.addEventListener("toggle", e => {
    const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("dd") || !d.open) return;
    const m = d.querySelector(".dd-m"); if (!m) return;
    m.style.translate = ""; const r = m.getBoundingClientRect(), W = document.documentElement.clientWidth;
    const dx = r.left < 8 ? 8 - r.left : r.right > W - 8 ? W - 8 - r.right : 0;
    if (dx) m.style.translate = Math.round(dx) + "px 0";
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll("details.dd[open]").forEach(d => { d.open = false; }); });
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
    f.innerHTML = `<span><b>${A.name}</b> · ${A.title} · الإصدار ${A.version} <span class="muted" dir="ltr" style="font-size:.8em">(b87)</span></span><span>${CM.copyright()}</span><button type="button" class="linkish" data-about>عن البرنامج وحقوق الملكية</button>`;
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
