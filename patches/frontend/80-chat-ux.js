/* ============================================================
 * 80-chat-ux
 * 会话级草稿、发送状态与失败恢复（不改动原生 React composer）
 * ============================================================ */
;(function () {
  try {
    if (window.__wbChatUxInstalled) return;
    window.__wbChatUxInstalled = true;
    var MAX_DRAFT = 100000;
    var currentSid = "";
    var currentInput = null;
    var previousSid = "";
    var restoring = false;
    var draftCache = {};
    var clientId = "";
    try { clientId = localStorage.getItem("wb-client-id") || ""; if (!clientId) { clientId = "wb-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("wb-client-id", clientId); } } catch (e) { clientId = "wb-session"; }
    var saveTimers = {};
    var pending = {};
    var SEND_TIMEOUT_MS = 45000;
    var sockets = [];
    var statusState = { sid: "", kind: "", message: "", frame: null, durationMs: 0 };
    function durationKey(sid) { return "wb-duration:" + sid; }
    function saveLastDuration(sid, durationMs) {
      if (!sid || !durationMs) return;
      try { localStorage.setItem(durationKey(sid), JSON.stringify({ durationMs: Number(durationMs), at: Date.now() })); } catch (e) {}
    }
    function readLastDuration(sid) {
      if (!sid) return 0;
      try {
        var item = JSON.parse(localStorage.getItem(durationKey(sid)) || "null");
        return item && Number(item.durationMs) > 0 ? Number(item.durationMs) : 0;
      } catch (e) { return 0; }
    }

    function token() { try { return window.WB && window.WB.token ? window.WB.token() : localStorage.getItem("auth-token"); } catch (e) { return null; } }
    function sidFromUrl() {
      try { var m = String(location.pathname || "").match(/^\/session\/([^/?#]+)/); return m ? decodeURIComponent(m[1]) : ""; } catch (e) { return ""; }
    }
    function visible(el) { try { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (e) { return false; } }
    function findComposer() {
      var candidates = Array.prototype.slice.call(document.querySelectorAll("textarea, [contenteditable=\"true\"], .ProseMirror"));
      var scored = candidates.filter(visible).map(function (el) {
        var score = 0, ph = String(el.getAttribute("placeholder") || "").toLowerCase(), aria = String(el.getAttribute("aria-label") || "").toLowerCase();
        if (el.tagName === "TEXTAREA") score += 3;
        if (/message|发送|输入|ask|prompt|reply|chat/.test(ph + " " + aria)) score += 10;
        if (el.closest("form")) score += 2;
        if (el.closest("main")) score += 1;
        if (el.closest("[data-radix-popper-content-wrapper]")) score -= 20;
        return { el: el, score: score };
      }).sort(function (a, b) { return b.score - a.score; });
      return scored.length ? scored[0].el : null;
    }
    function readInput(el) {
      if (!el) return "";
      return el.isContentEditable ? String(el.innerText || el.textContent || "") : String(el.value || "");
    }
    function writeInput(el, text) {
      if (!el) return;
      text = String(text || "").slice(0, MAX_DRAFT);
      restoring = true;
      try {
        if (el.isContentEditable) { el.textContent = text; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })); }
        else {
          var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          var setter = Object.getOwnPropertyDescriptor(proto, "value");
          if (setter && setter.set) setter.set.call(el, text); else el.value = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (e) {} finally { setTimeout(function () { restoring = false; }, 0); }
    }
    function localKey(sid) { return "wb-draft:" + sid; }
    function localRead(sid) { try { return localStorage.getItem(localKey(sid)) || ""; } catch (e) { return ""; } }
    function localWrite(sid, text) { try { if (text) localStorage.setItem(localKey(sid), text.slice(0, MAX_DRAFT)); else localStorage.removeItem(localKey(sid)); } catch (e) {} }
    function apiHeaders() { return { "Content-Type": "application/json", Authorization: "Bearer " + (token() || "") }; }
    function draftText(value) { return value && typeof value === "object" ? String(value.text || "") : String(value || ""); }
    function saveDraft(sid, text, immediate) {
      if (!sid) return;
      text = String(text || "").slice(0, MAX_DRAFT); var updatedAt = Date.now(); draftCache[sid] = { text: text, updatedAt: updatedAt, clientId: clientId }; localWrite(sid, text);
      try { window.dispatchEvent(new CustomEvent("wb:draft", { detail: { sid: sid, text: text } })); } catch (e0) {}
      if (saveTimers[sid]) clearTimeout(saveTimers[sid]);
      var run = function () {
        delete saveTimers[sid];
        fetch("/api/user/drafts", { method: text ? "PUT" : "DELETE", headers: apiHeaders(), body: JSON.stringify(text ? { scope: sid, text: text, updatedAt: updatedAt, clientId: clientId } : { scope: sid }) }).then(function (r) {
          if (r.status !== 409) return null;
          return r.json().then(function (body) { var detail = body && body.error && body.error.details; var remote = detail && detail.draft; if (remote) draftCache[sid] = { text: String(remote.text || ""), updatedAt: Date.parse(String(remote.updatedAt || "")) || Date.now(), clientId: "remote" }; setStatus(sid, "failed", "检测到其他设备更新了草稿", null); return null; });
        }).catch(function () {});
      };
      if (immediate) run(); else saveTimers[sid] = setTimeout(run, 380);
    }
    function clearDraft(sid) { if (!sid) return; delete draftCache[sid]; localWrite(sid, ""); try { window.dispatchEvent(new CustomEvent("wb:draft", { detail: { sid: sid, text: "" } })); } catch (e0) {} if (saveTimers[sid]) clearTimeout(saveTimers[sid]); delete saveTimers[sid]; fetch("/api/user/drafts", { method: "DELETE", headers: apiHeaders(), body: JSON.stringify({ scope: sid }) }).catch(function () {}); }
    function loadDrafts() {
      fetch("/api/user/drafts", { headers: { Authorization: "Bearer " + (token() || "") } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        var list = data && data.drafts || data && data.data && data.data.drafts || [];
        if (Array.isArray(list)) list.forEach(function (d) { if (d && d.scope) { var t = String(d.text || ""); draftCache[d.scope] = { text: t, updatedAt: Date.parse(String(d.updatedAt || "")) || 0, clientId: "remote" }; if (t) localWrite(d.scope, t); } });
        try { window.dispatchEvent(new CustomEvent("wb:drafts-loaded")); } catch (e0) {}
        restoreDraft();
      }).catch(function () { restoreDraft(); });
    }
    function restoreDraft() {
      if (!currentSid || !currentInput) return;
      var text = Object.prototype.hasOwnProperty.call(draftCache, currentSid) ? draftText(draftCache[currentSid]) : localRead(currentSid);
      if (text && !readInput(currentInput).trim()) writeInput(currentInput, text);
    }
    function saveCurrentDraft() { if (currentSid && currentInput && !restoring) saveDraft(currentSid, readInput(currentInput), false); }
    function formatDuration(durationMs) {
      var ms = Math.max(0, Number(durationMs) || 0);
      if (ms < 1000) return "不到 1 秒";
      var seconds = ms / 1000;
      return (seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()) + " 秒";
    }
    function statusText(kind, message, durationMs) {
      if (kind === "sending") return "发送中...";
      if (kind === "failed") return "发送失败" + (message ? "：" + message : "");
      if (kind === "reconnecting") return "连接中断，正在重连...";
      if (kind === "sent") return "总用时：" + formatDuration(durationMs);
      return "";
    }
    function renderStatus() {
      var sid = sidFromUrl();
      var bar = document.querySelector("[data-wb-send-status]");
      if (!bar || statusState.sid !== sid) { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }
      if (!bar) {
        var input = currentInput || findComposer(); if (!input || !input.parentNode) return;
        bar = document.createElement("div"); bar.setAttribute("data-wb-send-status", "1");
        bar.style.cssText = "display:flex;align-items:center;gap:8px;min-height:0;padding:0 4px;color:hsl(var(--muted-foreground,215 16% 47%));font-size:11px;";
        input.parentNode.insertBefore(bar, input);
      }
      bar.innerHTML = "";
      if (!statusState.kind || statusState.sid !== sid) { bar.style.display = "none"; return; }
      bar.style.display = "flex";
      var label = document.createElement("span"); label.textContent = statusText(statusState.kind, statusState.message, statusState.durationMs); label.style.color = statusState.kind === "failed" ? "#dc2626" : ""; bar.appendChild(label);
      if (statusState.kind === "failed" && statusState.frame) {
        var retry = document.createElement("button"); retry.type = "button"; retry.textContent = "重试"; retry.title = "重新发送";
        retry.style.cssText = "border:0;background:transparent;color:#D97757;cursor:pointer;font-size:11px;padding:2px 4px;";
        retry.onclick = function () { retryFrame(statusState.frame); }; bar.appendChild(retry);
      }
    }
    function setStatus(sid, kind, message, frame, durationMs) { statusState = { sid: sid || "", kind: kind || "", message: message || "", frame: frame || null, durationMs: Number(durationMs) || 0 }; renderStatus(); }
    function armSendTimeout(sid, entry) {
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(function () {
        if (pending[sid] !== entry) return;
        delete entry.timer;
        if (entry.awaitingReconnect) return;
        setStatus(sid, "failed", "响应超时", entry.frame);
      }, SEND_TIMEOUT_MS);
    }
    function retryFrame(frame, automatic) {
      if (!frame || !frame.sessionId) return;
      var sock = sockets.filter(function (s) { return s && s.readyState === 1; })[0];
      if (!sock) { setStatus(frame.sessionId, "reconnecting", "连接不可用", frame); return; }
      var entry = pending[frame.sessionId] || { text: String(frame.content || ""), frame: frame, retried: false };
      if (automatic && entry.retried) { setStatus(frame.sessionId, "failed", "重连后重试失败", frame); return; }
      if (automatic) entry.retried = true;
      entry.awaitingReconnect = false; entry.frame = frame; entry.text = String(frame.content || ""); entry.startedAt = Date.now(); pending[frame.sessionId] = entry;
      setStatus(frame.sessionId, "sending", "", frame);
      saveDraft(frame.sessionId, String(frame.content || ""), true);
      try { sock.__wbSkipCapture = true; wsSend.call(sock, JSON.stringify(frame)); armSendTimeout(frame.sessionId, entry); } catch (e) { setStatus(frame.sessionId, "failed", e.message, frame); } finally { sock.__wbSkipCapture = false; }
    }
    function handleSocketData(raw) {
      var msg = null; try { if (typeof raw === "string") msg = JSON.parse(raw); else return; } catch (e) { return; }
      if (!msg || typeof msg !== "object") return;
      var sid = msg.sessionId || msg.session_id || "";
      if (!sid) return;
      if (msg.kind === "error" || msg.kind === "protocol_error") {
        var err = String(msg.content || msg.error || msg.message || "请求失败").slice(0, 160);
        var p = pending[sid];
        if (p) {
          if (p.timer) { clearTimeout(p.timer); p.timer = null; }
          var typed = currentSid === sid && currentInput ? readInput(currentInput) : "";
          if (typed.trim() && typed.trim() !== String(p.text || "").trim()) saveDraft(sid, typed, true);
          else { writeInput(currentInput, p.text); saveDraft(sid, p.text, true); }
          setStatus(sid, "failed", err, p.frame);
        }
      } else if (msg.kind === "complete") {
        var pendingRun = pending[sid];
        if (Number(msg.exitCode) === 0 || msg.exitCode == null) {
          if (pendingRun && pendingRun.timer) { clearTimeout(pendingRun.timer); pendingRun.timer = null; }
          delete pending[sid];
          var afterSend = currentSid === sid && currentInput ? readInput(currentInput) : "";
          var sentText = pendingRun ? String(pendingRun.text || "").trim() : "";
          /* 用户没有在发送期间继续输入时，明确清空原生 composer；仅清理
             草稿存储不足以清掉 React 受控输入框里的旧值。 */
          if (currentSid === sid && currentInput && (!afterSend.trim() || !pendingRun || afterSend.trim() === sentText)) {
            writeInput(currentInput, "");
            afterSend = "";
          }
          if (!afterSend.trim() || !pendingRun || afterSend.trim() === sentText) clearDraft(sid);
          if (window.WB && window.WB.finalizePendingSession) window.WB.finalizePendingSession(sid);
          var durationMs = pendingRun && pendingRun.startedAt ? Date.now() - pendingRun.startedAt : 0;
          if (durationMs > 0) saveLastDuration(sid, durationMs);
          setStatus(sid, "sent", "", null, durationMs || readLastDuration(sid));
        }
        else if (pendingRun) { saveDraft(sid, pendingRun.text, true); setStatus(sid, "failed", "任务未完成", pendingRun.frame); }
      }
    }
    function bindSocket(socket) {
      if (!socket || socket.__wbChatBound) return; socket.__wbChatBound = true; sockets.push(socket);
      socket.addEventListener("message", function (ev) { handleSocketData(ev.data); });
      socket.addEventListener("close", function () { Object.keys(pending).forEach(function (sid) { var p = pending[sid]; p.awaitingReconnect = true; if (p.timer) { clearTimeout(p.timer); p.timer = null; } setStatus(sid, "reconnecting", "连接已断开，正在重连...", p.frame); }); });
      socket.addEventListener("open", function () { setTimeout(function () { Object.keys(pending).forEach(function (sid) { var p = pending[sid]; if (p && p.awaitingReconnect) retryFrame(p.frame, true); }); }, 600); });
    }
    function retryAwaitingOnSocket(socket) {
      if (!socket || socket.__wbRetryScheduled) return;
      socket.__wbRetryScheduled = true;
      setTimeout(function () { socket.__wbRetryScheduled = false; Object.keys(pending).forEach(function (sid) { var p = pending[sid]; if (p && p.awaitingReconnect) retryFrame(p.frame, true); }); }, 600);
    }
    var wsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      bindSocket(this);
      if (this.readyState === 1) retryAwaitingOnSocket(this);
      try {
        if (typeof data === "string" && !this.__wbSkipCapture) {
          var frame = JSON.parse(data);
          if (frame && (frame.type === "chat.send" || frame.type === "chat.edit-send") && frame.sessionId) {
            var text = String(frame.content || "");
            var entry = pending[frame.sessionId] = { text: text, frame: frame, retried: false, awaitingReconnect: false, timer: null, startedAt: Date.now() };
            saveDraft(frame.sessionId, text, true);
            setStatus(frame.sessionId, "sending", "", frame);
            setTimeout(function () { armSendTimeout(frame.sessionId, entry); }, 0);
          }
        }
      } catch (e) {}
      try { return wsSend.apply(this, arguments); } catch (e2) { setStatus(currentSid, "failed", e2.message, null); throw e2; }
    };
    function bindComposer() {
      var sid = sidFromUrl();
      var input = findComposer();
      if (!input || !sid) { renderStatus(); return; }
      if (input !== currentInput || sid !== currentSid) {
        if (currentSid && currentInput && currentSid !== sid) saveCurrentDraft();
        previousSid = currentSid; currentSid = sid; currentInput = input;
        if (statusState.sid !== sid) {
          var lastDuration = readLastDuration(sid);
          statusState = { sid: sid, kind: lastDuration ? "sent" : "", message: "", frame: null, durationMs: lastDuration };
        }
        input.addEventListener("input", function () { if (!restoring) saveCurrentDraft(); });
        restoreDraft();
      }
      renderStatus();
    }
    window.addEventListener("popstate", function () {
      saveCurrentDraft();
      currentInput = null;
      currentSid = "";
      statusState = { sid: sidFromUrl(), kind: "", message: "", frame: null, durationMs: 0 };
      setTimeout(bindComposer, 120);
    });
    window.addEventListener("beforeunload", saveCurrentDraft);
    if (window.WB && window.WB.onMutate) window.WB.onMutate(function () { setTimeout(bindComposer, 0); });
    [0, 120, 400, 1000].forEach(function (delay) { setTimeout(bindComposer, delay); });
    loadDrafts();
    bindComposer();
    window.addEventListener("keydown", function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        var search = document.querySelector('input[type="search"][placeholder="搜索所有对话..."]');
        if (search && visible(search)) { ev.preventDefault(); search.focus(); return; }
        var input = findComposer(); if (input && sidFromUrl()) { ev.preventDefault(); input.focus(); }
      }
    }, true);
  } catch (e) { try { console.warn("[wb-chat-ux]", e); } catch (_) {} }
})();
