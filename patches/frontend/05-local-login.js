/* ============================================================
 * 05-local-login
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 *
 * 本机免登录：启动即写入一枚预置的长期令牌，界面不再要求登录。
 * 令牌由本机 data/home/.cloudcli/auth.db 里的 JWT 密钥（app_config）签发，
 * 随数据目录一起走；换电脑/换盘符依然有效。
 * 若整库重装（auth.db 重建 → 密钥变化），令牌失效，此时照常走注册/登录即可。
 * 详见 patches/README.md「免登录」一节。
 * ============================================================ */

;(function () {
  try {
    var TOKEN = "__WB_LOCAL_TOKEN__";

    /* 1) 启动即补位：没有令牌就写入（在 React 读 token 之前执行） */
    try {
      if (!localStorage.getItem("auth-token")) { localStorage.setItem("auth-token", TOKEN); }
    } catch (e) {}

    /* 2) 令牌被清（点了退出登录 / 过期）时自动补回并回主界面，避免卡在登录页 */
    try {
      window.addEventListener("auth-session-expired", function () {
        try {
          var last = 0;
          try { last = parseInt(sessionStorage.getItem("wb-relogin-ts") || "0", 10) || 0; } catch (e2) {}
          var now = Date.now();
          if (now - last < 4000) { return; }   /* 防重载死循环 */
          sessionStorage.setItem("wb-relogin-ts", String(now));
          localStorage.setItem("auth-token", TOKEN);
          location.reload();
        } catch (e2) {}
      });
    } catch (e) {}
  } catch (e) { try { console.warn("[wb-local-login]", e); } catch (_) {} }
})();
