// Подставляет данные владельца из config.js в юридические страницы.
(function () {
  var op = (window.APP_CONFIG && window.APP_CONFIG.OPERATOR) || {};
  document.querySelectorAll("[data-op]").forEach(function (el) {
    var v = (op[el.dataset.op] || "").trim();
    if (v) { el.textContent = v; } else { el.innerHTML = "<mark>[ЗАПОЛНИТЕ: " + el.textContent.trim() + "]</mark>"; }
  });
  document.querySelectorAll("a[data-op-mail]").forEach(function (a) {
    var v = (op.email || "").trim();
    if (v) { a.href = "mailto:" + v; a.textContent = v; }
  });
})();
