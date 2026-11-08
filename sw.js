// Кеширует оболочку приложения, чтобы она открывалась мгновенно.
// Запросы к Supabase и Worker всегда идут в сеть.
const CACHE = "argent-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json", "icon.svg", "icon-180.png", "bg.jpg", "legal.js", "privacy.html", "terms.html", "cookies.html", "consent.html", "license.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Сначала сеть, при отсутствии интернета — кеш.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});
