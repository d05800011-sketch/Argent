"use strict";

const cfg = window.APP_CONFIG;
const $ = (s) => document.querySelector(s);
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

let session = null;
let registerMode = false;
const blobCache = new Map(); // id -> Blob (для сохранения в «Файлы»)

/* ---------------- Утилиты ---------------- */
function toast(text, ms = 3200) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function fmtSize(b) {
  if (!b) return "";
  if (b < 1048576) return Math.round(b / 1024) + " КБ";
  return (b / 1048576).toFixed(1) + " МБ";
}

function safeName(s) {
  return (s || "video").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "video";
}

function titleFromUrl(u) {
  try {
    const name = decodeURIComponent(new URL(u).pathname.split("/").pop() || "");
    return name.replace(/\.[a-z0-9]{2,5}$/i, "") || "Видео";
  } catch {
    return "Видео";
  }
}

function errText(e) {
  const m = (e && e.message) || String(e);
  if (/Invalid login credentials/i.test(m)) return "Неверная почта или пароль.";
  if (/already registered/i.test(m)) return "Эта почта уже зарегистрирована. Нажмите «Войти».";
  if (/Email not confirmed/i.test(m)) return "Подтвердите почту по письму и войдите снова.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Нет связи с сервером. Проверьте интернет и config.js.";
  return m;
}

/* ---------------- Экраны ---------------- */
function show(screen) {
  $("#authScreen").hidden = screen !== "auth";
  $("#appScreen").hidden = screen !== "app";
}

function setTab(id) {
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== id));
  document.querySelectorAll(".tabbtn").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  if (id === "tabLibrary") loadLibrary();
}

document.querySelectorAll(".tabbtn").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

/* ---------------- Вход и регистрация ---------------- */
$("#authToggle").addEventListener("click", () => {
  registerMode = !registerMode;
  $("#authBtn").textContent = registerMode ? "Создать аккаунт" : "Войти";
  $("#authToggle").textContent = registerMode ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться";
  $("#password").autocomplete = registerMode ? "new-password" : "current-password";
  $("#authMsg").textContent = "";
  setConsents();
});

function setConsents() {
  $("#consents").hidden = !registerMode;
  ["agreeTerms", "agreePd"].forEach((id) => {
    $("#" + id).required = registerMode;
    if (!registerMode) $("#" + id).checked = false;
  });
}

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#authMsg");
  const btn = $("#authBtn");
  msg.className = "msg";
  msg.textContent = "";
  btn.disabled = true;
  const email = $("#email").value.trim();
  const password = $("#password").value;
  try {
    if (registerMode) {
      if (!$("#agreeTerms").checked || !$("#agreePd").checked) {
        throw new Error("Для регистрации отметьте оба пункта согласия.");
      }
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        msg.className = "msg ok";
        msg.textContent = "Готово! Подтвердите почту по письму, затем войдите.";
        registerMode = false;
        $("#authBtn").textContent = "Войти";
        $("#authToggle").textContent = "Нет аккаунта? Зарегистрироваться";
        $("#password").autocomplete = "current-password";
        setConsents();
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    msg.textContent = errText(err);
  } finally {
    btn.disabled = false;
  }
});

sb.auth.onAuthStateChange((_event, s) => {
  session = s;
  if (s) {
    $("#who").textContent = s.user.email;
    show("app");
    setTab("tabDownload");
  } else {
    blobCache.clear();
    show("auth");
  }
});

/* ---------------- Настройки ---------------- */
$("#settingsBtn").addEventListener("click", () => {
  try { $("#extractor").value = localStorage.getItem("extractor") || ""; } catch {}
  $("#sheet").hidden = false;
});
$("#closeSheet").addEventListener("click", () => ($("#sheet").hidden = true));
$("#saveSettings").addEventListener("click", () => {
  try { localStorage.setItem("extractor", $("#extractor").value.trim()); } catch {}
  $("#sheet").hidden = true;
  toast("Сохранено");
});
$("#logout").addEventListener("click", async () => {
  $("#sheet").hidden = true;
  await sb.auth.signOut();
});

