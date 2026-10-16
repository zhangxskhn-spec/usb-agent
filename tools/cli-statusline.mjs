#!/usr/bin/env node
/**
 * Claude Code 状态行（settings.json 的 statusLine）
 * ==================================================
 * 在输入框上方常驻一行中文速查，解决「不知道怎么换模型 / 怎么退出」。
 *
 * Claude Code 会把当前会话信息用 stdin 递一段 JSON 进来（session_id / model /
 * cwd / permissionMode / workspace …），这里只取 model.display_name 显示「当前模型」，
 * 其余是固定的按键提示。
 *
 * 由 tools/repair-portable-state.mjs 写进 settings.json：
 *     "statusLine": { "type": "command",
 *                     "command": "\"%USBAI_RUNTIME%\node\node.exe\" \"%USBAI_ROOT%\tools\cli-statusline.mjs\"" }
 * 用环境变量而不是绝对路径：既不把中文路径写进配置文件，也不用担心换盘符后失效。
 *
 * 任何异常都要能输出一行，否则状态行会突然空掉。
 */

const TITLE = '小张claude';
/*
 * 一行别太长：窗口窄的时候会被截断成 …。
 *
 * ⚠ 关于「模式」：Claude Code 底部那行 `⏵⏵ accept edits on (shift+tab to cycle)` 是
 * 内置英文，**没有本地化开关**（实测：内置文案是硬编码的；statusLine 收到的 JSON 里
 * 也【没有】permissionMode 字段，会话记录里的 permissionMode 又是滞后的），
 * 所以只能在这行里给出中文对照，让用户能对上下面那行英文。
 */
const HINT = '换模型 /model   ·   换模式 Shift+Tab   ·   退出 /exit';
/*
 * 第二行：给底部那行英文模式提示配中文对照（`⏵⏵ manual mode on (shift+tab to cycle)`）。
 * 实测状态行可以输出多行，所以这行就贴在英文那行正上方，一一对应。
 * 括号里是中文翻译；`accept edits` 官方没有 mode 字样，照它的原样写。
 */
const MODE_LEGEND =
  '模式对照：manual mode（手动）· auto mode（自动）· accept edits（接受编辑）· plan mode（计划）';

let raw = '';
let done = false;

function print() {
  if (done) return;
  done = true;
  let model = '';
  try {
    const info = JSON.parse(raw || '{}');
    const m = info && info.model;
    model = String((m && (m.display_name || m.id)) || '');
  } catch {
    /* 没有 stdin 或不是 JSON 也要照常显示 */
  }
  const head = model ? `${TITLE}  ·  ${model}` : TITLE;
  process.stdout.write(`${head}  |  ${HINT}\n${MODE_LEGEND}\n`);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', print);
process.stdin.on('error', print);
process.stdin.on('close', print);
// 兜底：stdin 迟迟不结束也要在 400ms 内吐出内容，别让状态行空着。
setTimeout(print, 400);
