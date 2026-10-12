/* ============================================================
 * 70-fetch-create
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  /* v13: 拦截 create-project 成功 → 自动在该项目开一个新对话（SPA 跳转，无刷新） */
  try {
    if (window.__wbFetchPatched) return;
    window.__wbFetchPatched = 1;
    var _of = window.fetch;
    window.fetch = function (url, opts) {
      var pr = _of.apply(this, arguments);
      try {
        var u = typeof url === "string" ? url : (url && url.url) || "";
        if (u.indexOf("/api/projects/create-project") >= 0 && opts && opts.method === "POST") {
          pr.then(function (r) {
            try {
              r.clone().json().then(function (j) {
                try {
                  var pp = j && j.project && (j.project.project_path || j.project.path);
                  if (!pp) return;
                  setTimeout(function () {
                    /* 统一创建逻辑 + SPA 跳转（01-shared），不再内联复制 */
                    window.WB.createSession(pp).catch(function () {});
                  }, 400);
                } catch (e2) {}
              }).catch(function () {});
            } catch (e1) {}
          });
        }
      } catch (e0) {}
      return pr;
    };
  } catch (e) { try { console.warn("[wb-fetch]", e); } catch (_) {} }
})();
