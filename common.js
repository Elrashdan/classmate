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
  CM.fmtT = t => new Date(t).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
  CM.fmtD = t => new Date(t).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short" });
  CM.mmss = ms => { ms = Math.max(0, ms); const m = Math.floor(ms / 6e4), s = Math.floor(ms % 6e4 / 1000); return m + ":" + String(s).padStart(2, "0"); };
  CM.dist = m => m == null ? "" : m >= 1000 ? (m / 1000).toFixed(1) + " كم" : m + " م";
  // سحب العنصر يمين أو شمال لحذفه (اللمس والماوس)
  CM.swipeDel = function (root, onDel) {
    root.querySelectorAll("[data-sw]").forEach(el => {
      let x0 = null, y0 = 0, dx = 0, on = false, id = null;
      el.addEventListener("pointerdown", e => { if (e.button > 0 || e.target.closest("button,a,select,input")) return; x0 = e.clientX; y0 = e.clientY; dx = 0; on = false; id = e.pointerId; });
      el.addEventListener("pointermove", e => { if (x0 == null || e.pointerId !== id) return; const mx = e.clientX - x0, my = e.clientY - y0;
        if (!on) { if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { x0 = null; return; } if (Math.abs(mx) < 10) return; on = true; el.classList.add("sw-on"); try { el.setPointerCapture(id); } catch (er) {} }
        dx = mx; el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(Math.max(.25, 1 - Math.abs(dx) / 260)); });
      const end = () => { if (x0 == null) return; x0 = null; if (!on) return; on = false; el.classList.remove("sw-on");
        if (Math.abs(dx) > Math.min(110, el.offsetWidth * .3)) { el.style.transition = "transform .18s, opacity .18s"; el.style.transform = `translateX(${dx > 0 ? "" : "-"}110%)`; el.style.opacity = "0"; setTimeout(() => onDel(el.dataset.sw, el), 170); }
        else { el.style.transition = "transform .18s, opacity .18s"; el.style.transform = ""; el.style.opacity = ""; setTimeout(() => el.style.transition = "", 200); } };
      el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
      el.addEventListener("click", e => { if (Math.abs(dx) > 10) { e.preventDefault(); e.stopPropagation(); dx = 0; } }, true);
    });
  };
  // الجداول اللي بتتسحب بالعرض: علامة عشان الـCSS يبيّن إن فيه باقي
  (function () {
    const mark = w => { const can = w.scrollWidth > w.clientWidth + 4; w.classList.toggle("can-x", can); if (can) w.classList.toggle("at-end", Math.abs(w.scrollLeft) + w.clientWidth >= w.scrollWidth - 6); };
    let t = 0; const all = () => { clearTimeout(t); t = setTimeout(() => document.querySelectorAll(".tbl-wrap").forEach(mark), 180); };
    document.addEventListener("scroll", e => { const w = e.target; if (w && w.classList && w.classList.contains("tbl-wrap")) mark(w); }, true);
    addEventListener("resize", all);
    document.addEventListener("DOMContentLoaded", () => { try { new MutationObserver(all).observe(document.body, { childList: true, subtree: true }); } catch (e) {} all(); });
  })();
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
  // b178: العدد والمعدود في كل البرنامج: CM.n(8, CM.W.student) → «8 طلاب»، CM.n(15, CM.W.hour) → «15 ساعة»
  // الصيغ: [مفرد، مثنى، جمع (3–10)، تمييز (11+)]. الصفر والمفرد بالرقم، والمثنى بالكلمة بس.
  CM.n = (n, w) => { n = +n || 0; const [one, two, few, many] = w; const k = Math.abs(n) % 100; return n === 2 ? two : n === 1 || n === 0 ? n + " " + one : k >= 3 && k <= 10 ? n + " " + few : n + " " + many; };
  CM.W = {
    student: ["طالب", "طالبين", "طلاب", "طالبًا"], course: ["مادة", "مادتين", "مواد", "مادة"], hour: ["ساعة", "ساعتين", "ساعات", "ساعة"],
    minute: ["دقيقة", "دقيقتين", "دقائق", "دقيقة"], day: ["يوم", "يومين", "أيام", "يومًا"], task: ["تكليف", "تكليفين", "تكليفات", "تكليفًا"],
    lecture: ["محاضرة", "محاضرتين", "محاضرات", "محاضرة"], absent: ["غائب", "غائبين", "غائبين", "غائبًا"], account: ["حساب", "حسابين", "حسابات", "حسابًا"],
    period: ["فترة", "فترتين", "فترات", "فترة"], grade: ["درجة", "درجتين", "درجات", "درجة"], credit: ["ساعة معتمدة", "ساعتين معتمدتين", "ساعات معتمدة", "ساعة معتمدة"],
    group: ["مجموعة", "مجموعتين", "مجموعات", "مجموعة"], attempt: ["محاولة", "محاولتين", "محاولات", "محاولة"], warning: ["إنذار", "إنذارين", "إنذارات", "إنذارًا"]
  };
  CM.lvlChip = i => `<span class="chip ${CM.WARN[i].k}">${CM.WARN[i].t}</span>`;
  CM.nextWarn = n => { const l = CM.lvl(n); return l >= 4 ? "" : (CM.THR[l] - n === 1 ? "غياب آخر = " : `بعد ${CM.THR[l] - n} غيابات: `) + CM.WARN[l + 1].t; };

  // server errors -> Arabic
  const ERR = {
    not_allowed: "غير مسموح لك بهذا الإجراء.",
    not_found: "تعذّر العثور على هذه البيانات، وربما تغيّرت. حدّث الصفحة.",
    session_running: "توجد محاضرة جارية في هذه المادة. أنهِها أولًا.",
    session_exists: "توجد محاضرة مسجّلة في هذا التاريخ للمجموعة نفسها. اضغط تاريخها في الكشف وعلّمها إجازة من هناك.",
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
    form_required: "يكون التسجيل الأول على Hadro باستمارة التسجيل (الإرشاد الأكاديمي). اختر «إنشاء حساب» وارفع الاستمارة.",
    no_courses: "اختر مقررًا واحدًا على الأقل.",
    already_registered: "يوجد حساب بهذا الكود من قبل. ادخل من «دخول». إذا لم تكن أنت من أنشأه، فاطلب من المحاضر حذف الحساب.",
    weak_password: "يجب ألا تقل كلمة السر عن 6 أحرف.",
    bad_pin: "رمز التفعيل غير صحيح.",
    not_registered: "لا يوجد حساب بهذا الكود. أنشئ حسابًا من «إنشاء حساب».",
    bad_password: "كلمة السر غير صحيحة. إن كنت متأكدًا منها، فجرّب «نسيت كلمة السر؟» بالأسفل.",
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
    locked: "محاولات خاطئة كثيرة على هذا الحساب. انتظر ربع ساعة ثم حاول مرة أخرى، أو اطلب من المحاضر «فك القفل».",
    not_signed_in: "انتهت جلستك. سجّل الدخول مرة أخرى.",
    bad_device: "المتصفح لا يحفظ البيانات. أغلق وضع التصفح الخفي وأعد المحاولة.",
    title_required: "اكتب عنوان التكليف.",
    due_required: "حدّد موعد التسليم.",
    bad_late: "اختر ما يحدث بعد موعد التسليم.",
    max_below_grades: "لا يمكن جعل الدرجة العظمى أقل من درجة رُصدت بالفعل لأحد الطلبة.",
    appeal_not_released: "لا يمكن التظلم قبل إعلان الدرجات.", appeal_note: "اكتب سبب التظلم.", appeal_photo: "أرفق صورة المشروع.", appeal_open: "لديك تظلم قيد المراجعة في هذا التكليف.", appeal_limit: "وصلت إلى الحد الأقصى للتظلمات في هذا التكليف (3).", appeal_decided: "تم البت في هذا التظلم بالفعل.", appeal_reply: "اكتب سبب الرفض.", bad_reason: "اختر سبب التظلم.", bad_groups: "أسماء المجموعات غير صالحة (من 2 إلى 12 اسمًا مختلفًا).", no_ungrouped: "كل الطلبة موزَّعون على مجموعات بالفعل.", appeal_closed: "باب التظلم مغلق في هذا التكليف.", remind_wait: "ذكّرت الفريق بهذا منذ أقل من 6 ساعات. انتظر قليلًا أو افتح المادة وتصرّف بنفسك.", remind_done: "تم التعامل مع هذا العنصر بالفعل.", bad_window: "اختر موعد إغلاق بعد موعد الفتح (حتى 120 يومًا).", bad_mode: "اختيار غير صالح.",
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
    survey_closed: "أُغلق هذا الاستطلاع.", survey_required: "الإجابة عن هذا الاستطلاع مطلوبة.", survey_consent: "علّم على الموافقة على المشاركة الأول.", bad_answers: "في مشكلة في الإجابات، راجعها.",
    petition_sick_file: "العذر المرضي لازم ترفع معاه الشهادة الطبية.", petition_note: "اكتب سبب الالتماس.", petition_open: "لديك التماس على هذا التكليف قيد المراجعة.", petition_limit: "استنفدت عدد الالتماسات المسموح به على هذا التكليف.", petition_not_needed: "التسليم مفتوح لك بالفعل، فسلّم مباشرة.", bad_until: "يجب أن يكون الموعد بعد الآن وخلال 60 يومًا.", appeal_reply: "اكتب السبب.",
    minus_range: "قيمة الخصم لازم تكون أكبر من صفر ومتزيدش عن الدرجة العظمى للتكليف.",
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
    ticket_closed: "أُغلقت هذه المحادثة. أرسل رسالة جديدة.",
    bad_subscription: "تعذّر تفعيل الإشعارات على هذا المتصفح.",
    bad_role: "اختر الصفة.",
    uni_email: "اكتب بريدك الجامعي (المنتهي بـ ‎.edu.eg).",
    tt_exists: "يوجد جدول للعام والفصل نفسيهما بالفعل. اختره من القائمة.",
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
  // b167: لما نعرف أقصى عدد ممكن للصفوف، نطلب كل الصفحات مرة واحدة بالتوازي بدل واحدة ورا التانية
  CM.fetchPages = async (build, maxRows) => {
    const step = 1000, n = Math.max(1, Math.ceil((maxRows || 0) / step));
    if (n > 20) return CM.fetchAll(build);
    const res = await Promise.all(Array.from({ length: n }, (_, i) => build().range(i * step, i * step + step - 1)));
    const out = []; for (const r of res) { if (r.error) throw r.error; out.push(...r.data); }
    if (res[n - 1].data.length === step) { const more = await CM.fetchAll(() => build().range(n * step, 1e9)); out.push(...more); }
    return out;
  };
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
  CM.BUILD = "(b182)"; // رقم النسخة: بيظهر في «عن البرنامج» بس
  CM.theme = () => { const t = CM.store.get("cm_theme"); return t === "light" || t === "dark" ? t : "auto"; };
  const applyTheme = () => {
    const t = CM.theme(), root = document.documentElement;
    if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
    const dark = t === "dark" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.content = dark ? "#0e1513" : "#1d6b58";
    document.querySelectorAll("[data-theme-btn]").forEach(b => { b.innerHTML = ICONS[t]; b.title = "الثيم: " + THEMES[t] + " (اضغط للتغيير)"; b.setAttribute("aria-label", b.title); });
  };
  const LOOK_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7" r="1.2" fill="currentColor"/></svg>';
  CM.themeBtn = () => `<button class="btn sm ghost icon" data-look-btn data-cap="المظهر" title="المظهر: فاتح أو غامق، وشكل الواجهة وألوانها" aria-label="المظهر">${LOOK_ICO}</button>`;
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
    { id: "lime", n: "ليموني", c: ["#f5f6f1", "#d4f23b", "#121614"] },
    { id: "hadro", n: "Hadro", c: ["#eef2f0", "#9fe3c8", "#122320"] },
    { id: "sun", n: "برتقالي", c: ["#efebe6", "#ff8a3d", "#1b1712"] },
    { id: "violet", n: "بنفسجي", c: ["#ecebf3", "#b9a6ff", "#17142a"] },
    { id: "sky", n: "سماوي", c: ["#e8edf3", "#7cc8ff", "#0f1a2b"] },
    { id: "rose", n: "وردي", c: ["#f3eaee", "#ff9ec4", "#1d1418"] },
    { id: "sand", n: "رملي", c: ["#efe8dc", "#e9c46a", "#23201a"] },
    { id: "mint", n: "نعناعي", c: ["#e9f0ec", "#5fe3a1", "#0b1d16"] }
  ];
  const lookGet = () => { let o = {}; try { o = JSON.parse(CM.store.get("cm_look") || "{}") || {}; } catch (e) {} return { skin: o.skin === "classic" ? "classic" : "nx", pal: o.pal || "lime", own: Array.isArray(o.own) && o.own.length === 3 ? o.own : null, motion: o.motion !== false }; };
  const lookSet = o => { CM.store.set("cm_look", JSON.stringify(o)); applyLook(); };
  // أرقام عربي/فارسي → إنجليزي، وشيل علامات الاتجاه المخفية اللي بيحطها كيبورد الموبايل
  CM.normDigits = v => String(v == null ? "" : v).replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 1632).replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 1776).trim();
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
        <div class="ap-sec"><span>فاتح ولا غامق</span><div class="ap-th">${["light", "dark", "auto"].map(t => `<button type="button" class="ap-thb" data-apt="${t}" aria-pressed="${CM.theme() === t}">${ICONS[t]}<b>${THEMES[t]}</b></button>`).join("")}</div></div>
        <div class="ap-sec"><span>شكل الواجهة</span><div class="ap-skins">
          <button type="button" class="ap-skin" data-aps="classic" aria-pressed="${L.skin === "classic"}">${prev(null, false)}<b>Hadro الكلاسيكي</b><small>الشكل المعتاد بالأخضر والزجاج</small></button>
          <button type="button" class="ap-skin" data-aps="nx" aria-pressed="${L.skin === "nx"}">${prev(c, true)}<b>الواجهة الحديثة</b><small>كروت كبيرة، شريط داكن، وحركة مع التمرير</small></button></div></div>
        <div class="ap-sec${L.skin === "nx" ? "" : " ap-dis"}"><span>ألوان الواجهة الحديثة</span><div class="ap-pals">${CM.PALETTES.map(p => `<button type="button" class="ap-pal" data-app="${p.id}" aria-pressed="${L.pal === p.id}"><span class="ap-dots">${p.c.map(x => `<i style="background:${x}"></i>`).join("")}</span>${p.n}</button>`).join("")}
          <button type="button" class="ap-pal" data-app="own" aria-pressed="${L.pal === "own"}"><span class="ap-dots">${own.map(x => `<i style="background:${x}"></i>`).join("")}</span>ألواني</button></div>
          ${L.pal === "own" ? `<div class="ap-own">${[["الخلفية", 0], ["اللون المميز", 1], ["الداكن", 2]].map(([t, i]) => `<label>${t}<input type="color" data-apo="${i}" value="${own[i]}"></label>`).join("")}</div><small class="muted">اختر خلفية فاتحة ولونًا داكنًا ليظهر الكلام بوضوح.</small>` : ""}</div>
        <div class="ap-sec${L.skin === "nx" ? "" : " ap-dis"}"><label class="ap-row"><span>حركة مع التمرير (ظهور الكروت وتراكب الأقسام)</span><input type="checkbox" data-apm ${L.motion ? "checked" : ""}></label></div>
        <small class="muted">يُحفظ الاختيار على هذا الجهاز فقط.</small></div>`;
      d.querySelector("[data-apx]").onclick = close;
      d.querySelectorAll("[data-apt]").forEach(b => b.onclick = () => { const t = b.dataset.apt; if (t === "auto") CM.store.del("cm_theme"); else CM.store.set("cm_theme", t); applyTheme(); draw(); });
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
    const R = document.documentElement, SEL = ".panel, .tile, .walert-c, .sec-t, .now-c, .sband, .tw-panel, .gb-box, .bl-g, .ap-box, .msg.warn, .tiles.small > *, .kpi, .rp-sec, .tk-card, article.course, .tk-grp";
    // b102: العنوان الكبير بيطلع كلمة كلمة من ورا قناع، والأرقام الكبيرة بتعدّ. مرة واحدة لكل عنوان/رقم جديد، مش مع كل إعادة رسم.
    const TSEL = ".sband .sb-t > h2, .hx .hx-in > h2, .tk-over h3", seenT = {}, seenN = {};
    const titles = () => document.querySelectorAll(TSEL).forEach((el, k) => {
      if (el.dataset.nxt || el.children.length) return; el.dataset.nxt = "1";
      const txt = el.textContent.trim(), slot = (el.closest("[id]") || {}).id + "|" + el.tagName + k; if (!txt || seenT[slot] === txt) return; seenT[slot] = txt;
      el.setAttribute("aria-label", txt); el.textContent = "";
      txt.split(/\s+/).forEach((w, i) => { const o = document.createElement("span"); o.className = "nx-w"; o.setAttribute("aria-hidden", "true"); const n = document.createElement("i"); n.textContent = w; n.style.setProperty("--i", i); o.appendChild(n); el.appendChild(o); el.appendChild(document.createTextNode(" ")); });
    });
    const countUp = el => { const m = /^(\d+)(%?)$/.exec(el.textContent.trim()); if (!m || el.children.length) return; const to = +m[1], suf = m[2], lab = (el.nextElementSibling || {}).textContent || "", key = lab + "|" + ((el.closest("[id]") || {}).id || "");
      if (el.dataset.nxn) return; el.dataset.nxn = "1"; if (seenN[key] === to || to < 2) { seenN[key] = to; return; } const from = seenN[key] != null ? seenN[key] : 0; seenN[key] = to;
      const t0 = performance.now(), D = 800, step = t => { if (!el.isConnected) return; const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 4); el.textContent = Math.round(from + (to - from) * e) + suf; if (p < 1) requestAnimationFrame(step); }; el.textContent = from + suf; requestAnimationFrame(step); };
    const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const on = () => R.dataset.skin === "nx" && R.dataset.motion !== "off" && !reduce();
    let io = null, ticking = false;
    const mark = () => {
      if (!on()) { document.querySelectorAll(".nx-r").forEach(e => e.classList.remove("nx-r", "nx-in")); return; }
      if (!io && "IntersectionObserver" in window) io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const x = e.target; x.classList.add("nx-in"); io.unobserve(x); setTimeout(() => x.classList.remove("nx-r", "nx-in"), 1100); } }), { threshold: .08, rootMargin: "0px 0px -6% 0px" });
      const vh = innerHeight;
      document.querySelectorAll(SEL).forEach(el => {
        if (el.dataset.nxr || el.closest(".bell-pop, .ap-dlg, #overlay, .cpk-pop, .gb-box.full")) return; el.dataset.nxr = "1";
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) { delete el.dataset.nxr; return; }   // مخفي (قسم مقفول): نستناه يظهر
        if (r.top < vh * .92 && r.bottom > 0) return;     // الظاهر أصلًا ما يتحركش
        setTimeout(() => { if (el.classList.contains("nx-r") && !el.classList.contains("nx-in")) el.classList.remove("nx-r"); }, 2500);   // أمان: عمره ما يفضل مخفي
        const sib = el.parentElement ? [...el.parentElement.children].indexOf(el) % 4 : 0; el.style.setProperty("--nxd", (sib * .07) + "s");
        el.classList.add("nx-r"); if (io) io.observe(el); else el.classList.add("nx-in");
      });
      document.querySelectorAll(".home .tiles:not(.small)").forEach(t => [...t.children].forEach((c, i) => c.style.setProperty("--nxi", i)));
      titles(); document.querySelectorAll(".kpi > b").forEach(countUp);
      frame();
    };
    const frame = () => {
      ticking = false; if (!on()) return;
      const y = scrollY; R.classList.toggle("nx-sc", y > 24);
      document.querySelectorAll(".hx, .sband").forEach(h => { const r = h.getBoundingClientRect(); const p = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height))); h.style.setProperty("--nxp", p.toFixed(3)); });
      if (innerWidth <= 760) document.querySelectorAll(".home .tiles:not(.small)").forEach(t => { const ks = [...t.children];
        ks.forEach((k, i) => { const n = ks[i + 1]; if (!n) { k.style.setProperty("--nxc", 0); return; } const a = k.getBoundingClientRect(), b = n.getBoundingClientRect(); const ov = Math.max(0, Math.min(1, (a.bottom - b.top) / Math.max(1, a.height))); k.style.setProperty("--nxc", ov.toFixed(3)); }); });
    };
    // شريط الأقسام في الموبايل: ثابت دايمًا، وخلفية ملوّنة بتتزحلق للقسم المفتوح
    let lastY = scrollY, acc = 0, dkRaf = 0;
    const dock = () => {
      if (R.dataset.skin !== "nx") return;
      const y = Math.max(0, scrollY), max = Math.max(1, document.documentElement.scrollHeight - innerHeight), d = y - lastY; lastY = y;
      R.style.setProperty("--nxsp", Math.min(1, y / max).toFixed(3));
      if ((d > 0) !== (acc > 0)) acc = 0;   // اتجاه جديد: نبدأ العدّ من الأول
      acc += d;
      R.classList.remove("nx-dn");   // b98: الشريط ثابت دايمًا ومبيختفيش مع السكرول
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
    document.addEventListener("pointermove", e => { if (!on() || e.pointerType !== "mouse") return; const t = e.target.closest && e.target.closest(".tile, .me-card, .dh-card, .st-card, .st-gr"); if (t) { const r0 = t.getBoundingClientRect(); t.style.setProperty("--mx", (e.clientX - r0.left) + "px"); t.style.setProperty("--my", (e.clientY - r0.top) + "px"); } document.querySelectorAll("[data-tilt]").forEach(x => { if (x !== t) { x.style.transform = ""; delete x.dataset.tilt; } });
      if (!t || innerWidth <= 760) return; const r = t.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width - .5, dy = (e.clientY - r.top) / r.height - .5;
      const k = Math.min(1, 380 / r.width);   // الكروت الكبيرة (زي رسم الحضور) بتميل أقل
      t.dataset.tilt = "1"; t.style.transform = `perspective(${Math.round(700 / k)}px) rotateX(${(-dy * 6 * k).toFixed(2)}deg) rotateY(${(dx * 8 * k).toFixed(2)}deg) translateY(-4px)`; }, { passive: true });
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
    { who: "student", q: "كيف أسجّل حضوري في المحاضرة؟", k: "حضور تسجيل سجل احضر المحاضره بدأت كود رمز qr باركود امسح", a: "عندما تبدأ المحاضرة تجد في أعلى صفحتك «محاضرة جارية الآن». اضغط عليها، ثم:<br>• إذا كانت المحاضرة في القاعة: اسمح للموقع بمعرفة مكانك، واكتب الرمز الظاهر على شاشة المحاضر أو اضغط «امسح رمز QR من الشاشة».<br>• إذا كانت أونلاين: اكتب الرمز الذي يقوله المحاضر.<br>إذا أُغلق الرمز أو تعذّر عليك التسجيل، فاطلب من المعيد تسجيلك يدويًّا." },
    { who: "student", q: "بيقولي «الحساب مرتبط بهاتف آخر»", k: "مرتبط هاتف اخر تليفون جديد غيرت موبايل جهاز تاني متصفح اخر نقل الحساب", a: "حسابك مرتبط بهاتف واحد حتى لا يسجّل أحد الحضور مكانك.<br>• إذا كنت فعّلت الدخول بالبصمة: اضغط «الدخول ببصمة الوجه أو الإصبع» وسيُنقل مباشرة.<br>• إذا غيّرت هاتفك: ادخل بكلمة السر من الهاتف الجديد واطلب نقل الحساب، أو اطلب من المعيد «فك ربط الهاتف».<br>• إذا أردت تسليم تكليف من الكمبيوتر فقط: اختر «ادخل لتسليم التكليفات فقط»." },
    { who: "student", q: "نسيت كلمة السر", k: "نسيت كلمه السر باسورد الباسورد مش فاكر استعادة تغيير", a: "في صفحة الدخول اضغط «نسيت كلمة السر؟» واختر إحدى الطرق: الهاتف المرتبط نفسه، أو البصمة، أو حساب Google الذي سلّمت به من قبل، أو موافقة المعيد (سيظهر لك رقم تحقق تخبر به المعيد)." },
    { who: "student", q: "الموقع يقول «لا يوجد اتصال» والإنترنت يعمل", k: "نت انترنت اتصال لا يوجد مش بيحمل بيحمل واقف ايفون سفاري خطأ مشكلة الموقع مش شغال", a: "• استنى ثواني، الموقع بيعيد المحاولة لوحده كل 5 ثواني.<br>• حدّث الصفحة.<br>• على الآيفون: افتح الموقع من أيقونته على الشاشة الرئيسية وليس من Safari.<br>• جرّب تقفل الـ VPN أو أي برنامج حجب، أو جرّب Wi-Fi بدل الداتا (أو العكس).<br>• وإن استمرت المشكلة، جرّب متصفحًا آخر (Chrome)." },
    { who: "all", q: "كيف أفعّل الإشعارات؟", k: "اشعارات اشعار تنبيهات نوتفكيشن تفعيل مش بيوصلني", a: "اضغط «تفعيل الإشعارات» واختار «سماح».<br>• على الآيفون: لازم الأول تضيف الموقع للشاشة الرئيسية (زر المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية»)، وتفتحه من الأيقونة، ولاحقًا تفعّل.<br>• إذا رفضتها من قبل: من إعدادات المتصفح ← إعدادات المواقع ← الإشعارات، اسمح لـ Hadro." },
    { who: "all", q: "كيف أضيف الموقع إلى الشاشة الرئيسية؟", k: "شاشة رئيسية ايقونة تطبيق تنزيل تثبيت ابلكيشن home screen", a: "• آيفون (Safari): زر المشاركة ⬆︎ بالأسفل ← «إضافة إلى الشاشة الرئيسية» ← «إضافة».<br>• أندرويد (Chrome): القائمة ⋮ ← «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».<br>بعدها افتح Hadro دائمًا من الأيقونة: فهو أسرع، ولا يُخرجك من حسابك، وتعمل فيه الإشعارات." },
    { who: "student", q: "كيف أسلّم تكليفًا؟", k: "تسليم سلم تكليف مشروع رفع ملف صوره درايف google drive", a: "افتح المادة ← التكليف ← اختر الملف. يُرفع الملف على Google Drive الخاص بك ويُرسل للمعيد. وإذا أُغلقت نافذة Google أو لم تكتمل، فاضغط «جرّب طريقة أخرى» أو «سلّم رابطًا بدلًا من ذلك» وضع رابط الملف." },
    { who: "student", q: "تسليمي مكتوب عليه «متأخر» أو «مرفوض»", k: "متاخر مرفوض غائب يوم الطرح عذر", a: "«متأخر» يعني أنك سلّمت بعد الموعد أو كنت غائبًا يوم طرح المشروع. و«مرفوض» يعني أن التكليف لا يقبل تسليم الغائب إلا بعذر. فإذا كان لديك عذر فتواصل مع المعيد، ويمكنه قبوله أو فتح تسليم استثنائي لك." },
    { who: "student", q: "أعرف غيابي وإنذاراتي منين؟", k: "غياب انذار انذارات كام مرة غبت حرمان انسحاب", a: "افتح المادة من صفحتك لتجد عدد مرات غيابك ومستوى الإنذار. الإنذارات بالترتيب: أول، ثانٍ، ثالث ونهائي، ثم الانسحاب الإجباري من المادة. ويصلك إشعار فور وصولك إلى إنذار جديد." },
    { who: "student", q: "كيف أتظلّم على درجة؟", k: "تظلم درجه غلط مرصوده مترصدتش اعتراض", a: "افتح التكليف بعد إعلان الدرجات ← «تظلم على الدرجة» ← اختر السبب ← ارفع صورة المشروع يظهر فيها اسمك ودرجتك ← «إرسال التظلم». سيصلك إشعار بالقبول أو الرفض. والتظلم متاح فقط وباب التظلم مفتوح (يحدد المعيد مهلته)." },
    { who: "student", q: "درجتي لا تظهر", k: "درجه درجتي مش ظاهره الدرجات فين نتيجه", a: "تظهر الدرجات بعد أن «يعلنها» المعيد. وإذا أُعلنت ولم تجد درجتك رغم أنك سلّمت، فقدّم تظلمًا واختر «سلّمت ولم تُرصد»." },
    { who: "student", q: "ليه الموقع بيطلب مكاني (الموقع الجغرافي)؟", k: "موقع جغرافي لوكيشن gps مكاني القاعة بعيد", a: "في محاضرات القاعة يتحقق الموقع من أنك في الكلية فعلًا. اسمح بالموقع وشغّل GPS. وإذا أخبرك أنك بعيد وأنت في القاعة، فانتظر ثواني حتى تتحسن الدقة أو اقترب من النافذة، أو اطلب من المعيد تسجيلك." },
    { who: "staff", q: "كيف أبدأ محاضرة؟", k: "ابدا محاضره جديده بدء حضور قاعه اونلاين رمز", a: "افتح المادة ← «المحاضرة» ← اختر المجموعة ونوعها (قاعة أو أونلاين) ← «ابدأ المحاضرة». يظهر رمز وQR تعرضهما على الشاشة. وعند الانتهاء اضغط «إغلاق التسجيل» ثم إنهاء المحاضرة (وهو ما يرسل إشعارات الإنذار للطلبة)." },
    { who: "staff", q: "طالب لا يستطيع تسجيل الحضور", k: "طالب مش عارف يسجل يدوي حضرته تحضير غائب", a: "من «الكشف» اضغط خانة الطالب في المحاضرة وسجّله يدويًّا، أو من شاشة المحاضرة الجارية. وإذا كان هاتفه مرتبطًا خطأً، فمن «الطلبة» اختر «فك ربط الهاتف»." },
    { who: "staff", q: "كيف أضيف طلبة أو أستورد كشفًا؟", k: "اضافه طلبه طالب كشف استيراد اكسل قائمه", a: "من «الطلبة» ← «إضافة طالب» لطالب واحد، أو استورد كشف إكسل فيه الكود والاسم والمجموعة." },
    { who: "staff", q: "كيف أنشئ تكليفًا وأرصد الدرجات؟", k: "تكليف جديد رصد درجات مشروع تسليم اعلان", a: "«التكليفات» ← «تكليف أو رصد جديد». بعد التسليم افتح التكليف واكتب الدرجات (أو «رصد بالصوت» أو «رفع درجات» من إكسل)، واضغط «حفظ الدرجات»، ثم «إعلان» ليراها الطلبة." },
    { who: "staff", q: "كيف أصدّر كشف الكنترول؟", k: "تصدير كشف الكنترول اكسل pdf طباعه درجات مجموعه", a: "«التكليفات» ← «تصدير واستيراد» ← اختر المجموعة ← إكسل أو PDF." },
    { who: "staff", q: "كيف أتحكم في مهلة التظلم؟", k: "مهله تظلم فتح قفل اغلاق تظلمات", a: "افتح التكليف لتجد شريط «باب التظلم». يمكنك إغلاقه، أو فتحه لمدة (يوم/يومين/3 أيام/أسبوع)، أو «حدّد موعد الفتح والإغلاق». وتظهر التظلمات في الصفحة نفسها مع «قبول ورصد الدرجة» أو «رفض التظلم»." },
    { who: "staff", q: "كيف أقسّم الطلبة على مجموعات؟", k: "تقسيم مجموعات مجموعه جروب أ ب", a: "«الطلبة» ← «تقسيمهم تلقائيًّا» (للطلبة بلا مجموعة) أو «إعادة تقسيم المجموعات» (للجميع). وتختار العدد والتسمية والترتيب." },
    { who: "staff", q: "الطلبة الذين لديهم إنذارات", k: "انذارات طلبه انذار تنبيه ابلاغ", a: "تجد تنبيهًا في الرئيسية وفي «التقرير». ويمكنك «إرسال تنبيه للطلاب» (إشعار على هواتفهم)، أو تنزيل الكشف، أو نسخ نص إعلان للمجموعة." },
    { who: "staff", q: "كيف أضيف معيدًا للمادة؟", k: "اضافه معيد فريق محاضر مشارك", a: "من «الفريق» في المادة اكتب بريده الجامعي. يجب أن يكون لديه حساب أولًا؛ وإن لم يكن، فيطلب حسابًا من صفحة الدخول («طلب حساب جديد») ويوافق المسؤول." },
    { who: "staff", q: "نسيت كلمة السر (هيئة التدريس)", k: "نسيت كلمه السر باسورد معيد محاضر دخول", a: "في صفحة الدخول اختر «نسيت كلمة السر»، واكتب كلمة سر جديدة، وسيصلك رمز على بريدك الجامعي لتكتبه. وإن لم يصل الرمز، فراجع البريد غير المرغوب أو اطلب من المسؤول «كلمة سر مؤقتة»." }
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
    const fmt = d => new Date(d).toLocaleString("ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    function faqHtml() {
      const res = CM.faqSearch(st.q, o.who);
      return `<div class="hc-ask"><div class="hc-bot"><span class="hc-av">${CM.ICONS ? "" : ""}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5"/></svg></span><p>أهلًا! أنا مساعد Hadro. اكتب سؤالك بكلامك، وهطلعلك الإجابة.</p></div>
        <input type="search" id="hcQ" value="${esc(st.q)}" placeholder="مثلًا: نسيت كلمة السر، كيف أسجّل حضوري…" autocomplete="off" aria-label="سؤالك">
        <div class="hc-res">${res.length ? res.map((f, i) => `<details class="hc-faq" ${st.q && i === 0 ? "open" : ""}><summary>${esc(f.q)}</summary><div>${f.a}</div></details>`).join("") : `<p class="small muted">لم أجد إجابة جاهزة لسؤالك.</p>`}</div>
        <div class="hc-more"><span class="small muted">لم تجد ما تبحث عنه؟</span>${o.api ? `<button class="btn sm primary" data-hct="new">راسل الإدارة</button>` : `<span class="small">${o.loginHint || "سجّل دخولك أولًا لتتمكن من مراسلة الإدارة."}</span>`}</div></div>`;
    }
    function newHtml() {
      const f = st.form;
      return `<div class="hc-new">
        <div class="hc-cats" role="radiogroup" aria-label="نوع الرسالة">${Object.entries(HC_CATS).map(([k, l]) => `<button type="button" class="cchip" role="radio" aria-pressed="${f.cat === k}" data-hcc="${k}">${l}</button>`).join("")}</div>
        ${(o.courses || []).length ? `<label class="f"><span>تخص مادة؟ (اختياري)</span><select id="hcCourse"><option value="">لا تخص مادة بعينها</option>${o.courses.map(c => `<option value="${c.id}" ${f.course === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
        <label class="f"><span>العنوان</span><input id="hcSubj" maxlength="120" value="${esc(f.subject)}" placeholder="جملة قصيرة توضح الموضوع"></label>
        <label class="f"><span>التفاصيل</span><textarea id="hcBody" rows="5" maxlength="3000" placeholder="اكتب المشكلة أو الاقتراح بالتفصيل: ماذا حدث، ومتى، وعلى أي جهاز…">${esc(f.body)}</textarea></label>
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
          ${t.status === "closed" ? `<p class="small muted">أُغلقت هذه المحادثة. إن كان لديك موضوع جديد فأرسل رسالة جديدة.</p>` : `<label class="f"><span>ردّك</span><textarea id="hcRe" rows="3" maxlength="3000"></textarea></label>${st.msg ? `<p class="small bad-t">${esc(st.msg)}</p>` : ""}<div class="row"><button class="btn sm primary" id="hcReSend" ${st.busy ? "disabled" : ""}>إرسال</button></div>`}</div>`;
      }
      if (!st.items.length) return `<div class="empty small">لم ترسل رسائل بعد. <button class="linkish" data-hct="new">أرسل أول رسالة</button></div>`;
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
    f.innerHTML = `<span><b>${A.name}</b> · ${A.title}</span><span>${CM.copyright()}</span><button type="button" class="linkish" data-about>عن البرنامج وحقوق الملكية</button>`;
    const app = document.getElementById("app"); (app && app.parentNode ? app.parentNode : document.body).insertBefore(f, app ? app.nextSibling : null);
    const d = document.createElement("dialog");
    d.className = "about"; d.id = "aboutDlg";
    d.innerHTML = `<div class="about-in">
      <div class="brand">${CM.markHtml()}<div><h2>${A.name} <span class="muted small" style="font-weight:500;letter-spacing:.08em">${A.tagline.toUpperCase()}</span></h2><p class="muted small">${A.title} · الإصدار ${A.version} (${A.released}) <span dir="ltr">${CM.BUILD}</span></p></div></div>
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

  // b103: ستارة التحميل في المظهر الحديث — بتغطي الشاشة أول ما الصفحة تفتح، وتطلع لفوق لما المحتوى يجهز
  (function curtain() {
    const R = document.documentElement, app = document.getElementById("app");
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!app || R.dataset.skin !== "nx" || R.dataset.motion === "off" || reduce || !app.querySelector(":scope > .hd-loader")) { R.classList.add("nx-booted"); return; }
    const c = document.createElement("div"); c.id = "nxCurtain"; c.setAttribute("role", "status"); c.setAttribute("aria-label", "جارٍ التحميل");
    c.innerHTML = `<div class="nc-in">${CM.markHtml()}<b class="wm">hadro</b></div><span class="nc-bar"><i></i></span>`;
    document.body.appendChild(c); R.classList.add("nx-booted");
    const t0 = performance.now(), MIN = 300, MAX = 9000; let gone = false;
    const lift = () => { if (gone) return; gone = true; mo.disconnect(); clearTimeout(fs);
      setTimeout(() => { c.classList.add("up"); R.classList.add("nx-lifted"); setTimeout(() => c.remove(), 900); setTimeout(() => R.classList.remove("nx-lifted"), 1300); }, Math.max(0, MIN - (performance.now() - t0))); };
    const ready = () => app.children.length && !app.querySelector(":scope > .hd-loader");
    const mo = new MutationObserver(() => { if (ready()) lift(); }); mo.observe(app, { childList: true });
    const fs = setTimeout(lift, MAX);
  })();

  CM.setupNotice = () => `<div class="panel setup"><h2>لم يُربط التطبيق بقاعدة البيانات بعد</h2>
    <p class="muted">افتح ملف <span class="mono">config.js</span> وضع فيه Project URL و anon key من Supabase، كما هو موضّح في دليل التشغيل.</p></div>`;
})();

