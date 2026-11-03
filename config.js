// =====================================================
// Hadro — الإعدادات
// Project URL و anon public key من Supabase
// (المفتاح ده عام ومش سر، الحماية كلها جوه قاعدة البيانات)
// =====================================================
window.CLASSMATE = {
  SUPABASE_URL: "https://bzurzvcfxlpfhcnuksyd.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6dXJ6dmNmeGxwZmhjbnVrc3lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MDQwNjcsImV4cCI6MjEwNzM4MDA2N30.0p0ZvTs6R7L54KDakkCX3JoZUrASO4uvmnZ8jE_cpZY",
  UNIVERSITY_NAME: "كلية الفنون الجميلة · جامعة العاصمة",
  // تسليم التكليفات على Google Drive الخاص بالطالب (من Google Cloud Console، وكلاهما عام وليس سرًّا)
  // اتركهما فارغين ليسلّم الطلبة روابط فقط
  GOOGLE_CLIENT_ID: "546157853909-vjtbkhu37tddajs2f48uleb67fmmc4fm.apps.googleusercontent.com",
  GOOGLE_API_KEY: "AIzaSyAEjU3kV6Qz9jR7r2fk8nJiPBSTz_55VeE",
  // اجعلها true بعد إضافة https://elrashdan.github.io/classmate/ إلى Authorized redirect URIs في Google Cloud Console
  // (تُظهر للطالب طريقة بديلة للاتصال بـ Google إن أُغلقت النافذة المنبثقة)
  GOOGLE_REDIRECT: true,
  // مفتاح إشعارات الهاتف (Web Push) العام؛ الخاص في أسرار دالة الحافة «push» فقط
  VAPID_PUBLIC_KEY: "BPnjo_-EKjQK9CSi1rbYQHYxh4TyRogMYH0oX1DRtS1cgeFD_BNkaNrVQpXwIPHaJQFig2furf-yaNrMGK0XDIg"
};
