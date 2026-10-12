/* ============================================================
 * 00-desktop-prefetch
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  /* v11: 预取桌面路径，供创建项目向导默认填充 */
  try {
    var _t = null;
    try { _t = localStorage.getItem("auth-token"); } catch (e) {}
    if (_t) {
      fetch("/api/projects/wb-desktop", { headers: { Authorization: "Bearer " + _t } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var d = j && j.data && j.data.desktop ? String(j.data.desktop) : "";
          if (!d) return;
          window.__wbDesktop = d;
          var inp = document.querySelector('input[placeholder="/path/to/project/workspace"]');
          if (inp && !inp.value) {
            var key = Object.keys(inp).find(function (k) { return k.indexOf("__reactProps") === 0; });
            if (key && inp[key] && inp[key].onChange) { inp[key].onChange({ target: { value: d } }); }
            else { inp.value = d; }
          }
        }).catch(function () {});
    }
  } catch (e) {}
})();