// b125: الشريط اللي فوق على الموبايل — نسخة ناعمة بدون lag:
//   الشريط الكبير بيتحرك مع الصفحة عادي لحد ما يخرج من الشاشة، وساعتها نسخته الصغيرة بتنزل من فوق وتفضل ثابتة.
//   كل الحركة transform + opacity بس (على كارت الشاشة)، ومفيش أي تغيير في طول الصفحة وقت الحركة؛
//   والتبديل بين الكبير والصغير بيحصل والشريط برّه الشاشة، فمابيبانش أي قفزة.
(function () {
  let t = false, on = false, full = 0; const R = document.documentElement, mq = matchMedia("(max-width: 760px)");
  const hd = () => document.querySelector("header.top");
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || R.dataset.motion === "off";
  const play = (h, cls) => { if (calm()) return; h.classList.remove("hd-in", "hd-back"); void h.offsetWidth; h.classList.add(cls); };
  const spacer = h => { let sp = h.previousElementSibling; if (!sp || !sp.classList.contains("hd-sp")) { sp = document.createElement("div"); sp.className = "hd-sp"; h.before(sp); } return sp; };
  const enter = quick => {
    const h = hd(); if (!h) return; on = true;
    const r = h.getBoundingClientRect(), mb = parseFloat(getComputedStyle(h).marginBottom) || 0;
    full = r.height; spacer(h).style.height = r.height + mb + "px";
    h.style.left = r.left + "px"; h.style.width = r.width + "px";
    R.classList.add("hd-sc"); h.dataset.sc = "1";
    if (!quick) play(h, "hd-in");
  };
  const leave = () => {
    const h = hd(); on = false; R.classList.remove("hd-sc");
    if (!h) return; const sp = h.previousElementSibling; if (sp && sp.classList.contains("hd-sp")) sp.remove();
    h.style.left = h.style.width = ""; h.dataset.sc = ""; h.classList.remove("hd-in"); play(h, "hd-back");
  };
  const tick = () => {
    t = false; if (!mq.matches) { if (on) leave(); return; }
    const h = hd(); if (!h) return;
    if (h.hasAttribute("data-pre")) { if (on) leave(); return; }   // شاشات ما قبل الدخول: الشريط يمشي مع الصفحة ولا يصغر
    if (on && !h.dataset.sc) { R.classList.remove("hd-sc"); enter(true); return; }   // الشريط اتبنى من جديد وهو صغير
    const y = scrollY;
    if (!on) { const b = h.getBoundingClientRect().bottom; if (b < -4 && y > 40) enter(); }
    else if (y < 8) leave();
  };
  addEventListener("scroll", () => { if (!t) { t = true; requestAnimationFrame(tick); } }, { passive: true });
  addEventListener("resize", () => { if (on) { leave(); requestAnimationFrame(tick); } }, { passive: true });
  new MutationObserver(() => { if (on) { const h = hd(); if (h && h.hasAttribute("data-pre")) { leave(); return; } if (h && !h.dataset.sc) { R.classList.remove("hd-sc"); enter(true); } } }).observe(R, { childList: true, subtree: true });
})();

