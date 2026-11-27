/**
 * الإعدادات العامة للنظام المالي (الحضور والنبطشيات والسهر)
 * ملاحظة: يمكنك وضع رابط Google Apps Script Web App هنا مباشرة ليعمل تلقائياً
 * على جميع الأجهزة بمجرد فتح الموقع دون الحاجة لإدخاله يدوياً على كل جهاز.
 */
window.APP_CONFIG = {
  // رابط النشر الثابت (Web App URL) الخاص بـ Google Apps Script ليعمل تلقائياً على كل الأجهزة:
  DEFAULT_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbz4QIUw9-CxQ5F3Az6vWgdkhHv3BTOBsJJdsWZiQoEa2TP72DSBKpr0UTvxg8AcQ88Arw/exec",

  // الفاصل الزمني للمزامنة التلقائية في الخلفية (بالمللي ثانية) - 12 ثانية
  AUTO_POLL_INTERVAL_MS: 12000,

  // مهلة الحفظ التلقائي بعد آخر تعديل في الخلية (بالمللي ثانية)
  AUTO_SAVE_DEBOUNCE_MS: 1200,

  // الرموز المعتمدة في خلايا أيام الشهر (قابلة للدمج مثل: ح+ن أو ح+س2 أو ح+ن+س3)
  STATUS_CODES: {
    "ح": { label: "حضور", short: "ح", badgeClass: "code-att", color: "#059669", bg: "#ecfdf5" },
    "ن": { label: "نبطشية", short: "ن", badgeClass: "code-shift", color: "#2563eb", bg: "#eff6ff" },
    "س": { label: "سهر", short: "س", badgeClass: "code-overtime", color: "#d97706", bg: "#fffbeb" },
    "ح+ن": { label: "حضور + نبطشية", short: "ح+ن", badgeClass: "code-att-shift", color: "#1d4ed8", bg: "#e0f2fe" },
    "ح+س": { label: "حضور + سهر", short: "ح+س", badgeClass: "code-att-ot", color: "#0f766e", bg: "#f0fdfa" },
    "ح+ن+س": { label: "حضور + نبطشية + سهر", short: "ح+ن+س", badgeClass: "code-triple", color: "#6d28d9", bg: "#f5f3ff" },
    "غ": { label: "غياب", short: "غ", badgeClass: "code-absent", color: "#dc2626", bg: "#fef2f2" },
    "إ": { label: "إجازة", short: "إ", badgeClass: "code-leave", color: "#7c3aed", bg: "#f5f3ff" },
    "م": { label: "مأمورية", short: "م", badgeClass: "code-mission", color: "#0284c7", bg: "#f0f9ff" },
    "ر": { label: "راحة", short: "ر", badgeClass: "code-rest", color: "#0e7490", bg: "#ecfeff" },
    "ع": { label: "عطلة", short: "ع", badgeClass: "code-off", color: "#64748b", bg: "#f1f5f9" }
  },

  ARABIC_MONTHS: [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
  ],

  ARABIC_DAYS_SHORT: ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"]
};
