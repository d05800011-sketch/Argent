// Заполните три значения (подробности в README.md).
window.APP_CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: "https://ВАШ-ПРОЕКТ.supabase.co",
  SUPABASE_ANON_KEY: "ВАШ_ANON_PUBLIC_КЛЮЧ",
  // Адрес Cloudflare Worker (без слэша в конце)
  WORKER_URL: "https://argent-proxy.ВАШ-АККАУНТ.workers.dev",
  // Лимит бесплатного Supabase Storage на один файл
  MAX_BYTES: 50 * 1024 * 1024,

  // Данные владельца сайта для документов (политика, условия, согласие, лицензия).
  // Пока поле пустое, на страницах оно подсвечивается жёлтым как «заполните».
  OPERATOR: {
    name: "",          // ФИО (физлицо / самозанятый / ИП) или название организации
    email: "",         // почта для обращений по данным и жалоб на контент
    details: "",       // ИНН / ОГРНИП / ОГРН и адрес, если есть
    serverRegion: "",  // регион проекта Supabase, например «Франкфурт (ЕС)»
    imageCredit: ""    // автор и источник фонового изображения
  }
};
