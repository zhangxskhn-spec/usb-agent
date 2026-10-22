/* ============================================================
 * 91-permission-chip
 * usb-agent 前端注入器（由 patches/frontend 源码构建，勿直接改 bundle）
 *
 * 问题：网页端输入框工具栏里，权限切换本来就有，但只是一个 32x32 的图标按钮
 *       （`h-8 w-8 rounded-lg border`，按档位换颜色：灰=手动 / 绿=自动 / 橙=全部允许）。
 *       不看颜色根本认不出它是"权限"，跟旁边写着「默认（MiMo V2.6 Flash）」的模型下拉
 *       完全不是一个可读层级。
 *
 * 做法：把同一个按钮就地改成胶囊状 —— 保留原图标、后面补一个当前档位的中文名，
 *       点击行为完全不动（还是原生 onClick 打开那个菜单，菜单文案由 90-permission-labels.js 负责）。
 *       位置也不动，就紧挨着模型下拉的右边。
 *
 * 为什么只改样式 + 插一个 span：
 *   1) 不能换成自己的按钮 —— 那样点开的是我们自己的菜单，改不到 React 的 permissionMode；
 *   2) class 是 Tailwind，直接改 className 会被 React 重渲染覆盖，所以用内联 style；
 *   3) 插进去的 span 同样会被 React 覆盖，交给 WB.onMutate 每轮补回。
 * ============================================================ */

;(function () {
  try {
    if (window.__wbPermChip) { return; }
    window.__wbPermChip = true;

    var MARK = 'data-wb-perm-chip';
    var LABEL = 'data-wb-perm-chip-label';

    /* 档位中文字：颜色是按钮自带的 Tailwind 类，按它反推当前档位最省事 */
    function modeOf(btn) {
      var cls = ' ' + (btn.className || '') + ' ';
      if (cls.indexOf('text-green-') >= 0) { return '\u81ea\u52a8'; }          /* 自动 */
      if (cls.indexOf('text-orange-') >= 0) { return '\u5168\u90e8\u5141\u8bb8'; } /* 全部允许 */
      if (cls.indexOf('text-blue-') >= 0) { return '\u81ea\u52a8'; }           /* auto（本包不用） */
      if (cls.indexOf('text-primary') >= 0) { return '\u8ba1\u5212'; }         /* plan */
      return '\u624b\u52a8';                                                    /* 手动 */
    }

    function isPermButton(btn) {
      if (!btn || btn.tagName !== 'BUTTON') { return false; }
      if (btn.getAttribute('aria-haspopup') !== 'menu') { return false; }
      var label = (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '');
      /* 原生文案：「{{provider}} 的操作应如何批准？」；英文环境是 "How should ... be approved?" */
      return /批准|approved|approve/i.test(label);
    }

    function dress(btn) {
      var mode = modeOf(btn);
      if (btn.getAttribute(MARK) !== mode) {
        btn.setAttribute(MARK, mode);
        /* 只在尺寸/排布上动，颜色和边框还是原生那套（换档会跟着变） */
        btn.style.width = 'auto';
        btn.style.minWidth = '0';
        btn.style.paddingLeft = '8px';
        btn.style.paddingRight = '8px';
        btn.style.gap = '4px';
      }
      var span = btn.querySelector('[' + LABEL + ']');
      if (!span) {
        span = document.createElement('span');
        span.setAttribute(LABEL, '1');
        span.style.fontSize = '12px';
        span.style.lineHeight = '1';
        span.style.whiteSpace = 'nowrap';
        btn.appendChild(span);
      }
      if (span.textContent !== mode) { span.textContent = mode; }
    }

    function sweep() {
      try {
        var all = document.querySelectorAll('button[aria-haspopup="menu"]');
        for (var i = 0; i < all.length; i++) {
          if (isPermButton(all[i])) { dress(all[i]); }
        }
      } catch (e) {}
    }

    if (window.WB && window.WB.onMutate) {
      window.WB.onMutate(sweep);
    } else {
      document.addEventListener('DOMContentLoaded', sweep);
    }
    sweep();
  } catch (e) { try { console.warn('[wb-perm-chip]', e); } catch (_) {} }
})();