/* ===================== b119: سياسة الاستخدام (موافقة إلزامية) + استطلاع الرأي ===================== */
(function () {
  const CM = window.CM; if (!CM) return;
  CM.POLICY_V = 2;
  const S5 = ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"];
  // مقياس قابلية استخدام النظام SUS (Brooke, 1996) بترجمة عربية، + محاور من نموذج قبول التقنية TAM (Davis, 1989)
  const SUS = ["أعتقد أنني سأرغب في استخدام هذه المنصة بصورة متكررة.", "وجدت المنصة معقدة بلا داعٍ.", "وجدت المنصة سهلة الاستخدام.", "أعتقد أنني سأحتاج إلى مساعدة شخص متخصص لأتمكن من استخدام المنصة.",
    "وجدت أن وظائف المنصة المختلفة متكاملة بصورة جيدة.", "وجدت في المنصة قدرًا كبيرًا من عدم الاتساق.", "أتصور أن معظم الناس سيتعلمون استخدام المنصة بسرعة كبيرة.", "وجدت المنصة مرهقة جدًا في الاستخدام.",
    "شعرت بثقة كبيرة أثناء استخدام المنصة.", "احتجت إلى تعلّم أشياء كثيرة قبل أن أتمكن من استخدام المنصة."];
  CM.SURVEY = {
    scale: S5,
    student: [
      { k: "sus", t: "سهولة استخدام المنصة", items: SUS },
      { k: "pu", t: "الفائدة المدركة", items: ["تسجيل الحضور بالمنصة أسرع من النداء بالأسماء أو الكشف الورقي.", "تسليم التكليفات عبر المنصة أيسر من التسليم الورقي أو عبر تطبيقات المراسلة.", "تساعدني المنصة على متابعة غيابي وإنذاراتي أولًا بأول.", "تساعدني المنصة على معرفة درجاتي والتظلم عليها بسهولة."] },
      { k: "tr", t: "الثقة والمصداقية", items: ["أثق في أن حضوري يُسجَّل بدقة.", "أشعر أن المنصة تمنع تسجيل الحضور لمن لم يحضر فعلًا.", "أثق في أن ملفاتي المسلَّمة تبقى كما سلّمتها."] },
      { k: "sat", t: "الرضا ونية الاستمرار", items: ["أنا راضٍ بصفة عامة عن المنصة.", "أفضّل المنصة على الطرق اليدوية (الكشف الورقي والتسليم الورقي).", "أرغب في استخدام المنصة في مقررات أخرى.", "أنصح زملائي بالاعتماد على المنصة."] }],
    staff: [
      { k: "sus", t: "سهولة استخدام المنصة", items: SUS },
      { k: "pu", t: "الفائدة المدركة", items: ["توفر المنصة وقتًا في تسجيل الحضور مقارنة بالنداء اليدوي.", "توفر المنصة وقتًا في تجميع التكليفات وتصحيحها ورصد درجاتها.", "تقلّل المنصة أخطاء نقل الدرجات وإعداد كشوف الكنترول.", "تسهّل المنصة متابعة الغياب وإبلاغ الطلبة بالإنذارات.", "تسهّل المنصة التعامل مع التظلمات بعدالة وشفافية."] },
      { k: "tr", t: "الثقة والمصداقية", items: ["أثق في دقة بيانات الحضور في المنصة.", "تمنع المنصة تسجيل الحضور بالنيابة عن طالب غائب.", "أثق في أن ملفات الطلبة لم تتغير بعد التسليم (البصمة الرقمية)."] },
      { k: "wl", t: "عبء العمل", items: ["خفّفت المنصة من عبء عملي الإداري في المقررات.", "أصبحت أنجز مهام المقرر في وقت أقل مما كان قبل المنصة."] },
      { k: "sat", t: "الرضا ونية الاستمرار", items: ["أنا راضٍ بصفة عامة عن المنصة.", "أفضّل المنصة على الطرق اليدوية.", "سأستمر في استخدام المنصة في مقرراتي."] }],
    extra: {
      student: [{ k: "dev", t: "الجهاز الذي تستخدم عليه المنصة غالبًا", opts: [["android", "هاتف أندرويد"], ["ios", "آيفون"], ["pc", "كمبيوتر"]] }],
      staff: [{ k: "exp", t: "سنوات الخبرة في التدريس", opts: [["0-2", "أقل من 3"], ["3-5", "3 إلى 5"], ["6-10", "6 إلى 10"], ["10+", "أكثر من 10"]] },
        { k: "man_sec", t: "تقديرك لمتوسط زمن نداء الطالب الواحد يدويًا (بالثانية)", num: true },
        { k: "man_grade", t: "تقديرك لزمن رصد الدرجة الواحدة يدويًا ونقلها إلى الكشف (بالثانية)", num: true }]
    },
    open: [["o_like", "ما أكثر ما أفادك في المنصة؟"], ["o_improve", "ما الذي يحتاج إلى تحسين؟"]]
  };
  const POLICY = [
    "تحفظ المنصة بيانات استخدامك اللازمة لعملها: الحضور (الوقت والموقع لحظة التسجيل فقط والجهاز المرتبط)، والتكليفات (رابط الملف وبصمته ووقت تسليمه) والدرجات والتظلمات.",
    "تُستخدم بيانات الاستخدام بعد تجميعها وإخفاء هويات أصحابها في تطوير المنصة وفي البحث العلمي، ولا يُنشر أي اسم أو كود أو بيانات تكشف شخصية أي مستخدم.",
    "قد يُطلب منك من وقت لآخر الإجابة عن استطلاع رأي قصير عن تجربتك مع المنصة، وتُحفظ إجاباتك بمعرّف مجهول.",
    "لا تُباع البيانات ولا تُشارك مع أي جهة خارج القسم، ولا تُستخدم في الإعلانات.",
    "تلتزم بتسجيل حضورك بنفسك ومن هاتفك، وبعدم تعديل ملف التكليف بعد تسليمه."];
  const box = () => { let o = document.getElementById("cmGate"); if (!o) { o = document.createElement("div"); o.id = "cmGate"; o.className = "cg-ov"; o.setAttribute("role", "dialog"); o.setAttribute("aria-modal", "true"); document.body.appendChild(o); } document.documentElement.classList.add("cg-lock"); return o; };
  const done = () => { const o = document.getElementById("cmGate"); if (o) o.remove(); document.documentElement.classList.remove("cg-lock"); };
  // api: { get(), accept(v), submit(sid, answers, declined, consent, seconds), who: "student" | "staff", err(e) }
  CM.gate = async api => {
    if (CM.gate.busy) return; CM.gate.busy = true;
    try {
      const g = await api.get(); if (!g) return;
      if ((+g.policy || 0) < CM.POLICY_V) await policy(api);
      if (g.survey) await survey(api, g.survey);
    } catch (e) { /* البوابة متمنعش استخدام البرنامج لو حصل خطأ في الاتصال */ }
    finally { CM.gate.busy = false; }
  };
  function policy(api) {
    return new Promise(res => {
      const o = box();
      o.innerHTML = `<div class="cg-card"><div class="cg-h"><span class="cg-ic">${CM.markHtml()}</span><div><b>تحديث سياسة الاستخدام والخصوصية</b><small>اقرأها ووافق عليها لتتابع استخدام Hadro</small></div></div>
        <ul class="cg-ul">${POLICY.map(p => `<li>${CM.esc(p)}</li>`).join("")}</ul>
        <p class="small"><a href="privacy.html" target="_blank" rel="noopener">اقرأ سياسة الاستخدام والخصوصية كاملة ↗</a></p>
        <label class="cg-ok"><input type="checkbox" id="cgAgree"> قرأت سياسة الاستخدام والخصوصية وأوافق عليها</label>
        <p class="small bad-t" id="cgErr"></p>
        <button class="btn primary block" id="cgGo" disabled>متابعة</button></div>`;
      const ag = o.querySelector("#cgAgree"), go = o.querySelector("#cgGo");
      ag.onchange = () => go.disabled = !ag.checked;
      go.onclick = async () => { go.disabled = true; try { await api.accept(CM.POLICY_V); done(); res(); } catch (e) { o.querySelector("#cgErr").textContent = api.err ? api.err(e) : "تعذّر الحفظ. حاول مرة أخرى."; go.disabled = false; } };
    });
  }
  function survey(api, sv) {
    return new Promise(res => {
      const o = box(), who = api.who === "staff" ? "staff" : "student", secs = CM.SURVEY[who], ex = CM.SURVEY.extra[who], ans = {}, t0 = Date.now();
      const total = secs.reduce((a, s) => a + s.items.length, 0);
      let n = 0;
      o.innerHTML = `<div class="cg-card cg-sv"><div class="cg-h"><span class="cg-ic">${CM.markHtml()}</span><div><b>استطلاع رأي عن تجربتك مع Hadro</b><small>نحو 4 دقائق · ${total} عبارة</small></div></div>
        <div class="cg-consent"><p>هذا الاستطلاع جزء من دراسة أكاديمية عن استخدام المنصات الرقمية في تعليم العمارة الداخلية. إجاباتك تُحفظ بمعرّف مجهول، ولا يطّلع أحد على إجابات شخص بعينه، وتُعرض النتائج مجمّعة فقط. ${sv.allow_decline ? "مشاركتك اختيارية، ويمكنك الاعتذار من الزر في آخر الصفحة." : ""}</p>
          <label class="cg-ok"><input type="checkbox" id="cgCons"> أوافق على المشاركة واستخدام إجاباتي في البحث العلمي</label></div>
        <div class="cg-prog"><i id="cgBar"></i><span id="cgN">0 / ${total}</span></div>
        ${secs.map(s => `<section class="cg-sec"><h3>${CM.esc(s.t)}</h3>${s.items.map((t, i) => { const id = s.k + (i + 1);
          return `<div class="cg-q" data-q="${id}"><p>${CM.esc(t)}</p><div class="cg-l" role="radiogroup" aria-label="${CM.esc(t)}">${S5.map((l, j) => `<button type="button" role="radio" aria-checked="false" data-v="${j + 1}" title="${l}"><b>${j + 1}</b><small>${l}</small></button>`).join("")}</div></div>`; }).join("")}</section>`).join("")}
        <section class="cg-sec"><h3>أسئلة إضافية</h3>${ex.map(x => x.opts ? `<div class="cg-q"><p>${CM.esc(x.t)}</p><div class="cg-ch">${x.opts.map(([v, l]) => `<label><input type="radio" name="cgx_${x.k}" value="${v}"> ${CM.esc(l)}</label>`).join("")}</div></div>`
          : `<label class="f"><span>${CM.esc(x.t)} <small class="muted">اختياري</small></span><input type="text" inputmode="decimal" data-x="${x.k}"></label>`).join("")}
          ${CM.SURVEY.open.map(([k, t]) => `<label class="f"><span>${CM.esc(t)} <small class="muted">اختياري</small></span><textarea data-o="${k}" rows="2" maxlength="600"></textarea></label>`).join("")}</section>
        <p class="small bad-t" id="cgErr"></p>
        <div class="cg-act"><button class="btn primary" id="cgSend">إرسال الإجابات</button>${sv.allow_decline ? `<button class="btn ghost" id="cgNo">أعتذر عن المشاركة</button>` : ""}</div></div>`;
      const card = o.querySelector(".cg-card");
      const prog = () => { o.querySelector("#cgN").textContent = n + " / " + total; o.querySelector("#cgBar").style.width = (n / total * 100) + "%"; };
      o.querySelectorAll(".cg-q[data-q]").forEach(q => q.querySelectorAll("[data-v]").forEach(b => b.onclick = () => {
        if (ans[q.dataset.q] == null) n++; ans[q.dataset.q] = +b.dataset.v; q.classList.add("on"); q.classList.remove("miss");
        q.querySelectorAll("[data-v]").forEach(x => x.setAttribute("aria-checked", x === b)); prog();
        const nx = q.parentElement.querySelector(".cg-q[data-q]:not(.on)") || o.querySelector(".cg-q[data-q]:not(.on)"); if (nx && nx !== q) setTimeout(() => nx.scrollIntoView({ block: "center", behavior: "smooth" }), 120); }));
      const err = t => { o.querySelector("#cgErr").textContent = t; };
      const send = async declined => {
        const b = o.querySelector(declined ? "#cgNo" : "#cgSend");
        if (!declined) {
          if (!o.querySelector("#cgCons").checked) { err("علّم على الموافقة على المشاركة في أول الاستطلاع."); o.querySelector(".cg-consent").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
          const miss = [...o.querySelectorAll(".cg-q[data-q]")].filter(q => ans[q.dataset.q] == null);
          if (miss.length) { miss.forEach(q => q.classList.add("miss")); err("فاضل " + miss.length + " عبارة من غير إجابة."); miss[0].scrollIntoView({ block: "center", behavior: "smooth" }); return; }
          ex.forEach(x => { if (x.opts) { const r = o.querySelector(`input[name="cgx_${x.k}"]:checked`); if (r) ans[x.k] = r.value; } else { const v = (o.querySelector(`[data-x="${x.k}"]`).value || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).trim(); if (v && !isNaN(+v)) ans[x.k] = +v; } });
          CM.SURVEY.open.forEach(([k]) => { const v = o.querySelector(`[data-o="${k}"]`).value.trim(); if (v) ans[k] = v.slice(0, 600); });
        }
        b.disabled = true;
        try { await api.submit(sv.id, declined ? {} : ans, declined, !declined, Math.round((Date.now() - t0) / 1000)); card.innerHTML = `<div class="cg-thx">${CM.markHtml()}<b>${declined ? "تمام، شكرًا لك." : "شكرًا لمشاركتك!"}</b><span class="small muted">${declined ? "لن يظهر لك هذا الاستطلاع مرة أخرى." : "سُجّلت إجاباتك بمعرّف مجهول."}</span></div>`; setTimeout(() => { done(); res(); }, 1400); }
        catch (e) { b.disabled = false; err(api.err ? api.err(e) : "تعذّر الإرسال. حاول مرة أخرى."); }
      };
      o.querySelector("#cgSend").onclick = () => send(false);
      const no = o.querySelector("#cgNo"); if (no) no.onclick = () => send(true);
    });
  }
})();

// b145: على الموبايل، الزرار اللي نصه مايكفيهوش نص الصف بياخد الصف كله (بدل ما الكلام يتقص)
(function () {
  if (!window.matchMedia || !window.MutationObserver) return;
  let q = 0;
  const fit = () => {
    q = 0;
    if (!matchMedia("(max-width: 700px)").matches) return;
    document.querySelectorAll("#app div.row > .btn, #app .acts > .btn").forEach(b => {
      if (getComputedStyle(b.parentElement).display !== "grid") { b.classList.remove("fit-wide"); return; }
      if (!b.classList.contains("fit-wide") && b.scrollWidth > b.clientWidth + 1) b.classList.add("fit-wide");
    });
  };
  const start = () => {
    const a = document.getElementById("app"); if (!a) return;
    new MutationObserver(() => { if (!q) q = requestAnimationFrame(fit); }).observe(a, { childList: true, subtree: true });
    fit();
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
  addEventListener("resize", () => { document.querySelectorAll(".fit-wide").forEach(b => b.classList.remove("fit-wide")); fit(); });
})();

// b147: أي قايمة مفتوحة (أدوات، حسابي…) بتتقفل لما تدوس برّاها
document.addEventListener("click", ev => {
  document.querySelectorAll("details.dd[open]").forEach(d => { if (!d.contains(ev.target)) d.removeAttribute("open"); });
}, true);

// b149: زرار «إظهار» جنب كل خانة كلمة سر
(function () {
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const add = () => document.querySelectorAll('input[type="password"]:not([data-pw-eye])').forEach(i => {
    i.dataset.pwEye = "1";
    const w = document.createElement("span"); w.className = "pw-wrap"; i.parentNode.insertBefore(w, i); w.appendChild(i);
    const b = document.createElement("button"); b.type = "button"; b.className = "pw-eye"; b.innerHTML = EYE; b.setAttribute("aria-label", "إظهار كلمة السر"); b.title = "إظهار كلمة السر";
    b.onclick = e => { e.preventDefault(); const show = i.type === "password"; i.type = show ? "text" : "password"; b.innerHTML = show ? EYE_OFF : EYE; b.setAttribute("aria-label", show ? "إخفاء كلمة السر" : "إظهار كلمة السر"); b.title = b.getAttribute("aria-label"); i.focus(); };
    w.appendChild(b);
  });
  const start = () => { add(); new MutationObserver(add).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
})();

// b149: على الموبايل الشريط اللي تحت فيه 5 أزرار بالكتير، والباقي في «المزيد»
(function () {
  const R = document.documentElement;
  const MORE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const activeOf = n => n.querySelector(':scope > [aria-selected="true"], :scope > [aria-pressed="true"], :scope > .on');
  const label = b => (b.querySelector(".l-long") || b.querySelector(".l") || b).textContent.trim();
  const sheet = n => {
    const hid = [...n.querySelectorAll(":scope > button.dk-hid")]; if (!hid.length) return;
    const d = document.createElement("div"); d.className = "dk-sheet"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "باقي الأقسام");
    d.innerHTML = `<div class="dk-sh-box"><div class="dk-sh-h"><b>باقي الأقسام</b><button type="button" class="dk-sh-x" aria-label="إغلاق">✕</button></div><div class="dk-sh-g"></div></div>`;
    const g = d.querySelector(".dk-sh-g");
    hid.forEach(b => { const it = document.createElement("button"); it.type = "button"; it.className = "dk-sh-it";
      const ic = b.querySelector("svg"); it.innerHTML = (ic ? ic.outerHTML : "") + `<span>${label(b).replace(/[<>&]/g, "")}</span>`;
      const badge = b.querySelector(".tb, .bell-n, b"); if (badge && badge.textContent.trim() && /^\d+$/.test(badge.textContent.trim())) it.insertAdjacentHTML("beforeend", `<i class="dk-sh-n">${badge.textContent.trim()}</i>`);
      it.onclick = () => { close(); b.click(); }; g.appendChild(it); });
    const close = () => { d.classList.add("out"); setTimeout(() => d.remove(), 180); document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") close(); };
    d.onclick = e => { if (e.target === d) close(); }; d.querySelector(".dk-sh-x").onclick = close;
    document.addEventListener("keydown", esc); document.body.appendChild(d); (g.firstElementChild || d).focus();
  };
  let q = 0;
  const run = () => {
    q = 0; let changed = false;
    const mobile = R.dataset.skin === "nx" && innerWidth <= 760;
    document.querySelectorAll(".ctabs, .nx-dock").forEach(n => {
      const btns = [...n.querySelectorAll(":scope > button:not(.dk-more)")].filter(b => b.classList.contains("dk-hid") || getComputedStyle(b).display !== "none");
      let m = n.querySelector(":scope > .dk-more");
      if (!mobile || btns.length <= 5) { btns.forEach(b => b.classList.remove("dk-hid")); if (m) m.remove(); if (n.classList.contains("ctabs")) R.classList.remove("dk-sub"); return; }
      // b169: الشريط ثابت — القسم المفتوح من «المزيد» لا يحلّ محل زر آخر؛ «المزيد» نفسه يظهر مختارًا، والقسم يفتح كصفحة فرعية بزر رجوع
      const a = activeOf(n), keep = btns.slice(0, 4), sub = !!(a && btns.includes(a) && !keep.includes(a));
      btns.forEach(b => { const h = !keep.includes(b); if (b.classList.contains("dk-hid") !== h) { b.classList.toggle("dk-hid", h); changed = true; } });
      const anyHot = btns.some(b => b.classList.contains("dk-hid") && b.querySelector(".tb, b"));
      if (!m) { changed = true; m = document.createElement("button"); m.type = "button"; m.className = "dk-more"; m.innerHTML = MORE + '<span class="l">المزيد</span>'; m.onclick = () => sheet(n); n.appendChild(m); }
      if (m.classList.contains("hot") !== anyHot) m.classList.toggle("hot", anyHot);
      if (m.classList.contains("on") !== sub) { m.classList.toggle("on", sub); m.setAttribute("aria-current", sub ? "page" : "false"); }
      if (n.classList.contains("ctabs")) R.classList.toggle("dk-sub", sub);
    });
    if (changed) requestAnimationFrame(() => dispatchEvent(new Event("resize")));   // الخلفية الملونة تتحرك للزرار المختار في مكانه الجديد
  };
  const kick = () => { if (!q) q = requestAnimationFrame(run); };
  const start = () => { run(); new MutationObserver(kick).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed", "class"] }); };
  addEventListener("resize", kick);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
})();

/* ===== «حاضر» والرسومات المتحركة (b168) =====
   الروبوت: WebM شفاف لكروم وفايرفوكس وإيدج، وWebP متحرك لسفاري وكل متصفحات الآيفون (لأنها تتجاهل شفافية WebM).
   الرسومات: MP4 بخلفية بيضاء داخل كارت أبيض. ومن فعّل «تقليل الحركة» أو «توفير البيانات» يرى صورة ثابتة. */
(function () {
  const CM = window.CM; if (!CM) return;
  const ua = navigator.userAgent || "";
  const webkitOnly = /iPhone|iPad|iPod/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(ua));
  // الصورة الثابتة فقط لمن أطفأ «الحركة» من إعدادات المظهر داخل Hadro
  // (كثير من الهواتف تشغّل «تقليل الحركة» تلقائيًّا مع توفير البطارية، فلا نعتمد عليه هنا)
  const still = () => document.documentElement.dataset.motion === "off";
  const B = "art/";
  CM.mascot = (n, cls) => {
    const c = `hd-m${cls ? " " + cls : ""}`, st = `${B}h-${n}.still.webp`;
    if (still()) return `<img class="${c}" data-art="h-${n}" src="${st}" alt="" aria-hidden="true" decoding="async">`;
    if (webkitOnly) return `<img class="${c}" data-art="h-${n}" src="${B}h-${n}.webp" alt="" aria-hidden="true" decoding="async">`;
    return `<video class="${c}" data-art="h-${n}" autoplay muted loop playsinline disablepictureinpicture preload="auto" poster="${st}" aria-hidden="true" tabindex="-1"><source src="${B}h-${n}.webm" type="video/webm"></video>`;
  };
  CM.illus = (n, cls) => {
    const c = `hd-i${cls ? " " + cls : ""}`, st = `${B}i-${n}.webp`;
    if (still()) return `<span class="${c}" data-art="i-${n}"><img src="${st}" alt="" aria-hidden="true" decoding="async"></span>`;
    return `<span class="${c}" data-art="i-${n}"><video autoplay muted loop playsinline disablepictureinpicture preload="auto" poster="${st}" aria-hidden="true" tabindex="-1"><source src="${B}i-${n}.mp4" type="video/mp4"></video></span>`;
  };
  // بعض المتصفحات لا تبدأ الفيديو المضاف بـ innerHTML: نشغّله بأنفسنا
  // لو المتصفح منع تشغيل الفيديو تلقائيًّا (توفير البطارية أو البيانات مثلًا) نبدّله بصورة WebP متحركة، فهذه لا تُمنع
  const fallback = v => {
    if (!v.isConnected || v.dataset.fb) return; v.dataset.fb = "1";
    const m = v.classList.contains("hd-m"), art = m ? v.dataset.art : (v.parentElement && v.parentElement.dataset.art); if (!art) return;
    const img = document.createElement("img"); img.alt = ""; img.setAttribute("aria-hidden", "true"); img.decoding = "async";
    img.src = B + art + (m ? ".webp" : ".anim.webp");
    if (m) { img.className = v.className; img.dataset.art = art; }
    v.replaceWith(img);
  };
  const kick = root => (root || document).querySelectorAll("video.hd-m, .hd-i video").forEach(v => {
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(e => { if (e && e.name === "NotAllowedError") fallback(v); }); }
    if (!v.dataset.watch) { v.dataset.watch = "1"; v.addEventListener("error", () => fallback(v), true); setTimeout(() => { if (v.isConnected && v.paused && !document.hidden) fallback(v); }, 2500); }
  });
  CM.playArt = kick;
  const start = () => new MutationObserver(ms => { if (ms.some(m => m.addedNodes.length)) kick(); }).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
  // إعادة رسم الصفحة من غير ما الرسمة تبدأ من الأول: نرجّع نفس العنصر لو اتكرر
  CM.html = (el, html) => {
    const keep = {}; el.querySelectorAll("[data-art]").forEach(n => { keep[n.dataset.art] = n; });
    el.innerHTML = html;
    el.querySelectorAll("[data-art]").forEach(n => { const o = keep[n.dataset.art]; if (o && o !== n) { n.replaceWith(o); delete keep[n.dataset.art]; } });
    kick(el);
  };
  const seen = k => { try { return !!localStorage.getItem("cm_seen_" + k); } catch (e) { return false; } };
  const mark = k => { try { localStorage.setItem("cm_seen_" + k, "1"); } catch (e) {} };
  CM.seen = seen;
  // شاشة شرح بملء الشاشة (تظهر مرة واحدة لكل key): slides = [{art, eb, t, p, tips}]
  CM.intro = (key, slides, o) => new Promise(res => {
    o = o || {};
    if (key && !o.force && seen(key)) return res("seen");
    const ov = document.createElement("div"); ov.className = "hd-intro"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    let i = 0, x0 = null;
    const prevFocus = document.activeElement;
    const close = v => { if (key) mark(key); ov.classList.add("out"); document.removeEventListener("keydown", kd); document.documentElement.classList.remove("hd-lock"); setTimeout(() => { ov.remove(); try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) {} }, 220); res(v); };
    const go = d => { const n = i + d; if (n < 0 || n >= slides.length) return; i = n; draw(); };
    const draw = () => {
      const s = slides[i], last = i === slides.length - 1, many = slides.length > 1;
      const btns = last && o.actions ? o.actions.map((a, k) => `<button type="button" class="btn ${k ? "" : "primary"} block" data-a="${a.v}">${a.t}</button>`).join("")
        : `<button type="button" class="btn primary block" data-n>${last ? (o.doneText || "فهمت، لنبدأ") : "التالي"}</button>`;
      CM.html(ov, `<div class="hdi-box">
        <div class="hdi-top">${s.eb ? `<span class="hdi-eb">${s.eb}</span>` : "<span></span>"}<button type="button" class="hdi-skip" data-x>${many && !last ? "تخطٍّ" : "إغلاق"}</button></div>
        <div class="hdi-art">${s.art}</div>
        <div class="hdi-txt" aria-live="polite"><h2 id="hdiT">${s.t}</h2><p>${s.p}</p>${s.tips ? `<ul class="hdi-tips">${s.tips.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}</div>
        ${many ? `<div class="hdi-dots" aria-hidden="true">${slides.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>` : ""}
        <div class="hdi-btns">${btns}</div></div>`);
      ov.setAttribute("aria-labelledby", "hdiT");
      ov.querySelector("[data-x]").onclick = () => close("skip");
      const n = ov.querySelector("[data-n]"); if (n) { n.onclick = () => last ? close("done") : go(1); setTimeout(() => n.focus(), 30); }
      ov.querySelectorAll("[data-a]").forEach(b => b.onclick = () => close(b.dataset.a));
    };
    const kd = e => { if (e.key === "Escape") close("skip"); else if (e.key === "ArrowLeft") go(1); else if (e.key === "ArrowRight") go(-1); };
    ov.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(dx > 0 ? 1 : -1); }, { passive: true });
    document.addEventListener("keydown", kd);
    document.documentElement.classList.add("hd-lock");
    draw(); document.body.appendChild(ov);
  });
  // احتفال قصير بعد نجاح خطوة مهمة (يُغلق وحده أو باللمس)
  CM.celebrate = (title, sub, art) => {
    const ov = document.createElement("div"); ov.className = "hd-cele"; ov.setAttribute("role", "status"); ov.setAttribute("aria-live", "polite");
    ov.innerHTML = `<div class="hdc-box">${CM.mascot(art || "joy")}<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
    let t; const close = () => { clearTimeout(t); ov.classList.add("out"); setTimeout(() => ov.remove(), 220); };
    ov.onclick = close; document.body.appendChild(ov); kick(ov); t = setTimeout(close, 2600);
  };
  // حالة فارغة أو خطأ ودّية
  CM.empty = (text, art, extra) => `<div class="empty hd-empty">${CM.mascot(art || "sleep")}<p>${text}</p>${extra || ""}</div>`;
})();

/* ===== b163: الجداول على الموبايل تتحول لكروت (كل صف كارت، وكل خانة بعنوانها) ===== */
(function () {
  const mq = matchMedia("(max-width: 760px)");
  const lab = t => {
    const n = String(t.rows.length) + ":" + t.querySelectorAll("td").length; if (t.dataset.cardOk === n) return;
    const hr = t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : null; if (!hr) return;
    const names = []; [...hr.cells].forEach(th => { const txt = (th.textContent || "").replace(/[▲▼⏷▾]/g, "").replace(/\s+/g, " ").trim(); for (let i = 0; i < (th.colSpan || 1); i++) names.push(txt); });
    [...t.tBodies].forEach(tb => [...tb.rows].forEach(r => { let i = 0; [...r.cells].forEach(td => { if (!td.hasAttribute("data-th")) td.setAttribute("data-th", (td.colSpan > 2 ? "" : names[i]) || ""); i += td.colSpan || 1; }); }));
    t.classList.add("cardify"); t.dataset.cardOk = n;
  };
  let q = 0;
  const run = () => { q = 0; if (!mq.matches) return; document.querySelectorAll(".tabpane table:not(.regt):not(.staff-tbl):not(.gb):not(.lvt):not(.tk-tbl), #adminArea table:not(.staff-tbl), #courseWrap table:not(.regt):not(.staff-tbl):not(.gb):not(.lvt):not(.tk-tbl)").forEach(lab); };
  const kick = () => { if (!q) q = requestAnimationFrame(run); };
  const start = () => { run(); new MutationObserver(kick).observe(document.body, { childList: true, subtree: true }); };
  mq.addEventListener ? mq.addEventListener("change", kick) : mq.addListener(kick);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
})();

/* ===== b166: شريط «لا يوجد اتصال» في كل الصفحات ===== */
(function () {
  let el = null;
  const show = off => {
    if (off && !el) { el = document.createElement("div"); el.className = "hd-net"; el.setAttribute("role", "status"); el.innerHTML = `<i aria-hidden="true"></i>لا يوجد اتصال بالإنترنت. ما تفعله الآن لن يُحفظ حتى يعود الاتصال.`; document.body.appendChild(el); }
    else if (!off && el) { el.classList.add("back"); el.innerHTML = `<i aria-hidden="true"></i>عاد الاتصال.`; const x = el; el = null; setTimeout(() => x.remove(), 2200); }
  };
  addEventListener("offline", () => show(true));
  addEventListener("online", () => show(false));
  const init = () => { if (navigator.onLine === false) show(true); };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", init); else init();
})();

/* b169: الأشرطة الأفقية القابلة للتمرير (التصفية والتبويبات) — تلاشٍ عند الطرف الأيسر يبيّن أن بعدها المزيد */
(function () {
  const SEL = "#livePanel .tabs,.rgm-f,.rs-sort,.dh-chips,.seg,.tkseg,.tk-sortrow,.cpk-pop .cchips,.tw-days,.tk-tabs,.ml-chips";
  const upd = el => {
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 2) { el.removeAttribute("data-ovf"); return; }
    // في RTL يكون scrollLeft صفرًا عند البداية وسالبًا كلما تقدّمنا نحو اليسار
    const left = Math.abs(el.scrollLeft), atEnd = left >= max - 2, atStart = left <= 2;
    el.setAttribute("data-ovf", atEnd ? "start" : atStart ? "end" : "both");
  };
  const scan = () => document.querySelectorAll(SEL).forEach(upd);
  let q = 0; const later = () => { if (!q) q = requestAnimationFrame(() => { q = 0; scan(); }); };
  document.addEventListener("scroll", e => { const t = e.target; if (t && t.matches && t.matches(SEL)) upd(t); }, true);
  addEventListener("resize", later);
  const start = () => { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); scan(); };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
})();

/* b169: قائمة اختيار بالبحث — تحلّ محل <select data-spick> الطويلة (اختيار طالب من 200+)، والـ select الأصلي يبقى مخفيًّا ويستقبل القيمة */
(function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = s => String(s).replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ًٌٍَُِّْـ]/g, "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).toLowerCase();
  let n = 0;
  function enhance(sel) {
    if (sel.dataset.spickOn) return; sel.dataset.spickOn = "1";
    const id = "spk" + (++n), wrap = document.createElement("div"), inp = document.createElement("input"), list = document.createElement("div");
    wrap.className = "spick";
    inp.type = "search"; inp.className = "spick-in"; inp.autocomplete = "off"; inp.placeholder = sel.dataset.spick || "ابحث بالاسم أو الكود…";
    inp.setAttribute("role", "combobox"); inp.setAttribute("aria-autocomplete", "list"); inp.setAttribute("aria-expanded", "false"); inp.setAttribute("aria-controls", id);
    list.className = "spick-l"; list.id = id; list.setAttribute("role", "listbox"); list.hidden = true;
    sel.parentNode.insertBefore(wrap, sel); wrap.append(inp, list, sel); sel.hidden = true; sel.tabIndex = -1;
    if (sel.value) { const o = sel.selectedOptions[0]; if (o) inp.value = o.text; }
    let act = 0, shown = [];
    const opts = () => [...sel.options].filter(o => o.value);
    const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); };
    const draw = () => {
      const q = norm(inp.value.trim()), all = opts(), hit = all.filter(o => !q || norm(o.text).includes(q));
      shown = hit.slice(0, 50); act = Math.max(0, Math.min(act, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((o, i) => `<button type="button" role="option" id="${id}-${i}" class="spick-o${i === act ? " on" : ""}" aria-selected="${i === act}" data-i="${i}">${esc(o.text)}</button>`).join("")
        + (hit.length > shown.length ? `<div class="spick-more">${hit.length - shown.length} آخرون · اكتب جزءًا من الاسم أو الكود لتضييق البحث</div>` : "")
        : `<div class="spick-more">لا يوجد اسم أو كود مطابق.</div>`;
      list.hidden = false; inp.setAttribute("aria-expanded", "true");
      if (shown.length) { inp.setAttribute("aria-activedescendant", id + "-" + act); const on = list.children[act]; if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" }); }
    };
    const pick = i => { const o = shown[i]; if (!o) return; sel.value = o.value; inp.value = o.text; close(); sel.dispatchEvent(new Event("change", { bubbles: true })); };
    inp.addEventListener("focus", draw);
    inp.addEventListener("input", () => { act = 0; if (!inp.value && sel.value) { sel.value = ""; } draw(); });
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (list.hidden) return draw(); act = (act + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length); draw(); }
      else if (e.key === "Enter") { if (!list.hidden && shown.length) { e.preventDefault(); pick(act); } }
      else if (e.key === "Escape") { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); } }
    });
    list.addEventListener("mousedown", e => e.preventDefault());
    list.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) pick(+b.dataset.i); });
    inp.addEventListener("blur", () => setTimeout(close, 120));
  }
  const scan = () => document.querySelectorAll("select[data-spick]:not([data-spick-on])").forEach(enhance);
  const start = () => { new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); scan(); };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
})();

/* ===== b170: مسافة بعد اللقب في الأسماء («أ.د.محمد» ← «أ.د. محمد»)، وزر «التالي» في كيبورد الموبايل لخانات الدرجات ===== */
CM.tname = n => String(n == null ? "" : n).replace(/(^|[\s(،])((?:أ\.\s?م\.\s?د|أ\.\s?د|م\.\s?م|د|م|أ)\.)\s*(?=[^\s.\d])/g, "$1$2 ");
document.addEventListener("focusin", e => { const t = e.target; if (t && t.matches && t.matches("input.gb-in, input.gin")) { t.enterKeyHint = "next"; if (!t.getAttribute("inputmode")) t.setAttribute("inputmode", "decimal"); } });
