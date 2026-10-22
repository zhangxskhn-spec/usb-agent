/* ============================================================
 * 90-permission-labels
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 *
 * 权限下拉只保留 3 档后，文案要跟着改成人话：
 *   默认模式   -> 手动
 *   编辑模式   -> 自动
 *   无限制模式 -> 全部允许
 * 说明文字也一起换掉：bundle 里那几句其实是给 Codex 写的（"沙盒执行""完全自动模式"），
 * 套在 Claude 的三档上会误导 —— 比如 acceptEdits 并不会自动跑命令。
 *
 * 为什么走 DOM 而不是改语言包：选项名是 i18n key（codex.modes.*），
 * 语言包被压进 bundle，运行时拿不到 i18n 实例；本项目一贯做法就是注入器就地改。
 * 只做「整段文本节点精确相等」的替换，不会误伤正文里出现的同名词。
 * ============================================================ */

;(function () {
  try {
    if (window.__wbPermLabels) { return; }
    window.__wbPermLabels = true;

    /* 旧值迁移：auto / plan 已经不在列表里了。
       auto 曾经的含义（模型逐条判断）最接近现在的「自动」，迁移成 acceptEdits，
       免得老用户升级后突然掉回「手动」而以为又坏了。 */
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { keys.push(localStorage.key(i)); }
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k] || "";
        if (key.indexOf("permissionMode") !== 0) { continue; }
        var val = localStorage.getItem(key);
        if (val === "auto") { localStorage.setItem(key, "acceptEdits"); }
        else if (val === "plan") { localStorage.setItem(key, "default"); }
      }
    } catch (e) {}

    var LABELS = {
      /* 中文界面（chat.codex.modes.*） */
      "\u9ed8\u8ba4\u6a21\u5f0f": "\u624b\u52a8",              /* 默认模式 -> 手动 */
      "\u7f16\u8f91\u6a21\u5f0f": "\u81ea\u52a8",              /* 编辑模式 -> 自动 */
      "\u65e0\u9650\u5236\u6a21\u5f0f": "\u5168\u90e8\u5141\u8bb8", /* 无限制模式 -> 全部允许 */
      /* 英文界面（同一批 key 的英文包）——英文就整句英文，别中英混排 */
      "Default Mode": "Manual",
      "Accept Edits": "Auto",
      "Bypass Permissions": "Allow All"
    };

    var DESCS = {};
    DESCS["\u53ea\u6709\u53d7\u4fe1\u4efb\u7684\u547d\u4ee4\uff08ls\u3001cat\u3001grep\u3001git status \u7b49\uff09\u81ea\u52a8\u8fd0\u884c\u3002\u5176\u4ed6\u547d\u4ee4\u5c06\u88ab\u8df3\u8fc7\u3002\u53ef\u4ee5\u5199\u5165\u5de5\u4f5c\u533a\u3002"] =
      "\u6bcf\u4e00\u6b65\u90fd\u5148\u95ee\u4f60\uff1a\u6539\u6587\u4ef6\u3001\u8dd1\u547d\u4ee4\u90fd\u8981\u786e\u8ba4\u3002";
    DESCS["\u5de5\u4f5c\u533a\u5185\u7684\u6240\u6709\u547d\u4ee4\u81ea\u52a8\u8fd0\u884c\u3002\u5b8c\u5168\u81ea\u52a8\u6a21\u5f0f\uff0c\u5177\u6709\u6c99\u76d2\u6267\u884c\u529f\u80fd\u3002"] =
      "\u6539\u6587\u4ef6\u76f4\u63a5\u843d\u76d8\uff1b\u8dd1\u547d\u4ee4\u4ecd\u4f1a\u8be2\u95ee\u3002\u65e5\u5e38\u6700\u987a\u624b\u3002";
    DESCS["\u5b8c\u5168\u7684\u7cfb\u7edf\u8bbf\u95ee\uff0c\u65e0\u9650\u5236\u3002\u6240\u6709\u547d\u4ee4\u81ea\u52a8\u8fd0\u884c\uff0c\u5177\u6709\u5b8c\u6574\u7684\u78c1\u76d8\u548c\u7f51\u7edc\u8bbf\u95ee\u6743\u9650\u3002\u8bf7\u8c28\u614e\u4f7f\u7528\u3002"] =
      "\u4e0d\u518d\u8be2\u95ee\u4efb\u4f55\u786e\u8ba4\uff1a\u547d\u4ee4\u4e0e\u6587\u4ef6\u6539\u52a8\u5168\u90e8\u76f4\u63a5\u6267\u884c\u3002\u8bf7\u8c28\u614e\u4f7f\u7528\u3002";
    DESCS["Only trusted commands (ls, cat, grep, git status, etc.) run automatically. Other commands are skipped. Can write to workspace."] =
      "Asks you before every file change and command.";
    DESCS["All commands run automatically within the workspace. Full auto mode with sandboxed execution."] =
      "Accepts file edits automatically; commands still ask.";
    DESCS["Full system access with no restrictions. All commands run automatically with full disk and network access. Use with caution."] =
      "Never asks: every command and edit runs immediately. Use with caution.";

    function rewriteTextNode(node) {
      var raw = node.nodeValue;
      if (!raw) { return; }
      var text = raw.replace(/^\s+|\s+$/g, "");
      if (!text) { return; }
      var hit = LABELS[text] || DESCS[text];
      if (hit === undefined) { return; }
      node.nodeValue = raw.replace(text, hit);
    }

    function sweep(root) {
      if (!root) { return; }
      try {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var node, batch = [];
        while ((node = walker.nextNode())) { batch.push(node); }
        for (var i = 0; i < batch.length; i++) { rewriteTextNode(batch[i]); }
      } catch (e) {}
    }

    /* 共享观察者（01-shared）：全包唯一 MutationObserver，只监听 childList。
       下拉菜单是 portal 到 body 的、打开时才渲染，所以每次 DOM 变化后扫一遍即可；
       我们改的是文本节点内容，不会触发 childList，不存在自激循环。 */
    if (window.WB && window.WB.onMutate) {
      window.WB.onMutate(function () { sweep(document.body); });
    } else {
      document.addEventListener("DOMContentLoaded", function () { sweep(document.body); });
    }
    sweep(document.body);
  } catch (e) { try { console.warn("[wb-perm-labels]", e); } catch (_) {} }
})();
