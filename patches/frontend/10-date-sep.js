/* ============================================================
 * 10-date-sep
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  try {
    var SEP = "wb-date-sep";
    var pending = null;
    function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    function labelFor(dtAttr, txt) {
      var when = null;
      if (dtAttr) { var d = new Date(dtAttr); if (!isNaN(d.getTime())) when = d; }
      if (when) {
        var today = dayStart(new Date());
        var day = dayStart(when);
        if (day === today) return "今天";
        if (day === today - 86400000) return "昨天";
        return "更早";
      }
      if (txt) {
        if (txt === "昨天") return "昨天";
        if (txt === "刚刚" || txt.indexOf("分钟前") >= 0 || txt.indexOf("小时前") >= 0 || /^[0-9]+\s*[smh]$/.test(txt)) return "今天";
      }
      return null;
    }
    /* 共享观察者版：apply 自带「无变化零写入」守卫，避免自身 DOM 改动触发循环 */
    function apply() {
      try {
        var rows = document.querySelectorAll('a[data-testid="recent-conversation-row"]');
        var olds = document.querySelectorAll("." + SEP);
        /* 期望的分组序列 */
        var want = [];
        var last = null;
        for (var j = 0; j < rows.length; j++) {
          var row = rows[j];
          var tm = row.querySelector("time");
          var label = tm ? labelFor(tm.getAttribute("datetime") || "", tm.textContent ? tm.textContent.trim() : "") : null;
          if (!label || label === last) continue;
          last = label;
          want.push({ label: label, row: row });
        }
        /* 现状与期望一致：不做任何 DOM 写入（守卫，防止无限循环） */
        if (olds.length === want.length) {
          var same = true;
          for (var s = 0; s < olds.length; s++) { if (olds[s].textContent !== want[s].label) { same = false; break; } }
          if (same) return;
        }
        for (var i = 0; i < olds.length; i++) { if (olds[i].parentNode) olds[i].parentNode.removeChild(olds[i]); }
        for (var w = 0; w < want.length; w++) {
          var head = document.createElement("div");
          head.className = SEP;
          head.textContent = want[w].label;
          head.style.cssText = "padding:12px 10px 3px;font-size:10px;font-weight:500;letter-spacing:.02em;color:hsl(var(--muted-foreground,215 16% 47%));opacity:.8;user-select:none;";
          want[w].row.parentNode.insertBefore(head, want[w].row);
        }
      } catch (e) {}
    }
    function schedule() { if (pending) clearTimeout(pending); pending = setTimeout(function () { pending = null; apply(); }, 120); }
    /* 共享观察者（01-shared）：DOM 变化统一回调 */
    window.WB.onMutate(function () { schedule(); });
    apply();
  } catch (e) { try { console.warn("[wb-date-sep]", e); } catch (_) {} }
})();
