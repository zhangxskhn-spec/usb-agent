/* ============================================================
 * 40-autotitle
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 * ============================================================ */

;(function () {
  try {
    var DEF = { "\u65b0\u5bf9\u8bdd": 1, "\u65b0\u4f1a\u8bdd": 1, "\u672a\u547d\u540d\u4f1a\u8bdd": 1, "Untitled Session": 1, "Untitled": 1 };
    var done = {};
    /* 统一取 token（01-shared） */
    function tok() { try { return window.WB.token(); } catch (e) { return null; } }
    function curTitle(id, cb) {
      fetch("/api/providers/sessions/" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + tok() } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var x = (j && (j.data || j)) || {};
          var t = x.summary || x.sessionTitle || x.name || (x.session && (x.session.summary || x.session.sessionTitle)) || "";
          cb(String(t).trim());
        }).catch(function () { cb(null); });
    }
    function aiTitle(text, cb) {
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; cb(""); } }, 12000);
      function finish(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cb(value || "");
      }
      try {
        fetch("/api/providers/wb-title", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok() }, body: JSON.stringify({ text: text }) })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { var t = j && j.data && j.data.title ? String(j.data.title).trim() : ""; finish(t); })
          .catch(function () { finish(""); });
      } catch (e) { finish(""); }
    }
    function patchTitle(id, t, oldT) {
      fetch("/api/providers/sessions/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok() }, body: JSON.stringify({ summary: t }) })
        .then(function (r) {
          if (!r.ok) return;
          try {
            var n = 0;
            var els = document.querySelectorAll("p,span,div,h1,h2");
            for (var i = 0; i < els.length && n < 2; i++) {
              var e2 = els[i];
              if (e2.childElementCount || e2.id === "wb-plus-menu" || (e2.closest && e2.closest("#wb-plus-menu"))) continue;
              var rct = e2.getBoundingClientRect();
              if (rct.width < 1 || rct.top > 160 || rct.top < 0) continue;
              if ((e2.textContent || "").trim() === oldT) { e2.textContent = t; n++; }
            }
            var rows = document.querySelectorAll('a[href^="/session/' + id + '"]');
            for (var k = 0; k < rows.length && n < 5; k++) {
              var sp = rows[k].querySelector("span");
              if (sp && !sp.childElementCount && (sp.textContent || "").trim() === oldT) { sp.textContent = t; n++; }
            }
          } catch (e) {}
        }).catch(function () {});
    }
    var origSend = WebSocket.prototype.send;
    var pendingTitles = {};
    function runPendingTitle(sid) {
      var item = pendingTitles[sid];
      if (!item || item.started) return;
      item.started = 1;
      var txt = item.text;
      aiTitle(txt, function (t2) {
        if (!t2) { t2 = txt.length > 24 ? txt.slice(0, 24) + "\u2026" : txt; }
        curTitle(sid, function (cur) {
          if (cur === null) return;
          if (cur && !DEF[cur]) return;
          patchTitle(sid, t2, cur || "\u65b0\u5bf9\u8bdd");
        });
      });
    }
    function bindTitleSocket(socket) {
      if (!socket || socket.__wbTitleBound) return;
      socket.__wbTitleBound = 1;
      socket.addEventListener("message", function (ev) {
        try {
          var msg = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
          if (msg && msg.kind === "complete" && msg.sessionId) runPendingTitle(msg.sessionId);
        } catch (e) {}
      });
    }
    WebSocket.prototype.send = function (data) {
      try {
        bindTitleSocket(this);
        if (typeof data === "string" && data.indexOf("\"chat.send\"") >= 0) {
          var m = JSON.parse(data);
          if (m && m.type === "chat.send" && m.sessionId && m.content && !done[m.sessionId]) {
            done[m.sessionId] = 1;
            var txt = String(m.content).replace(/\s+/g, " ").trim();
            if (txt) {
              var sid = m.sessionId;
              pendingTitles[sid] = { text: txt, started: 0 };
              /* 不等待长时间工具调用结束；首条用户消息已经足够生成标题。
                 complete 事件仍会再次触发，但 runPendingTitle 有幂等保护。 */
              setTimeout(function () { runPendingTitle(sid); }, 1200);
            }
          }
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
    /* ---- v8: 进入会话时自动用真实对话内容优化标题（老对话也生效） ---- */
    var counted = {};
    function atCount(sid) { try { return parseInt(localStorage.getItem("wb-atc-" + sid) || "0", 10) || 0; } catch (e) { return 0; } }
    function atBump(sid) { try { localStorage.setItem("wb-atc-" + sid, String(atCount(sid) + 1)); } catch (e) {} }
    function msgsText(j) {
      try {
        var list = (j && j.data && j.data.messages) || [];
        var parts = [];
        for (var i = 0; i < list.length && parts.length < 8; i++) {
          var m = list[i];
          if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
          var c = m.content, t = "";
          if (typeof c === "string") t = c;
          else if (c && Array.isArray(c)) t = c.filter(function (x) { return x && x.type === "text"; }).map(function (x) { return x.text || ""; }).join(" ");
          t = String(t).replace(/\s+/g, " ").trim();
          if (t) parts.push((m.role === "user" ? "问:" : "答:") + t.slice(0, 160));
        }
        return parts.join("\n").slice(0, 900);
      } catch (e) { return ""; }
    }
    function optimizeOnOpen() {
      var mm = location.pathname.match(/^\/session\/([0-9a-f-]{8,})$/i);
      if (!mm) return;
      var sid = mm[1];
      if (counted[sid]) return;
      counted[sid] = 1;
      setTimeout(function () {
        try {
          if (atCount(sid) >= 3) return;
          curTitle(sid, function (cur) {
            if (cur === null) return;
            /* 已有像样标题且优化过一次就不再动；默认标题或从未优化过的旧标题都会尝试 */
            if (cur && !DEF[cur] && atCount(sid) >= 1) return;
            fetch("/api/providers/sessions/" + encodeURIComponent(sid) + "/messages?limit=10", { headers: { Authorization: "Bearer " + tok() } })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (j) {
                var body = msgsText(j);
                if (!body) return;
                fetch("/api/providers/wb-title", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok() }, body: JSON.stringify({ text: body, current: cur }) })
                  .then(function (r2) { return r2.ok ? r2.json() : null; })
                  .then(function (j2) {
                    var t = j2 && j2.data && j2.data.title ? String(j2.data.title).trim() : "";
                    if (!t || t === cur) return;
                    atBump(sid);
                    patchTitle(sid, t, cur || "\u65b0\u5bf9\u8bdd");
                  }).catch(function () {});
              }).catch(function () {});
          });
        } catch (e) {}
      }, 2600);
    }
    try {
      var pushState = history.pushState;
      history.pushState = function () { try { setTimeout(optimizeOnOpen, 0); } catch (e2) {} return pushState.apply(this, arguments); };
      window.addEventListener("popstate", function () { try { optimizeOnOpen(); } catch (e2) {} });
      optimizeOnOpen();
    } catch (e) {}
  } catch (e) { try { console.warn("[wb-autotitle]", e); } catch (_) {} }
})();
