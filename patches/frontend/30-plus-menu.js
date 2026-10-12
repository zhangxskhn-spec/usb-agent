/* ============================================================
 * 30-plus-menu
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  try {
    var MENU_ID = "wb-plus-menu";
    var allowNative = false;
    var pending = null;
    var menu = null;
    var hideTimer = null;

    function svgIcon(pathD) {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "15");
      svg.setAttribute("height", "15");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.style.cssText = "flex:0 0 auto;opacity:.7;";
      var pth = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pth.setAttribute("d", pathD);
      svg.appendChild(pth);
      return svg;
    }

    function makeMenu() {
      var m = document.createElement("div");
      m.id = MENU_ID;
      m.style.cssText = "position:fixed;z-index:9999;display:none;min-width:132px;padding:5px;border-radius:10px;border:1px solid hsl(var(--border,240 5.9% 90%));background:hsl(var(--popover,0 0% 100%));color:hsl(var(--popover-foreground,240 10% 3.9%));box-shadow:0 8px 24px rgba(0,0,0,.13);font-size:13px;";
      function item(label, svgPath) {
        var b = document.createElement("button");
        b.type = "button";
        b.style.cssText = "display:flex;width:100%;align-items:center;gap:8px;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:7px;padding:7px 9px;font-size:13px;text-align:left;white-space:nowrap;";
        b.onmouseenter = function () { b.style.background = "hsl(var(--accent,240 4.8% 95.9%))"; };
        b.onmouseleave = function () { b.style.background = "transparent"; };
        b.appendChild(svgIcon(svgPath));
        var t = document.createElement("span");
        t.textContent = label;
        b.appendChild(t);
        m.appendChild(b);
        return b;
      }
      var newChat = item("新对话", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
      var newProject = item("新项目", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z");
      return { el: m, newChat: newChat, newProject: newProject };
    }

    function hide() { if (menu) { menu.el.style.display = "none"; } }
    function show(btn) {
      if (!menu) { return; }
      var r = btn.getBoundingClientRect();
      menu.el.style.display = "block";
      var mw = menu.el.offsetWidth || 140;
      var left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
      menu.el.style.left = left + "px";
      menu.el.style.top = (r.bottom + 6) + "px";
    }

    function findPlusBtn() {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].getAttribute("title") || "";
        if (t.indexOf("创建新项目") === 0) { return btns[i]; }
      }
      return null;
    }

    function createNewChat() {
      /* 统一创建逻辑 + 统一弹窗（01-shared），不再用原生 alert */
      window.WB.createSession("").catch(function (err) {
        window.WB.modal({ title: "创建新对话失败", message: String((err && err.message) || err), confirmText: "知道了" });
      });
    }

    function ensure() {
      var oldBtn = document.querySelector(".wb-newchat-btn");
      if (oldBtn && oldBtn.parentNode) { oldBtn.parentNode.removeChild(oldBtn); }

      var btn = findPlusBtn();
      if (!btn) { return; }

      if (!menu) {
        menu = makeMenu();
        document.body.appendChild(menu.el);
        menu.newChat.addEventListener("click", function (ev) { ev.stopPropagation(); hide(); createNewChat(); });
        menu.newProject.addEventListener("click", function (ev) {
          ev.stopPropagation();
          hide();
          allowNative = true;
          btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        menu.el.addEventListener("mouseenter", function () { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
        menu.el.addEventListener("mouseleave", function () {
          if (hideTimer) { clearTimeout(hideTimer); }
          hideTimer = setTimeout(hide, 200);
        });
        document.addEventListener("click", function (ev) {
          if (!menu) { return; }
          if (menu.el.contains(ev.target)) { return; }
          if (btn && btn.contains(ev.target)) { return; }
          hide();
        }, true);
      }

      if (btn.__wbPlusBound) { return; }
      btn.__wbPlusBound = true;

      btn.addEventListener("mouseenter", function () {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        show(btn);
      });
      btn.addEventListener("mouseleave", function () {
        if (hideTimer) { clearTimeout(hideTimer); }
        hideTimer = setTimeout(hide, 260);
      });
      btn.addEventListener("click", function (ev) {
        if (allowNative) { allowNative = false; return; }
        ev.stopPropagation();
        ev.preventDefault();
        show(btn);
      }, true);
    }

    function schedule() {
      if (pending) { clearTimeout(pending); }
      pending = setTimeout(function () { pending = null; try { ensure(); } catch (e) { try { console.warn("[wb-plus-menu]", e); } catch (_) {} } }, 200);
    }
    /* 共享观察者（01-shared）：DOM 变化统一回调 */
    window.WB.onMutate(function () { schedule(); });
    ensure();
  } catch (e) { try { console.warn("[wb-plus-menu]", e); } catch (_) {} }
})();
