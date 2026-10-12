// Classmate — shared helpers for the student and staff apps
(function () {
  const cfg = window.CLASSMATE || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON");
  const CM = window.CM = {};
  CM.configured = configured;
  CM.sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

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
  CM.WARN = [{ t: "منتظم", k: "ok" }, { t: "إنذار أول", k: "warn" }, { t: "إنذار ثاني", k: "warn" }, { t: "إنذار ثالث ونهائي", k: "bad" }, { t: "انسحاب إجباري", k: "out" }];
  CM.warnOf = n => CM.WARN[Math.min(Math.max(n, 0), 4)];
  CM.warnChip = n => { const w = CM.warnOf(n); return `<span class="chip ${w.k}">${w.t}</span>`; };

  // server errors -> Arabic
  const ERR = {
    not_allowed: "مش مسموحلك تعمل ده.",
    not_found: "مش لاقيين البيانات دي، يمكن اتغيرت. حدّث الصفحة.",
    session_running: "فيه محاضرة شغالة في المادة دي. أنهيها الأول.",
    session_ended: "المحاضرة دي خلصت. التعديل عليها للمحاضر صاحب المادة بس.",
    wrong_domain: "الإيميل لازم يكون على دومين الجامعة.",
    bad_email: "الإيميل مش صحيح.",
    name_required: "اكتب الاسم.",
    cannot_demote_self: "مينفعش تشيل صلاحية المسؤول من نفسك.",
    cannot_change_self: "مينفعش توقف حسابك انت.",
    domain_locks_you_out: "الدومين ده مش هيسمحلك انت نفسك تدخل. اكتب دومين إيميلك.",
    empty_roster: "الشيت فاضي أو مفيهوش عمود للكود والاسم.",
    confirm_mismatch: "الاسم اللي كتبته مش مطابق لاسم المادة.",
    not_enrolled: "الكود ده مش موجود في شيت أي مادة. اتأكد منه أو كلّم المحاضر.",
    already_registered: "الكود ده عليه حساب قبل كده. ادخل من «دخول». لو مش انت اللي عملته، كلّم المحاضر يمسح الحساب.",
    weak_password: "كلمة السر لازم تكون 6 حروف أو أكتر.",
    bad_pin: "رمز التفعيل غلط.",
    not_registered: "مفيش حساب بالكود ده. اعمل حساب من «أول مرة».",
    bad_password: "كلمة السر غلط.",
    device_mismatch: "الحساب ده مربوط بموبايل تاني. لو غيرت موبايلك أو مسحت بيانات المتصفح، اطلب من المحاضر يفك ربط الجهاز.",
    locked: "حاولت كتير. استنى ربع ساعة وجرب تاني.",
    not_signed_in: "انتهت جلستك. ادخل تاني.",
    bad_device: "المتصفح مش بيحفظ البيانات. اقفل وضع التصفح الخفي وجرب تاني."
  };
  CM.errText = e => {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    for (const k in ERR) if (m.includes(k)) return ERR[k];
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "مفيش اتصال بالإنترنت. اتأكد من الاتصال وجرب تاني.";
    if (/rate limit|too many/i.test(m)) return "طلبات كتير ورا بعض. استنى دقيقة وجرب تاني.";
    if (/Token has expired|invalid/i.test(m) && /otp|token/i.test(m)) return "الكود غلط أو انتهى. اطلب كود جديد.";
    return "حصلت مشكلة: " + m;
  };

  CM.rpc = async (name, args) => {
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

  CM.setupNotice = () => `<div class="panel setup"><h2>التطبيق لسه ما اتربطش بقاعدة البيانات</h2>
    <p class="muted">افتح ملف <span class="mono">config.js</span> وحط فيه Project URL و anon key من Supabase، زي ما هو مشروح في دليل التشغيل.</p></div>`;
})();
