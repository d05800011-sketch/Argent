// Cloudflare Worker: бесплатный прокси для скачивания видео по прямой ссылке.
// Нужен, потому что браузер не может напрямую качать файлы с чужих сайтов (CORS).
//
// Переменные (Settings → Variables):
//   SUPABASE_URL      https://xxxx.supabase.co
//   SUPABASE_ANON_KEY ваш anon public ключ
//   ALLOWED_ORIGIN    https://ВАШ-ЛОГИН.github.io   (адрес сайта; без пути и слэша)
//   MAX_BYTES         необязательно, по умолчанию 52428800 (50 МБ)

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Expose-Headers": "X-Content-Length, Content-Type",
      "Vary": "Origin"
    };
    const fail = (error, status) =>
      new Response(JSON.stringify({ error }), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return fail("Метод не поддерживается", 405);

    const origin = req.headers.get("Origin") || "";
    if (allowed !== "*" && origin && origin !== allowed) return fail("Запрещённый источник", 403);

    // Только вошедшие пользователи: проверяем токен в Supabase.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("Нужно войти в аккаунт", 401);
    const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY }
    });
    if (!who.ok) return fail("Сессия недействительна, войдите снова", 401);

    // Проверяем ссылку.
    let target;
    try {
      target = new URL(new URL(req.url).searchParams.get("url") || "");
    } catch {
      return fail("Некорректная ссылка", 400);
    }
    if (!/^https?:$/.test(target.protocol)) return fail("Нужна ссылка http или https", 400);
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(target.hostname) || !target.hostname.includes(".")) {
      return fail("Эта ссылка не подходит", 400);
    }

    let up;
    try {
      up = await fetch(target.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
          "Accept": "video/*,*/*;q=0.8"
        }
      });
    } catch {
      return fail("Не удалось подключиться к сайту по ссылке", 502);
    }
    if (!up.ok) return fail(`Сайт ответил ошибкой ${up.status}`, 502);

    const type = (up.headers.get("content-type") || "").toLowerCase();
    const isFile = type.startsWith("video/") || type.includes("octet-stream");
    if (!isFile) {
      return fail("Это не прямая ссылка на видеофайл. Для ссылок на платформы нужен экстрактор (см. настройки).", 415);
    }

    const max = Number(env.MAX_BYTES) || 52428800;
    const len = Number(up.headers.get("content-length")) || 0;
    if (len > max) return fail("Файл больше 50 МБ — бесплатное хранилище его не примет", 413);

    return new Response(up.body, {
      status: 200,
      headers: { ...cors, "Content-Type": type, "X-Content-Length": String(len || "") }
    });
  }
};
