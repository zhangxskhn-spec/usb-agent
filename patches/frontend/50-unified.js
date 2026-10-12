/* ============================================================
 * 50-unified
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  try {
    var pending = null, switched = false;
    function qBtn(t) {
      var all = document.querySelectorAll("button");
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        if (b.offsetWidth < 1) continue;
        var host = b.closest && b.closest('[class*="bg-muted/50"]');
        if (!host) continue;
        if ((b.textContent || "").trim() === t) return b;
      }
      return null;
    }
    function ensure() {
      try {
        var proj = qBtn("\u9879\u76ee"), conv = qBtn("\u5bf9\u8bdd");
        if (!proj && !conv) return;
        if (!switched) {
          var ph = document.querySelector('input[placeholder="\u641c\u7d22\u9879\u76ee..."]');
          if (ph && conv) { conv.click(); switched = true; }
          else if (!ph) { switched = true; }
        }
        if (proj) proj.style.display = "none";
        if (conv) conv.style.display = "none";
      } catch (e) {}
    }
    /* 共享观察者（01-shared）：DOM 变化统一回调 */
    window.WB.onMutate(function () { if (pending) return; pending = setTimeout(function () { pending = null; try { ensure(); } catch (e) {} }, 250); });
    ensure();
  } catch (e) { try { console.warn("[wb-unified]", e); } catch (_) {} }
})();
