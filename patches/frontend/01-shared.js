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

    /* ---- 打开会话（统一入口，带硬兜底）----
       软跳转（pushState + popstate）不整页重载，快且不闪；万一 App 没响应，
       700ms 后按「标题没换 / 主视图没换」两种情况之一做整页跳转兜底。
       宁可偶尔闪一下，也不要让右侧聊天区停在旧内容上 —— 那正是用户看到的"点了没反应"。
       所有"点会话进聊天"的入口都必须走这里，别再各写一份。 */
    function viewSignature() {
      try {
        var host = document.querySelector("main") || document.body;
        return host ? String(host.textContent || "").length : -1;
      } catch (e) { return -1; }
    }
    WB.openSessionSafe = function (sid) {
      if (!sid) return;
      var href = "/session/" + encodeURIComponent(sid);
      if (location.pathname === href) { return; }
      var headerBefore = "";
      var viewBefore = viewSignature();
      try { var h = document.querySelector("header"); headerBefore = h ? h.textContent : ""; } catch (e0) {}
      try { WB.spaNav(href); } catch (e) { location.assign(href); return; }
      setTimeout(function () {
        try {
          if (location.pathname !== href) { location.assign(href); return; }
          var h2 = document.querySelector("header");
          if ((h2 ? h2.textContent : "") === headerBefore || viewSignature() === viewBefore) {
            location.assign(href);
            return;
          }
          schedulePlaceholderRecover(900);
        } catch (e) {}
      }, 700);
    };

    /* ---- 普通对话卡在「选择您的项目」占位图的兜底 ----
       App 里解析会话归属的逻辑带一个"只试一次"的闩：进入会话时先把会话 id 记进 ref，
       再去拉 /api/providers/sessions/<id>；只要第一次解析失败（项目列表还没就绪、
       请求被打断、404……），之后点同一条对话都不会再解析 —— 右侧就永远停在
       「选择您的项目」占位图。项目会话走的是另一条路（直接在已加载的项目里找），
       所以它们总是好的，普通对话必踩。
       这里在进入会话后检测占位图：2 秒后还在，就整页刷新一次（刷新会重跑整个解析），
       并用 sessionStorage 记录"这个会话已救过一次"，避免死循环。 */
    function paneIsPlaceholder() {
      try {
        if (!/^\/session\//.test(location.pathname)) return false;
        var main = document.querySelector("main") || document.body;
        if (!main) return false;
        /* 正常聊天页一定有输入框；占位图没有 */
        if (main.querySelector("textarea, [contenteditable=\"true\"], .ProseMirror")) return false;
        var txt = String(main.textContent || "");
        return txt.indexOf("选择您的项目") >= 0 || txt.indexOf("選擇您的專案") >= 0
          || txt.indexOf("选择一个项目") >= 0 || /choose (your|a) project/i.test(txt);
      } catch (e) { return false; }
    }
    function currentSid() {
      try {
        var m = String(location.pathname || "").match(/^\/session\/([^/?#]+)/);
        return m ? decodeURIComponent(m[1]) : "";
      } catch (e) { return ""; }
    }
    function recoverPlaceholder() {
      var sid = currentSid();
      if (!sid) return;
      try {
        var k = "wb-placeholder-fix:" + sid;
        if (sessionStorage.getItem(k)) return;              /* 只救一次，防止死循环 */
        sessionStorage.setItem(k, String(Date.now()));
      } catch (e) {}
      try { console.warn("[wb-shared] 会话视图停在占位图，整页刷新重试一次:", sid); } catch (e) {}
      location.assign(location.pathname + location.search);
    }
    function schedulePlaceholderRecover(delay) {
      setTimeout(function () {
        if (!paneIsPlaceholder()) return;
        recoverPlaceholder();
      }, delay || 1500);
      /* 占位图可能先经历 loading 再出现，多看两眼 */
      setTimeout(function () {
        if (paneIsPlaceholder()) recoverPlaceholder();
      }, (delay || 1500) + 1300);
    }
    /* 直接以 /session/... 打开（整页加载、刷新、别人发来的链接）同样兜底 */
    if (/^\/session\//.test(location.pathname)) { schedulePlaceholderRecover(1800); }

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

    /* ---- 会话链接「首点必达」----
       症状：刚打开页面，第一次点某条对话，右侧聊天区没反应，必须再点一次才行。
       原因：侧栏列表是 React 渲染的。页面刚起来时列表还在被数据回填（U 盘读得慢，回填更晚），
       而 HTML 规范规定 click 派发到「按下」与「抬起」两个目标的最近公共祖先；当按下时那个
       <a> 在抬起前被整块替换掉，click 就干脆没了 —— 于是第一次点击凭空消失。
       对策：在捕获阶段记下按下的会话 id，抬起时先让原生 click 跑，120ms 后若地址还没过去，
       由我们自己补一次导航。不依赖原节点是否还在 DOM 里，也不影响右键/中键/新标签打开。 */
    var pressSid = "", pressX = 0, pressY = 0, pressAt = 0;
    function sessionLinkSid(node) {
      try {
        if (!node || !node.closest) return "";
        if (node.closest("[data-wb-action]")) return "";        /* 行内的重命名/删除等操作按钮 */
        if (node.closest("[data-wb-pmenu]")) return "";         /* 项目右键菜单 */
        var a = node.closest('a[href*="/session/"]');
        if (!a) return "";
        var m = String(a.getAttribute("href") || "").match(/\/session\/([^/?#]+)/);
        return m ? decodeURIComponent(m[1]) : "";
      } catch (e) { return ""; }
    }
    document.addEventListener("pointerdown", function (ev) {
      pressSid = "";
      try {
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        pressSid = sessionLinkSid(ev.target);
        pressX = ev.clientX; pressY = ev.clientY; pressAt = Date.now();
      } catch (e) {}
    }, true);
    document.addEventListener("pointercancel", function () { pressSid = ""; }, true);
    document.addEventListener("pointerup", function (ev) {
      try {
        var sid = pressSid; pressSid = "";
        if (!sid) return;
        if (Date.now() - pressAt > 1500) return;
        if (Math.abs(ev.clientX - pressX) > 10 || Math.abs(ev.clientY - pressY) > 10) return;
        setTimeout(function () {
          try { if (location.pathname !== "/session/" + encodeURIComponent(sid)) WB.openSessionSafe(sid); } catch (e) {}
        }, 120);
      } catch (e) {}
    }, true);
  } catch (e) { try { console.warn("[wb-shared]", e); } catch (_) {} }
})();
