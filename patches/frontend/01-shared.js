/* ============================================================
 * 01-shared
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 *
 * 共享设施（window.WB）：
 *   WB.modal(opts)        自定义弹窗（替代原生 prompt/confirm/alert）
 *   WB.createSession(projectPath)  创建/复用待发送会话并 SPA 跳转，返回 Promise<sessionId>
 *   WB.spaNav(url)        pushState + popstate，React Router 同步零刷新
 *   WB.onMutate(fn)       统一 MutationObserver 注册（全包共用一个观察者）
 *   WB.token()            localStorage auth-token
 *   WB.isTouch            触屏设备（hover 不可用）
 *   WB.refreshSidebar()   触发应用自带的「刷新项目和会话」（新会话立刻出现在左侧列表）
 * ============================================================ */

;(function () {
  try {
    if (window.WB && window.WB.__v) { return; }
    var WB = window.WB = { __v: 1 };

    WB.isTouch = false;
    try { WB.isTouch = window.matchMedia && window.matchMedia("(hover: none), (pointer: coarse)").matches; } catch (e) {}

    WB.token = function () { try { return localStorage.getItem("auth-token"); } catch (e) { return null; } };

    /* ---- 统一弹窗 ---- */
    WB.modal = function (opts) {
      try {
        opts = opts || {};
        var old = document.getElementById("wb-modal-mask"); if (old) old.parentNode.removeChild(old);
        var mask = document.createElement("div"); mask.id = "wb-modal-mask";
        mask.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(15,18,25,.38);display:flex;align-items:center;justify-content:center;";
        var card = document.createElement("div");
        card.style.cssText = "background:hsl(var(--popover,0 0% 100%));color:hsl(var(--popover-foreground,215 25% 27%));border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.24);width:300px;max-width:86vw;padding:16px 16px 12px;font-size:13px;";
        var t = document.createElement("div"); t.textContent = opts.title || ""; t.style.cssText = "font-weight:600;font-size:14px;";
        card.appendChild(t);
        if (opts.message) { var m = document.createElement("div"); m.textContent = opts.message; m.style.cssText = "margin-top:6px;line-height:1.55;color:hsl(var(--muted-foreground,215 16% 47%));white-space:pre-line;"; card.appendChild(m); }
        var input = null;
        if (opts.input != null) {
          input = document.createElement("input"); input.type = "text";
          input.value = opts.input;
          input.style.cssText = "display:block;width:100%;box-sizing:border-box;border:1px solid hsl(var(--border,215 15% 88%));border-radius:8px;padding:7px 9px;font-size:13px;margin-top:10px;outline:none;background:hsl(var(--background,0 0% 100%));color:inherit;";
          input.onfocus = function () { input.style.borderColor = "#D97757"; input.style.boxShadow = "0 0 0 3px rgba(217,119,87,.15)"; };
          input.onblur = function () { input.style.borderColor = "hsl(var(--border,215 15% 88%))"; input.style.boxShadow = "none"; };
          card.appendChild(input);
        }
        /* 自定义内容区（如下拉框），由调用方填充 */
        if (opts.body && opts.body.nodeType === 1) { card.appendChild(opts.body); }
        var row = document.createElement("div"); row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:14px;";
        function btn(label, primary, danger, fn) {
          var b = document.createElement("button"); b.type = "button"; b.textContent = label;
          b.style.cssText = "border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;border:1px solid transparent;" + (primary ? (danger ? "background:#dc2626;color:#fff;" : "background:#D97757;color:#fff;") : "background:transparent;border-color:hsl(var(--border,215 15% 88%));color:inherit;");
          b.onmouseenter = function () { if (primary) b.style.opacity = ".9"; else b.style.background = "hsl(var(--accent,210 40% 96%))"; };
          b.onmouseleave = function () { b.style.opacity = "1"; if (!primary) b.style.background = "transparent"; };
          b.onclick = fn;
          row.appendChild(b);
        }
        function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); document.removeEventListener("keydown", key, true); }
        function confirmAction() { var v = input ? input.value : undefined; close(); if (opts.onConfirm) opts.onConfirm(v); }
        function key(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "Enter" && opts.input != null) { e.stopPropagation(); confirmAction(); } }
        btn("取消", false, false, close);
        btn(opts.confirmText || "确定", true, !!opts.danger, confirmAction);
        card.appendChild(row);
        mask.appendChild(card);
        mask.addEventListener("mousedown", function (ev) { if (ev.target === mask) close(); });
        document.body.appendChild(mask);
        document.addEventListener("keydown", key, true);
        if (input) { input.focus(); input.select(); }
      } catch (e) {}
    };

    /* ---- SPA 跳转 ---- */
    WB.spaNav = function (url) {
      try {
        history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      } catch (e) { location.href = url; }
    };

    /* ---- 新建会话状态 ----
       “新建对话”代表进入一个可填写的草稿会话。连续点击、切走后再次点击，
       应回到同一个尚未发送的会话；首次发送完成后由 chat-ux 调用 finalize 解除复用。 */
    var PENDING_SESSION_TTL = 24 * 60 * 60 * 1000;
    var pendingCreates = {};
    function sessionScope(projectPath) {
      var value = String(projectPath || "").trim();
      return value || "@plain";
    }
    function pendingKey(scope) { return "wb-pending-session:" + scope; }
    function readPending(scope) {
      try {
        var raw = localStorage.getItem(pendingKey(scope));
        if (!raw) return null;
        var item = JSON.parse(raw);
        if (!item || !item.sid || !item.createdAt || Date.now() - Number(item.createdAt) > PENDING_SESSION_TTL) {
          localStorage.removeItem(pendingKey(scope));
          return null;
        }
        return item;
      } catch (e) { return null; }
    }
    function writePending(scope, sid) {
      try { localStorage.setItem(pendingKey(scope), JSON.stringify({ sid: sid, scope: scope, createdAt: Date.now() })); } catch (e) {}
    }
    function removePending(scope, sid) {
      try {
        var item = readPending(scope);
        if (!sid || !item || item.sid === sid) localStorage.removeItem(pendingKey(scope));
      } catch (e) {}
    }
    WB.finalizePendingSession = function (sid) {
      if (!sid) return;
      try {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf("wb-pending-session:") === 0) keys.push(key);
        }
        keys.forEach(function (key) {
          try {
            var item = JSON.parse(localStorage.getItem(key) || "null");
            if (item && item.sid === sid) localStorage.removeItem(key);
          } catch (e) {}
        });
      } catch (e) {}
    };

    function openSession(sid) {
      var href = "/session/" + encodeURIComponent(sid);
      /* 软跳转打开新会话（不整页重载 → 不闪）。左侧列表靠下面两步补齐：
         先让我们自己的项目区重新拉取，再触发应用自带的「刷新项目和会话」；
         若 2.6 秒后地址没变、或左侧仍没有这条会话，才整页跳转兜底（一定会正确）。 */
      try { if (location.pathname !== href) window.WB.spaNav(href); } catch (e) { location.assign(href); return; }
      setTimeout(function () { try { if (window.WB.refreshProjects) { window.WB.refreshProjects(); } } catch (e) {} }, 500);
      setTimeout(function () { try { if (window.WB.refreshSidebar) { window.WB.refreshSidebar(); } } catch (e) {} }, 900);
      setTimeout(function () {
        try {
          if (location.pathname !== href) { location.assign(href); return; }
          var listed = !!document.querySelector('a[href*="' + sid + '"]') || !!document.querySelector('[data-sid="' + sid + '"]');
          if (!listed) { location.assign(href); }
        } catch (e) {}
      }, 2600);
    }

    /* ---- 创建会话并跳转（20/30/70 共用，勿再复制） ---- */
    WB.createSession = function (projectPath) {
      var scope = sessionScope(projectPath);
      var existing = readPending(scope);
      if (existing) { openSession(existing.sid); return Promise.resolve(existing.sid); }
      if (pendingCreates[scope]) return pendingCreates[scope];
      var request = fetch("/api/providers/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (WB.token() || "") },
        body: JSON.stringify({ provider: "claude", projectPath: projectPath || "", initialMessage: "" })
      }).then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status); }
        return r.json();
      }).then(function (data) {
        var sid = data && data.data && data.data.sessionId;
        if (!sid) { throw new Error("未返回 sessionId"); }
        writePending(scope, sid);
        /* 新建会话固定使用快速模型；历史会话的模型选择不受影响。 */
        return fetch("/api/providers/claude/sessions/" + encodeURIComponent(sid) + "/active-model", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (WB.token() || "") },
          body: JSON.stringify({ model: "mimo-v2.6-flash" })
        }).catch(function () {}).then(function () {
          openSession(sid);
          return sid;
        });
      }).finally(function () { delete pendingCreates[scope]; });
      pendingCreates[scope] = request;
      return request;
    };

    /* ---- 触发应用自带的「刷新项目和会话」 ---- */
    WB.refreshSidebar = function () {
      try {
        /* title 里的 Ctrl+R 是应用自带提示文案（各语言一致），全站独一无二，
           不会误点到 Git 面板的「刷新」按钮 */
        var cands = document.querySelectorAll('[title*="Ctrl+R"]');
        var first = null;
        for (var i = 0; i < cands.length; i++) {
          var b = cands[i];
          if (!first) { first = b; }
          if (b.offsetWidth > 0 || b.offsetHeight > 0) { b.click(); return true; }
        }
        if (first) { first.click(); return true; }
      } catch (e) {}
      return false;
    };

    /* ---- 统一 DOM 观察者：全包只挂一个 MutationObserver ---- */
    var cbs = [];
    var pending = null;
    var obs = new MutationObserver(function () {
      if (pending) { return; }
      pending = setTimeout(function () {
        pending = null;
        for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) {} }
      }, 180);
    });
    function start() { try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {} }
    WB.onMutate = function (fn) { cbs.push(fn); };
    if (document.body) { start(); }
    else { document.addEventListener("DOMContentLoaded", start); }
  } catch (e) { try { console.warn("[wb-shared]", e); } catch (_) {} }
})();