$("#deleteAccount").addEventListener("click", async () => {
  if (!confirm("Удалить аккаунт и ВСЕ ваши видео? Это действие нельзя отменить.")) return;
  const btn = $("#deleteAccount");
  btn.disabled = true;
  try {
    const { data, error } = await sb.from("videos").select("path");
    if (error) throw error;
    const paths = data.map((v) => v.path);
    for (let i = 0; i < paths.length; i += 100) {
      const r = await sb.storage.from("videos").remove(paths.slice(i, i + 100));
      if (r.error) throw r.error;
    }
    const d = await sb.rpc("delete_my_account");
    if (d.error) throw d.error;
    $("#sheet").hidden = true;
    await sb.auth.signOut({ scope: "local" });
    toast("Аккаунт и все данные удалены", 5000);
  } catch (err) {
    toast(errText(err), 5000);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- Скачивание ---------------- */
const looksDirect = (u) => /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(u);

async function resolveViaExtractor(extractor, url) {
  // Совместимо с API cobalt: POST / {url} -> {status, url}
  const r = await fetch(extractor.replace(/\/+$/, "") + "/", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error((j.error && (j.error.code || j.error)) || "Экстрактор не смог обработать ссылку");
  return j.url;
}

function setProgress(pct, text, indeterminate = false) {
  $("#progress").hidden = false;
  $(".bar").classList.toggle("indet", indeterminate);
  $("#barFill").style.width = indeterminate ? "" : pct + "%";
  $("#progText").textContent = text;
}

$("#dlForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#dlBtn");
  let url = $("#url").value.trim();
  const customTitle = $("#title").value.trim();
  btn.disabled = true;
  setProgress(0, "Подготовка…", true);

  try {
    if (!session) throw new Error("Нужно войти в аккаунт.");

    let extractor = "";
    try { extractor = localStorage.getItem("extractor") || ""; } catch {}
    const original = url;
    if (extractor && !looksDirect(url)) {
      setProgress(0, "Ищу видео…", true);
      url = await resolveViaExtractor(extractor, url);
    }

    const res = await fetch(`${cfg.WORKER_URL}/?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Ошибка сервера (${res.status})`);
    }

    const total = Number(res.headers.get("x-content-length")) || 0;
    if (total && total > cfg.MAX_BYTES) throw new Error(`Файл больше ${fmtSize(cfg.MAX_BYTES)} — бесплатное хранилище его не примет.`);

    const type = (res.headers.get("content-type") || "video/mp4").split(";")[0];
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (got > cfg.MAX_BYTES) {
        reader.cancel();
        throw new Error(`Файл больше ${fmtSize(cfg.MAX_BYTES)} — бесплатное хранилище его не примет.`);
      }
      if (total) setProgress(Math.min(99, Math.round((got / total) * 100)), `${Math.round((got / total) * 100)}% · ${fmtSize(got)}`);
      else setProgress(0, fmtSize(got), true);
    }
    const blob = new Blob(chunks, { type: type === "application/octet-stream" ? "video/mp4" : type });

    setProgress(100, "Сохраняю в библиотеку…", true);
    const id = crypto.randomUUID();
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : "mp4";
    const path = `${session.user.id}/${id}.${ext}`;

    const up = await sb.storage.from("videos").upload(path, blob, { contentType: blob.type, upsert: false });
    if (up.error) throw up.error;

    const ins = await sb.from("videos").insert({
      id,
      title: customTitle || titleFromUrl(original),
      source_url: original,
      path,
      size: blob.size
    });
    if (ins.error) {
      await sb.storage.from("videos").remove([path]);
      throw ins.error;
    }

    blobCache.set(id, blob);
    $("#url").value = "";
    $("#title").value = "";
    $("#progress").hidden = true;
    toast("Видео сохранено в библиотеке ✓");
    setTab("tabLibrary");
  } catch (err) {
    $("#progress").hidden = true;
    toast(errText(err), 5000);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- Библиотека ---------------- */
async function loadLibrary() {
  const list = $("#list");
  const { data, error } = await sb.from("videos").select("*").order("created_at", { ascending: false });
  if (error) {
    toast(errText(error), 5000);
    return;
  }
  list.innerHTML = "";
  $("#empty").hidden = data.length > 0;
  if (!data.length) return;

  const signed = await sb.storage.from("videos").createSignedUrls(data.map((v) => v.path), 3600);
  const urlByPath = {};
  (signed.data || []).forEach((s) => (urlByPath[s.path] = s.signedUrl));

  for (const v of data) {
    v.url = urlByPath[v.path];
    list.appendChild(renderItem(v));
  }
}

function renderItem(v) {
  const el = document.createElement("article");
  el.className = "glass item";

  const vid = document.createElement("video");
  vid.src = v.url ? v.url + "#t=0.1" : "";
  vid.preload = "metadata";
  vid.muted = true;
  vid.playsInline = true;
  vid.addEventListener("click", () => openPlayer(v));

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = v.title;
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `${fmtSize(v.size)} · ${new Date(v.created_at).toLocaleDateString("ru-RU")}`;
  meta.append(name, sub);

  const row = document.createElement("div");
  row.className = "row";

  const save = document.createElement("button");
  save.className = "btn sm";
  save.textContent = "В «Файлы»";
  save.addEventListener("click", () => saveToFiles(v, save));

  const del = document.createElement("button");
  del.className = "btn sm danger";
  del.textContent = "Удалить";
  del.addEventListener("click", () => removeVideo(v, el));

  row.append(save, del);
  el.append(vid, meta, row);
  return el;
}

function openPlayer(v) {
  const p = $("#playerVideo");
  p.src = v.url;
  $("#player").hidden = false;
  p.play().catch(() => {});
}
$("#closePlayer").addEventListener("click", () => {
  const p = $("#playerVideo");
  p.pause();
  p.removeAttribute("src");
  p.load();
  $("#player").hidden = true;
});

async function removeVideo(v, el) {
  if (!confirm(`Удалить «${v.title}»?`)) return;
  const a = await sb.storage.from("videos").remove([v.path]);
  if (a.error) return toast(errText(a.error), 5000);
  const b = await sb.from("videos").delete().eq("id", v.id);
  if (b.error) return toast(errText(b.error), 5000);
  blobCache.delete(v.id);
  el.remove();
  if (!$("#list").children.length) $("#empty").hidden = false;
  toast("Удалено");
}

/* Сохранение в «Файлы» на iPhone: через системное меню «Поделиться».
   Safari разрешает его открыть только сразу после нажатия, поэтому
   сначала готовим файл (1-е нажатие), затем открываем меню (2-е). */
async function saveToFiles(v, btn) {
  try {
    let blob = blobCache.get(v.id);
    if (!blob) {
      btn.disabled = true;
      btn.textContent = "Готовлю…";
      const r = await fetch(v.url);
      if (!r.ok) throw new Error("Не удалось загрузить файл");
      blob = await r.blob();
      blobCache.set(v.id, blob);
      btn.disabled = false;
      btn.textContent = "Нажмите ещё раз";
      return;
    }
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : "mp4";
    const file = new File([blob], `${safeName(v.title)}.${ext}`, { type: blob.type || "video/mp4" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: v.title });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    btn.textContent = "В «Файлы»";
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "В «Файлы»";
    if (err && err.name !== "AbortError") toast(errText(err), 5000);
  }
}

/* ---------------- Уведомление о хранении данных ---------------- */
try {
  if (!localStorage.getItem("notice_ok")) $("#notice").hidden = false;
} catch {
  $("#notice").hidden = false;
}
$("#noticeOk").addEventListener("click", () => {
  $("#notice").hidden = true;
  try { localStorage.setItem("notice_ok", "1"); } catch {}
});

/* ---------------- Старт ---------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

sb.auth.getSession().then(({ data }) => {
  if (!data.session) show("auth");
});
