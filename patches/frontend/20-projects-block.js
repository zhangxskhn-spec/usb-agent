/* ============================================================
 * 20-projects-block
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  try {
    var BLOCK = "wb-projects-block";
    var MUTED = "hsl(var(--muted-foreground,215 16% 47%))";
    var ACCENT = "hsl(var(--accent,210 40% 96%))";
    var pending = null;
    function el(tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
    /* 定位列表区锚点：优先「最近对话」标题；会话被清空后该标题不再渲染，
       退回空状态文案「还没有对话」的容器，保证项目区始终有落脚点。 */
    function findAnchor() {
      var nodes = document.querySelectorAll("h2,h3,h4,div,span,p");
      var emptyBox = null;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.childElementCount !== 0 || !n.textContent) { continue; }
        var t = n.textContent.trim();
        if (t === "最近对话") { return n; }
        if (!emptyBox && t === "还没有对话") { emptyBox = n; }
      }
      /* 空状态：返回「还没有对话」这段文案本身——它的父元素就是空状态容器，
         与「有会话时的列表容器」是同一个位置，因此插入点与正常情况一致 */
      if (emptyBox) { return emptyBox; }
      /* 项目和最近对话都为空时，仍挂到侧栏，保证统一搜索入口可用。 */
      try {
        var aside = document.querySelector("aside");
        if (aside) return aside;
      } catch (e2) {}
      return null;
    }
    function ensure() {
      try {
        if (document.querySelector("." + BLOCK)) { return; }
        try { if (document.querySelector('input[placeholder="搜索项目..."]')) { return; } } catch (e) {}
        var holder = findAnchor();
        if (!holder) { return; }
        var section = holder.closest("section") || holder.parentElement;
        if (!section || !section.parentNode) { return; }
        var token = WBToken();
        if (!token) { return; }
        /* 页面主应用启动时已经同步过 Claude 文件；这里仅读取 DB，避免普通对话区再扫一遍 U 盘。 */
        fetch("/api/projects?skipSynchronization=1", { headers: { Authorization: "Bearer " + token } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            var list = data;
            if (data && !Array.isArray(data)) { list = data.projects || (data.data && data.data.projects) || []; }
            if (Array.isArray(list)) { build(section, list); }
          })
          .catch(function () {});
      } finally { /* 共享观察者（01-shared）自动重触发，无需重挂 */ }
    }
    /* 统一取 token（01-shared） */
    function WBToken() { return window.WB.token(); }
    function token() { return WBToken(); }
    var wbModal = window.WB.modal; /* 统一弹窗（01-shared） */
    function openFolder(p) {
      var path = p.path || p.fullPath || "";
      if (!path) { wbModal({ title: "无法打开", message: "该项目没有文件夹路径。", confirmText: "知道了" }); return; }
      fetch("/api/projects/wb-open-folder", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() }, body: JSON.stringify({ path: path }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j && res.j.success) return;
          var msg = (res.j && res.j.error && (res.j.error.message || res.j.error)) || ("HTTP " + res.status);
          wbModal({ title: "打开文件夹失败", message: String(msg), confirmText: "知道了" });
        })
        .catch(function () { wbModal({ title: "打开文件夹失败", message: "网络错误，请重试。", confirmText: "知道了" }); });
    }
    function newChatInProject(p) {
      /* 统一创建逻辑（01-shared），勿再复制 */
      window.WB.createSession(p.path || "")
        .catch(function (err) { wbModal({ title: "新建对话失败", message: String((err && err.message) || err), confirmText: "知道了" }); });
    }
    function relTime(ts) {
      try {
        if (!ts) return "";
        var d = new Date(ts);
        if (isNaN(d.getTime())) return "";
        var now = new Date();
        if (d.toDateString() === now.toDateString()) { return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
        var y = new Date(now.getTime() - 86400000);
        if (d.toDateString() === y.toDateString()) return "昨天";
        var days = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (days < 7) return days + "天前";
        return (d.getMonth() + 1) + "月" + d.getDate() + "日";
      } catch (e) { return ""; }
    }
    function delSession(sid, silent, onDone) {
      return fetch("/api/providers/sessions/" + encodeURIComponent(sid) + "?force=true", { method: "DELETE", headers: { Authorization: "Bearer " + token() } })
        .then(function (r) { if (!r.ok && !silent) wbModal({ title: "删除失败", message: "HTTP " + r.status, confirmText: "知道了" }); if (r.ok && onDone) { try { onDone(); } catch (e3) {} } return r.ok; })
        .catch(function () { if (!silent) wbModal({ title: "删除失败", message: "网络错误，请重试。", confirmText: "知道了" }); return false; });
    }
    function refreshCount(it) {
      try {
        var meta = it.p.sessionMeta || {};
        if (it.countEl) it.countEl.textContent = String(typeof meta.total === "number" ? meta.total : (it.p.sessions || []).length);
      } catch (e) {}
    }
    function removeSessionRow(it, sid) {
      try {
        it.p.sessions = (it.p.sessions || []).filter(function (x) { return (x.id || x.sessionId) !== sid; });
        var row = it.sub.querySelector('a[data-sid="' + sid + '"]');
        if (row && row.parentNode) row.parentNode.removeChild(row);
        if (!it.sub.querySelector("a[data-sid]")) { it.sub.innerHTML = ""; }
        refreshCount(it);
      } catch (e) {}
    }
    function delOne(it, a, sid) {
      if (!sid) return;
      wbModal({
        title: "删除对话", message: "删除这条对话？此操作不可恢复。", confirmText: "删除", danger: true,
        onConfirm: function () { delSession(sid, false, function () { removeSessionRow(it, sid); }); }
      });
    }
    function renameSession(it, s, titleEl) {
      var sid = s && (s.id || s.sessionId);
      if (!sid) return;
      var cur = (s.summary && String(s.summary).trim()) || "未命名对话";
      wbModal({
        title: "重命名对话", input: cur, confirmText: "保存",
        onConfirm: function (next) {
          next = String(next || "").trim();
          if (!next || next === cur) return;
          fetch("/api/providers/sessions/" + encodeURIComponent(sid), {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
            body: JSON.stringify({ summary: next })
          }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            s.summary = next;
            if (titleEl) titleEl.textContent = next;
            try { if (window.WB.refreshProjects) window.WB.refreshProjects(); } catch (e) {}
          }).catch(function (err) {
            wbModal({ title: "重命名失败", message: String((err && err.message) || err || "网络错误，请重试。"), confirmText: "知道了" });
          });
        }
      });
    }
    function clearProject(p, it) {
      var total = p.sessionMeta && typeof p.sessionMeta.total === "number" ? p.sessionMeta.total : (p.sessions || []).length;
      if (!total) { wbModal({ title: "清空该项目对话", message: "该项目没有对话。", confirmText: "知道了" }); return; }
      wbModal({
        title: "清空该项目对话",
        message: "将删除「" + (p.displayName || p.name || "") + "」的全部 " + total + " 条对话，此操作不可恢复。",
        confirmText: "清空", danger: true,
        onConfirm: function () {
          var pid = p.projectId || p.id;
          fetch("/api/projects/" + encodeURIComponent(pid) + "/sessions?force=true", { method: "DELETE", headers: { Authorization: "Bearer " + token() } })
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(function () {
              try {
                p.sessions = [];
                p.sessionMeta = Object.assign({}, p.sessionMeta || {}, { total: 0, hasMore: false });
                if (loadedOffsets[pid] != null) { delete loadedOffsets[pid]; saveLoadedOffsets(); }
                if (sessionCache[pid]) delete sessionCache[pid];
                if (it && it.sub) { it.sub.innerHTML = ""; }
                refreshCount(it);
              } catch (e2) {}
            }).catch(function (err) { wbModal({ title: "清空失败", message: String((err && err.message) || "网络错误，请重试。"), confirmText: "知道了" }); });
        }
      });
    }
    function renameProj(p, it) {
      var cur = p.displayName || p.name || "";
      wbModal({
        title: "重命名项目", input: cur, confirmText: "重命名",
        onConfirm: function (nn) {
          if (!nn || !nn.trim() || nn.trim() === cur) return;
          fetch("/api/projects/" + encodeURIComponent(p.projectId || p.path || p.id) + "/rename", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() }, body: JSON.stringify({ displayName: nn.trim() }) })
            .then(function (r) {
              if (!r.ok) { wbModal({ title: "重命名失败", message: "HTTP " + r.status, confirmText: "知道了" }); return; }
              p.displayName = nn.trim();
              try { if (it && it.nameEl) it.nameEl.textContent = nn.trim(); } catch (e2) {}
            })
            .catch(function () { wbModal({ title: "重命名失败", message: "网络错误，请重试。", confirmText: "知道了" }); });
        }
      });
    }
    function delProj(p, it) {
      wbModal({
        title: "移除项目",
        message: "移除「" + (p.displayName || p.name || "") + "」？对话会进归档，可在归档面板恢复。",
        confirmText: "移除", danger: true,
        onConfirm: function () {
          fetch("/api/projects/" + encodeURIComponent(p.projectId || p.path || p.id), { method: "DELETE", headers: { Authorization: "Bearer " + token() } })
            .then(function (r) {
              if (!r.ok) { wbModal({ title: "移除失败", message: "HTTP " + r.status, confirmText: "知道了" }); return; }
              try {
                if (it && it.item && it.item.parentNode) it.item.parentNode.removeChild(it.item);
                projItems = projItems.filter(function (x) { return x !== it; });
              } catch (e2) {}
            })
            .catch(function () { wbModal({ title: "移除失败", message: "网络错误，请重试。", confirmText: "知道了" }); });
        }
      });
    }
    var projItems = [];
    var sessionCache = {};
    var loadedOffsets = {};
    try { loadedOffsets = JSON.parse(localStorage.getItem("wb-project-offsets") || "{}") || {}; } catch (e) { loadedOffsets = {}; }
    function saveLoadedOffsets() { try { localStorage.setItem("wb-project-offsets", JSON.stringify(loadedOffsets)); } catch (e) {} }
    var spaNav = window.WB.spaNav; /* 统一 SPA 跳转（01-shared） */
    var pmenu = null;
    function hidePmenu() { if (pmenu && pmenu.parentNode) pmenu.parentNode.removeChild(pmenu); pmenu = null; }
    function pIcon(pathD) {
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "15"); svg.setAttribute("height", "15");
      svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
      svg.style.cssText = "flex:0 0 auto;opacity:.8;";
      var pt = document.createElementNS(NS, "path"); pt.setAttribute("d", pathD); svg.appendChild(pt);
      return svg;
    }
    function showPmenu(x, y, it) { var p = it.p;
      hidePmenu();
      pmenu = document.createElement("div");
      pmenu.setAttribute("data-wb-pmenu", "1");   /* 标记：重建时据此避让，避免"菜单自己关掉" */
      pmenu.style.cssText = "position:fixed;z-index:99999;min-width:176px;padding:5px;border-radius:12px;border:1px solid hsl(var(--border,215 15% 88%));background:hsl(var(--popover,0 0% 100%));box-shadow:0 12px 32px rgba(0,0,0,.16);font-size:13px;color:hsl(var(--popover-foreground,215 25% 27%));";
      function item(label, iconPath, fn, danger) {
        var it = document.createElement("div");
        it.style.cssText = "display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;cursor:pointer;" + (danger ? "color:#dc2626;" : "");
        it.appendChild(pIcon(iconPath));
        var sp = document.createElement("span"); sp.textContent = label; it.appendChild(sp);
        it.onmouseenter = function () { it.style.background = danger ? "rgba(220,38,38,.08)" : ACCENT; };
        it.onmouseleave = function () { it.style.background = "transparent"; };
        it.onclick = function (ev) { ev.stopPropagation(); hidePmenu(); fn(); };
        pmenu.appendChild(it);
      }
      function divider() {
        var d = document.createElement("div");
        d.style.cssText = "height:1px;margin:4px 7px;background:hsl(var(--border,215 15% 88%));";
        pmenu.appendChild(d);
      }
      item("打开文件夹", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z", function () { openFolder(p); }, false);
      item("重命名项目", "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z", function () { renameProj(p, it); }, false);
      divider();
      item("清空该项目对话", "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", function () { clearProject(p, it); }, true);
      item("移除项目", "M21 8v13H3V8 M1 3h22 M10 12h4", function () { delProj(p, it); }, true);
      document.body.appendChild(pmenu);
      pmenu.style.left = Math.max(8, Math.min(x, window.innerWidth - 195)) + "px";
      pmenu.style.top = Math.max(8, Math.min(y, window.innerHeight - 190)) + "px";
      setTimeout(function () { document.addEventListener("click", hidePmenu, { once: true, capture: true }); }, 0);
    }
    function isPlainWorkspaceProject(p) {
      try {
        if (!p) return false;
        if (p.isPlainWorkspace === true) return true;
        return String(p.displayName || p.name || "").trim() === "U盘工作区";
      } catch (e) { return false; }
    }
    function appendSessionRows(sub, p, it, actSid) {
      (p.sessions || []).forEach(function (s) {
        var sid = s.id || s.sessionId || "";
        var isCur = !!actSid && sid === actSid;
        var a = document.createElement("a");
        a.href = "/session/" + encodeURIComponent(sid);
        a.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 8px;border-radius:6px;color:inherit;text-decoration:none;min-width:0;background:" + (isCur ? "rgba(217,119,87,.14)" : "transparent") + ";" + (isCur ? "box-shadow:inset 2px 0 0 #D97757;" : "");
        var ttl = document.createElement("span"); ttl.className = "wb-session-title";
        ttl.textContent = (s.summary && String(s.summary).trim()) ? String(s.summary) : "未命名对话";
        ttl.style.cssText = "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" + (isCur ? "font-weight:600;color:#C45F3C;" : "");
        a.appendChild(ttl);
        var draftMark = document.createElement("span"); draftMark.className = "wb-draft-mark"; draftMark.textContent = "有草稿";
        draftMark.style.cssText = "display:none;flex:0 0 auto;font-size:10px;color:#D97757;";
        try { if (localStorage.getItem("wb-draft:" + sid)) draftMark.style.display = "inline"; } catch (e0) {}
        a.appendChild(draftMark);
        var tsm = document.createElement("span");
        tsm.textContent = relTime(s.lastActivity);
        tsm.style.cssText = "flex:0 0 auto;font-size:10px;color:hsl(var(--muted-foreground,215 16% 47%));opacity:.75;";
        a.appendChild(tsm);
        var renameX = document.createElement("span"); renameX.textContent = "\u2026"; renameX.title = "重命名这条对话";
        renameX.style.cssText = "position:absolute;right:27px;top:50%;transform:translateY(-50%);font-size:15px;color:hsl(var(--muted-foreground,215 16% 47%));cursor:pointer;opacity:0;transition:opacity .12s;padding:1px 4px;line-height:1;border-radius:5px;background:hsl(var(--background,0 0% 100%));";
        var delX = document.createElement("span"); delX.textContent = "\u2715"; delX.title = "删除这条对话";
        delX.style.cssText = "position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:11px;color:#dc2626;cursor:pointer;opacity:0;transition:opacity .12s;padding:2px 5px;line-height:1;border-radius:5px;background:hsl(var(--background,0 0% 100%));";
        if (window.WB.isTouch) { delX.style.opacity = ".55"; }
        if (window.WB.isTouch) { renameX.style.opacity = ".75"; }
        a.onmouseenter = function () { a.style.background = ACCENT; delX.style.opacity = "1"; renameX.style.opacity = "1"; };
        a.onmouseleave = function () {
          var selected = !!curSid() && sid === curSid();
          a.style.background = selected ? "rgba(217,119,87,.14)" : "transparent";
          delX.style.opacity = window.WB.isTouch ? ".55" : "0"; renameX.style.opacity = window.WB.isTouch ? ".75" : "0";
        };
        a.onclick = function (ev) {
          try {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
            ev.preventDefault();
            openSession(sid);
          } catch (e) {}
        };
        a.setAttribute("data-sid", sid);
        renameX.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); renameSession(it, s, ttl); };
        delX.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); delOne(it, a, sid); };
        a.style.position = "relative"; a.style.paddingRight = "52px";
        a.appendChild(renameX);
        a.appendChild(delX);
        sub.appendChild(a);
      });
      ensureLoadMoreButton(sub, p, it, actSid);
    }
    function ensureLoadMoreButton(sub, p, it, actSid) {
      if (it.loadEl && it.loadEl.parentNode) it.loadEl.parentNode.removeChild(it.loadEl);
      it.loadEl = null;
      var meta = p.sessionMeta || {};
      if (!meta.hasMore) return;
      var b = it.loadEl = document.createElement("button");
      b.type = "button";
      b.textContent = it.loadingMore ? "加载中..." : "加载更多";
      b.style.cssText = "margin:2px 4px 2px 0;padding:5px 8px;border:1px dashed hsl(var(--border,215 15% 88%));border-radius:6px;background:transparent;color:hsl(var(--muted-foreground,215 16% 47%));font-size:11px;cursor:pointer;text-align:left;";
      b.disabled = !!it.loadingMore;
      b.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); loadMoreProjectSessions(p, it, sub, actSid); };
      sub.appendChild(b);
    }
    function loadMoreProjectSessions(p, it, sub, actSid) {
      var projectId = p && (p.projectId || p.id);
      if (!projectId || it.loadingMore || !(p.sessionMeta && p.sessionMeta.hasMore)) return;
      it.loadingMore = true;
      ensureLoadMoreButton(sub, p, it, actSid);
      var offset = (p.sessions || []).length;
      fetch("/api/projects/" + encodeURIComponent(projectId) + "/sessions?limit=20&offset=" + offset, { headers: { Authorization: "Bearer " + token() } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var page = data && data.data && data.data.sessions ? data.data : data;
          var incoming = Array.isArray(page && page.sessions) ? page.sessions : [];
          var seen = {};
          (p.sessions || []).forEach(function (s) { seen[s.id || s.sessionId] = 1; });
          incoming.forEach(function (s) { var sid = s.id || s.sessionId; if (sid && !seen[sid]) { p.sessions.push(s); seen[sid] = 1; } });
          sessionCache[projectId] = (p.sessions || []).slice();
          loadedOffsets[projectId] = p.sessions.length;
          saveLoadedOffsets();
          p.sessionMeta = Object.assign({}, p.sessionMeta || {}, page && page.sessionMeta || {});
          if (!incoming.length) p.sessionMeta.hasMore = false;
          it.loadingMore = false;
          /* 只追加新行，避免重建整个侧栏导致展开状态/焦点丢失。 */
          appendSessionRows(sub, Object.assign({}, p, { sessions: incoming, sessionMeta: { hasMore: false } }), it, actSid);
          ensureLoadMoreButton(sub, p, it, actSid);
          refreshCount(it);
        })
        .catch(function (err) {
          it.loadingMore = false;
          ensureLoadMoreButton(sub, p, it, actSid);
          wbModal({ title: "加载会话失败", message: String((err && err.message) || "网络错误，请重试。"), confirmText: "知道了" });
        });
    }
    function buildWorkspaceGroup(rows, p, actSid) {
      var sidList = p.sessions || [];
      if (!sidList.length && !(p.sessionMeta && p.sessionMeta.total)) return;
      var pid = "@plain";
      var it = { p: p, item: null, nameEl: null, countEl: null, sub: null };
      var item = it.item = document.createElement("div");
      item.setAttribute("data-wb-workspace-group", "1");
      var active = !!actSid && sidList.some(function (s) { return (s.id || s.sessionId) === actSid; });
      var row = document.createElement("button");
      row.type = "button";
      row.style.cssText = "display:flex;width:100%;min-width:0;align-items:center;gap:8px;border-radius:8px;padding:7px 8px;background:" + (active ? ACCENT : "transparent") + ";border:0;text-align:left;cursor:pointer;color:inherit;";
      row.onmouseenter = function () { row.style.background = ACCENT; };
      row.onmouseleave = function () { row.style.background = active ? ACCENT : "transparent"; };
      var mark = el("span", "flex:0 0 auto;width:13px;height:10px;border-radius:2px;background:" + MUTED + ";opacity:.45;");
      var name = it.nameEl = el("span", "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;", "U盘工作区");
      var meta = p.sessionMeta || {};
      var cnt = typeof meta.total === "number" ? meta.total : sidList.length;
      var count = it.countEl = el("span", "flex:0 0 auto;font-size:10px;color:" + MUTED + ";", String(cnt));
      var chev = el("span", "flex:0 0 auto;font-size:11px;color:" + MUTED + ";transition:transform .15s;", "\u203a");
      row.appendChild(mark); row.appendChild(name); row.appendChild(count); row.appendChild(chev);
      var sub = it.sub = document.createElement("div");
      sub.style.cssText = "display:none;flex-direction:column;padding:1px 4px 6px 34px;";
      appendSessionRows(sub, p, it, actSid);
      var open = !!expanded[pid] || active;
      sub.setAttribute("data-wb-sub", pid);
      if (open) { sub.style.display = "flex"; chev.style.transform = "rotate(90deg)"; expanded[pid] = 1; }
      row.onclick = function () {
        open = !open;
        if (open) expanded[pid] = 1; else delete expanded[pid];
        saveExpanded();
        sub.style.display = open ? "flex" : "none";
        chev.style.transform = open ? "rotate(90deg)" : "none";
      };
      item.appendChild(row); item.appendChild(sub);
      rows.appendChild(item);
    }
    function build(section, list) {
      if (document.querySelector("." + BLOCK)) { return; }
      projItems = [];
      (list || []).forEach(function (p) {
        var pid = p && (p.projectId || p.id || p.path);
        if (pid && Array.isArray(p.sessions)) sessionCache[pid] = p.sessions.slice();
      });
      var wrap = document.createElement("div");
      wrap.className = BLOCK;
      wrap.style.cssText = "margin-bottom:10px;";
      var searchRow = el("div", "display:flex;align-items:center;gap:6px;padding:8px 8px 4px;");
      var searchInput = document.createElement("input");
      searchInput.type = "search"; searchInput.placeholder = "搜索所有对话..."; searchInput.setAttribute("aria-label", "搜索所有对话");
      searchInput.style.cssText = "min-width:0;flex:1;height:30px;padding:0 9px;border:1px solid hsl(var(--border,215 15% 88%));border-radius:7px;background:hsl(var(--background,0 0% 100%));color:inherit;font-size:12px;outline:none;";
      var searchClear = document.createElement("button"); searchClear.type = "button"; searchClear.textContent = "\u00d7"; searchClear.title = "清除搜索"; searchClear.setAttribute("aria-label", "清除搜索");
      searchClear.style.cssText = "display:none;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:" + MUTED + ";font-size:18px;cursor:pointer;line-height:1;";
      searchRow.appendChild(searchInput); searchRow.appendChild(searchClear); wrap.appendChild(searchRow);
      var searchPanel = el("div", "display:none;padding:3px 8px 8px;");
      var searchStatus = el("div", "padding:8px 4px;color:" + MUTED + ";font-size:11px;", "");
      var searchResults = el("div", "display:flex;flex-direction:column;gap:2px;");
      searchPanel.appendChild(searchStatus); searchPanel.appendChild(searchResults); wrap.appendChild(searchPanel);
      var total = 0;
      for (var i = 0; i < list.length; i++) {
        if (isPlainWorkspaceProject(list[i])) continue;
        var m = list[i].sessionMeta || {};
        total += typeof m.total === "number" ? m.total : (list[i].sessions || []).length;
      }
      var head = el("div", "display:flex;align-items:center;justify-content:space-between;padding:12px 10px 3px;");
      head.appendChild(el("span", "font-size:10px;font-weight:500;letter-spacing:.02em;color:" + MUTED + ";opacity:.8;", "项目"));
      head.appendChild(el("span", "font-size:10px;color:" + MUTED + ";opacity:.6;", String(total)));
      wrap.appendChild(head);
      var rows = el("div", "display:flex;flex-direction:column;gap:2px;");
      var workspaceRows = el("div", "display:flex;flex-direction:column;gap:2px;");
      var actSid = curSid();
      list.forEach(function (p) {
        if (isPlainWorkspaceProject(p)) {
          buildWorkspaceGroup(workspaceRows, p, actSid);
          return;
        }
        var it = { p: p, item: null, nameEl: null, countEl: null, sub: null };
        projItems.push(it);
        var pid = p.projectId || p.path || p.displayName || "";
        var sidList = p.sessions || [];
        /* 当前打开的会话属于这个项目 → 该项目高亮 + 自动展开（"显示我选中的那个项目"） */
        var isActive = !!actSid && sidList.some(function (s) { return (s.id || s.sessionId) === actSid; });
        if (isActive && !expanded[pid]) { expanded[pid] = 1; saveExpanded(); }
        var item = it.item = document.createElement("div");
        var row = document.createElement("button");
        row.type = "button";
        row.style.cssText = "display:flex;width:100%;min-width:0;align-items:center;gap:8px;border-radius:8px;padding:7px 8px;background:" + (isActive ? ACCENT : "transparent") + ";border:0;text-align:left;cursor:pointer;color:inherit;";
        row.onmouseenter = function () { row.style.background = ACCENT; };
        row.onmouseleave = function () { row.style.background = isActive ? ACCENT : "transparent"; };
        var moreB = document.createElement("span"); moreB.textContent = "\u22ef"; moreB.title = "项目选项";
        moreB.style.cssText = "position:absolute;right:26px;top:50%;transform:translateY(-50%);font-size:14px;color:hsl(var(--muted-foreground,215 16% 47%));cursor:pointer;opacity:.9;padding:2px 6px;line-height:1;border-radius:5px;";
        moreB.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); var rct = moreB.getBoundingClientRect(); showPmenu(rct.left - 160, rct.bottom + 4, it); };
        moreB.style.right = "46px";
        var plusB = document.createElement("span");
        plusB.title = "在这个项目里新建对话";
        plusB.style.cssText = "position:absolute;right:10px;top:50%;transform:translateY(-50%);width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:hsl(var(--muted-foreground,215 16% 47%));cursor:pointer;opacity:.9;border-radius:6px;";
        plusB.appendChild(pIcon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M8 12h8 M12 8v8"));
        plusB.onmouseenter = function () { plusB.style.background = ACCENT; plusB.style.color = "#D97757"; };
        plusB.onmouseleave = function () { plusB.style.background = "transparent"; plusB.style.color = "hsl(var(--muted-foreground,215 16% 47%))"; };
        plusB.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); newChatInProject(p); };
        row.style.position = "relative"; row.style.paddingRight = "78px";
        row.appendChild(moreB);
        row.appendChild(plusB);
        var mark = el("span", "flex:0 0 auto;width:13px;height:10px;border-radius:2px;background:" + MUTED + ";opacity:.45;");
        var name = it.nameEl = el("span", "min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;" + (isActive ? "font-weight:600;" : ""), p.displayName || p.name || "项目");
        var meta = p.sessionMeta || {};
        var cnt = typeof meta.total === "number" ? meta.total : (p.sessions || []).length;
        var count = it.countEl = el("span", "flex:0 0 auto;font-size:10px;color:" + MUTED + ";", String(cnt));
        var chev = el("span", "flex:0 0 auto;font-size:11px;color:" + MUTED + ";transition:transform .15s;", "\u203a");
        row.appendChild(mark); row.appendChild(name); row.appendChild(count); row.appendChild(chev);
        var sub = it.sub = document.createElement("div");
        sub.style.cssText = "display:none;flex-direction:column;padding:1px 4px 6px 34px;";
        appendSessionRows(sub, p, it, actSid);
        var pid = p.projectId || p.path || p.displayName || "";
        var open = !!expanded[pid];   /* 展开状态跨重建保留，避免"刚打开的项目自己合上" */
        sub.setAttribute("data-wb-sub", pid);
        if (open) { sub.style.display = "flex"; chev.style.transform = "rotate(90deg)"; }
        row.onclick = function () {
          open = !open;
          if (open) { expanded[pid] = 1; } else { delete expanded[pid]; }
          saveExpanded();
          sub.style.display = open ? "flex" : "none";
          chev.style.transform = open ? "rotate(90deg)" : "none";
        };
        item.appendChild(row); item.appendChild(sub);
        rows.appendChild(item);
      });
      wrap.appendChild(rows);
      var workspaceWrap = null;
      if (section.tagName && String(section.tagName).toLowerCase() === "aside") section.insertBefore(wrap, section.firstChild || null);
      else section.parentNode.insertBefore(wrap, section);
      if (workspaceRows.childElementCount) {
        workspaceWrap = document.createElement("div");
        workspaceWrap.className = BLOCK + "-workspace";
        workspaceWrap.style.cssText = "margin-bottom:10px;";
        workspaceWrap.appendChild(workspaceRows);
        section.parentNode.insertBefore(workspaceWrap, section);
      }
      var nativeSectionDisplay = section && section.style ? section.style.display : "";
      var searchState = { controller: null, sequence: 0, titles: [], projects: [] };
      var searchCache = {};
      function resultRow(title, detail, sid) {
        var a = document.createElement("a"); a.href = "/session/" + encodeURIComponent(sid || "");
        a.style.cssText = "display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:7px;color:inherit;text-decoration:none;min-width:0;";
        var top = el("span", "display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;");
        top.appendChild(el("span", "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;", title || "未命名对话"));
        if (detail) top.appendChild(el("span", "margin-left:auto;flex:0 0 auto;font-size:10px;color:" + MUTED + ";", detail));
        a.appendChild(top);
        a.onmouseenter = function () { a.style.background = ACCENT; }; a.onmouseleave = function () { a.style.background = "transparent"; };
        a.onclick = function (ev) { if (!(ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)) { ev.preventDefault(); openSession(sid); } };
        return a;
      }
      function renderSearchResults() {
        searchResults.innerHTML = "";
        var seen = {};
        searchState.titles.forEach(function (r) {
          var sid = r.sessionId || r.id; if (!sid || seen[sid]) return; seen[sid] = 1;
          searchResults.appendChild(resultRow(r.sessionTitle || r.summary, r.projectDisplayName || "", sid));
        });
        searchState.projects.forEach(function (bucket) {
          var sessions = bucket && Array.isArray(bucket.sessions) ? bucket.sessions : [];
          sessions.forEach(function (r) {
            var sid = r.sessionId || r.id; if (!sid || seen[sid]) return; seen[sid] = 1;
            var match = r.matches && r.matches[0];
            var detail = bucket.projectDisplayName || bucket.projectName || "";
            var row = resultRow(r.sessionSummary || "未命名对话", detail, sid);
            if (match && match.snippet) row.appendChild(el("span", "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:" + MUTED + ";", String(match.snippet)));
            searchResults.appendChild(row);
          });
        });
      }
      function finishSearchMode() {
        searchPanel.style.display = "none"; rows.style.display = "flex"; if (workspaceWrap) workspaceWrap.style.display = "block";
        if (section) section.style.display = nativeSectionDisplay;
      }
      function parseSearchEvent(raw) {
        var type = "message", data = "";
        raw.split(/\n/).forEach(function (line) { if (line.indexOf("event:") === 0) type = line.slice(6).trim(); else if (line.indexOf("data:") === 0) data += line.slice(5).trim(); });
        var payload = {}; try { payload = data ? JSON.parse(data) : {}; } catch (e) { return; }
        if (type === "title-results") { searchState.titles = Array.isArray(payload.titleResults) ? payload.titleResults : []; renderSearchResults(); }
        else if (type === "result" && payload.projectResult) { searchState.projects.push(payload.projectResult); renderSearchResults(); }
        else if (type === "progress") { searchStatus.textContent = "搜索中..."; }
        else if (type === "done") { searchStatus.textContent = searchResults.childElementCount ? "搜索结果" : "没有找到匹配的对话"; }
        else if (type === "error") { searchStatus.textContent = "搜索失败，点击输入框后重试"; }
      }
      function runSearch(value) {
        var q = String(value || "").trim(); searchClear.style.display = q ? "block" : "none";
        if (searchState.controller) { try { searchState.controller.abort(); } catch (e) {} searchState.controller = null; }
        searchState.sequence += 1; var seq = searchState.sequence;
        if (q.length < 2) { searchState.titles = []; searchState.projects = []; searchResults.innerHTML = ""; finishSearchMode(); return; }
        rows.style.display = "none"; if (workspaceWrap) workspaceWrap.style.display = "none"; if (section) section.style.display = "none";
        searchPanel.style.display = "block"; searchStatus.textContent = "搜索中..."; searchResults.innerHTML = ""; searchState.titles = []; searchState.projects = [];
        var cached = searchCache[q];
        if (cached && Date.now() - cached.at < 60000) {
          searchState.titles = cached.titles || []; searchState.projects = cached.projects || [];
          renderSearchResults(); searchStatus.textContent = searchResults.childElementCount ? "搜索结果" : "没有找到匹配的对话";
          return;
        }
        var ctrl = searchState.controller = new AbortController();
        var url = "/api/providers/search/sessions?q=" + encodeURIComponent(q) + "&limit=50&token=" + encodeURIComponent(token() || "");
        fetch(url, { headers: { Authorization: "Bearer " + token() }, signal: ctrl.signal }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status); if (!r.body) throw new Error("浏览器不支持流式搜索");
          var reader = r.body.getReader(), decoder = new TextDecoder(), buffer = "";
          function read() { return reader.read().then(function (part) {
            if (seq !== searchState.sequence) return;
            if (part.done) { if (buffer.trim()) parseSearchEvent(buffer); searchCache[q] = { at: Date.now(), titles: searchState.titles.slice(), projects: searchState.projects.slice() }; return; }
            buffer += decoder.decode(part.value, { stream: true });
            var chunks = buffer.split(/\n\n/); buffer = chunks.pop() || ""; chunks.forEach(parseSearchEvent); return read();
          }); }
          return read();
        }).catch(function (err) { if (err && err.name === "AbortError") return; if (seq === searchState.sequence) searchStatus.textContent = "搜索失败，检查连接后重试"; });
      }
      var searchTimer = null;
      searchInput.oninput = function () { if (searchTimer) clearTimeout(searchTimer); var v = searchInput.value; searchTimer = setTimeout(function () { runSearch(v); }, 280); };
      searchInput.onkeydown = function (ev) { if (ev.key === "Escape") { searchInput.value = ""; runSearch(""); searchInput.blur(); } };
      searchClear.onclick = function () { searchInput.value = ""; runSearch(""); searchInput.focus(); };
      lastSig = sigOf(list);
    }
    /* 数据签名：项目/会话没变化就不重建 DOM（防闪屏、防"下拉菜单自己关掉"） */
    var lastSig = "";
    var refreshInFlight = false;
    var refreshQueued = false;
    /* projectId -> 1：用户展开过的项目。存 localStorage，整页跳转/重载后也能恢复展开 */
    var expanded = {};
    try { expanded = JSON.parse(localStorage.getItem("wb-proj-expanded") || "{}") || {}; } catch (e) { expanded = {}; }
    function saveExpanded() { try { localStorage.setItem("wb-proj-expanded", JSON.stringify(expanded)); } catch (e) {} }
    /* 地址栏里当前的会话 id */
    function curSid() {
      try { var m = String(location.pathname || "").match(/^\/session\/([^/?#]+)/); return m ? decodeURIComponent(m[1]) : ""; } catch (e) { return ""; }
    }
    /* SPA 切换会话时项目区通常不会重建，直接重绘当前行，避免高亮停留在旧会话。 */
    function paintActiveSession() {
      try {
        var activeSid = curSid();
        document.querySelectorAll("a[data-sid]").forEach(function (a) {
          var selected = !!activeSid && a.getAttribute("data-sid") === activeSid;
          var title = a.querySelector(".wb-session-title");
          a.style.background = selected ? "rgba(217,119,87,.14)" : "transparent";
          a.style.boxShadow = selected ? "inset 2px 0 0 #D97757" : "none";
          if (title) {
            title.style.fontWeight = selected ? "600" : "400";
            title.style.color = selected ? "#C45F3C" : "inherit";
          }
        });
      } catch (e) {}
    }
    /* 打开会话：优先软跳转（不整页重载 → 不闪、左侧展开与高亮都不丢）；
       若 800ms 后视图没换（软跳转没生效），回退整页跳转兜底。 */
    function openSession(sid) {
      var href = "/session/" + encodeURIComponent(sid);
      if (location.pathname === href) { return; }
      var before = "";
      try { var h = document.querySelector("header"); before = h ? h.textContent : ""; } catch (e) {}
      try { window.WB.spaNav(href); } catch (e) { location.assign(href); return; }
      setTimeout(function () {
        try {
          if (location.pathname !== href) { location.assign(href); return; }
          var h2 = document.querySelector("header");
          if ((h2 ? h2.textContent : "") === before) { location.assign(href); }
        } catch (e) {}
      }, 800);
    }
    function sigOf(list) {
      try {
        return JSON.stringify((list || []).map(function (p) {
          var m = p.sessionMeta || {};
          return [p.projectId, p.displayName || p.name || "",
            typeof m.total === "number" ? m.total : (p.sessions || []).length,
            p.isStarred ? 1 : 0,
            (p.sessions || []).length,
            (p.sessions || []).map(function (s) { return s.id || s.sessionId || ""; }).join("|")];
        }));
      } catch (e) { return ""; }
    }
    function pmenuOpen() { try { return !!document.querySelector("[data-wb-pmenu]"); } catch (e) { return false; } }
    function restoreLoadedPages(list) {
      var jobs = (list || []).map(function (p) {
        var pid = p && (p.projectId || p.id || p.path), wanted = pid && Number(loadedOffsets[pid]);
        if (!pid || !wanted || wanted <= (p.sessions || []).length) return Promise.resolve(p);
        var offset = (p.sessions || []).length;
        function next() {
          if (offset >= wanted || !(p.sessionMeta && p.sessionMeta.hasMore)) return Promise.resolve(p);
          return fetch("/api/projects/" + encodeURIComponent(pid) + "/sessions?limit=20&offset=" + offset, { headers: { Authorization: "Bearer " + token() } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
            var page = data && data.data && data.data.sessions ? data.data : data, incoming = Array.isArray(page && page.sessions) ? page.sessions : [], seen = {};
            (p.sessions || []).forEach(function (s) { seen[s.id || s.sessionId] = 1; });
            incoming.forEach(function (s) { var sid = s.id || s.sessionId; if (sid && !seen[sid]) { p.sessions.push(s); seen[sid] = 1; } });
            p.sessionMeta = Object.assign({}, p.sessionMeta || {}, page && page.sessionMeta || {}); offset = p.sessions.length;
            if (!incoming.length) p.sessionMeta.hasMore = false;
            return next();
          }).catch(function () { return p; });
        }
        return next().then(function () { sessionCache[pid] = (p.sessions || []).slice(); return p; });
      });
      return Promise.all(jobs).then(function () { return list; });
    }
    function mergeCachedPages(list) {
      (list || []).forEach(function (p) {
        var pid = p && (p.projectId || p.id || p.path);
        var cached = pid && sessionCache[pid];
        if (!pid || !Array.isArray(cached) || cached.length <= (p.sessions || []).length) return;
        var seen = {}, merged = [];
        (p.sessions || []).forEach(function (s) { var sid = s.id || s.sessionId; if (sid && !seen[sid]) { seen[sid] = 1; merged.push(s); } });
        cached.forEach(function (s) { var sid = s.id || s.sessionId; if (sid && !seen[sid]) { seen[sid] = 1; merged.push(s); } });
        p.sessions = merged;
        p.sessionMeta = Object.assign({}, p.sessionMeta || {}, { hasMore: !!(p.sessionMeta && p.sessionMeta.hasMore) });
      });
      return list;
    }
    function schedule() { if (pending) clearTimeout(pending); pending = setTimeout(function () { pending = null; ensure(); }, 200); }
    /* 共享观察者（01-shared）：DOM 变化统一回调 */
    window.WB.onMutate(function () { schedule(); });
    function syncDraftMarks() {
      try { document.querySelectorAll("a[data-sid]").forEach(function (a) { var sid = a.getAttribute("data-sid"), mark = a.querySelector(".wb-draft-mark"); if (mark) mark.style.display = localStorage.getItem("wb-draft:" + sid) ? "inline" : "none"; }); } catch (e) {}
    }
    window.addEventListener("wb:draft", syncDraftMarks);
    window.addEventListener("wb:drafts-loaded", syncDraftMarks);
    ensure();
    /* ---- v15: 数据自动刷新（聊天/路由变化后原地重建，无需手动刷新页面） ---- */
    function refreshData() {
      try {
        if (refreshInFlight) { refreshQueued = true; return; }
        refreshInFlight = true;
        /* 定时刷新跳过服务端全量同步（首次 ensure 已同步过），省 U 盘 IO */
        fetch("/api/projects?skipSynchronization=1", { headers: { Authorization: "Bearer " + token() } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            var list = Array.isArray(data) ? data : (data.projects || (data.data && data.data.projects) || []);
            return restoreLoadedPages(list).then(function (restored) { return mergeCachedPages(restored); });
          })
          .then(function (list) {
            var old = document.querySelector("." + BLOCK);
            var oldWorkspace = document.querySelector("." + BLOCK + "-workspace");
            /* 数据没变 → 完全不动 DOM（这是"闪屏/项目自己合上"的主要来源） */
            if (old && sigOf(list) === lastSig) { return; }
            /* 用户正开着菜单 → 推迟重建，别把他的菜单弄没 */
            if (pmenuOpen()) { setTimeout(refreshData, 1500); return; }
            if (old && old.parentNode) old.parentNode.removeChild(old);
            if (oldWorkspace && oldWorkspace.parentNode) oldWorkspace.parentNode.removeChild(oldWorkspace);
            var holder = findAnchor();
            if (!holder) return;
            var section = holder.closest("section") || holder.parentElement;
            if (!section || !section.parentNode) return;
            build(section, list);
          }).catch(function () {}).finally(function () {
            refreshInFlight = false;
            if (refreshQueued) { refreshQueued = false; setTimeout(refreshData, 250); }
          });
      } catch (e) {
        refreshInFlight = false;
        if (refreshQueued) { refreshQueued = false; setTimeout(refreshData, 250); }
      }
    }
    var lastRoute = "";
    /* 供 01-shared 的 createSession 调用：新建会话后立刻刷新项目区 */
    window.WB.refreshProjects = function () { refreshData(); };
    function onRoute() {
      try {
        if (location.pathname.indexOf("/session/") !== 0) return;
        paintActiveSession();
        if (location.pathname === lastRoute) return;
        lastRoute = location.pathname;
        setTimeout(refreshData, 2500);
        setTimeout(refreshData, 20000);
      } catch (e) {}
    }
    try {
      window.addEventListener("popstate", function () { setTimeout(onRoute, 0); });
      var _push = history.pushState;
      history.pushState = function () { try { setTimeout(onRoute, 0); } catch (e2) {} return _push.apply(this, arguments); };
      if (!window.__wbProjWsHooked) {
        window.__wbProjWsHooked = 1;
        var _wsSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          try {
            if (typeof data === "string" && data.indexOf('"chat.send"') >= 0) {
              setTimeout(refreshData, 8000);
              setTimeout(refreshData, 25000);
            }
          } catch (e2) {}
          return _wsSend.apply(this, arguments);
        };
      }
      onRoute();
    } catch (e) {}
  } catch (e) { try { console.warn("[wb-projects]", e); } catch (_) {} }
})();
