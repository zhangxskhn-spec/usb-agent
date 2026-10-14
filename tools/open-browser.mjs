/**
 * open-browser.mjs —— 等网页服务起来后，用 U 盘上的独立浏览器配置打开界面
 *
 * 替代原来的 open-when-ready.bat（纯批处理找 Edge/Chrome + `start`）。
 * 旧写法有两个坑，正好凑成了用户遇到的「U 盘弹不出来」：
 *   ① 找不到 Edge/Chrome 时退回 `start "" <url>`，于是走系统默认浏览器，浏览器把
 *      user-data-dir 建在被重定向过的 LOCALAPPDATA 里 —— 也就是建在了 **U 盘**上
 *      （data\home\AppData\Local\Microsoft\Edge\User Data），而不是 data\browser-profile；
 *   ② `start` 出来的浏览器是脱离控制台的独立进程，关黑窗带不走它，它的 crashpad
 *      handler 还会一直占着 U 盘上的文件。
 * 现在：用 Node 稳稳地找到浏览器、强制 `--user-data-dir=<U盘>\data\browser-profile`，
 * 并且**不脱离控制台**（不传 windowsHide / detached），关黑窗时连带结束，U 盘才真的能弹。
 *
 * 用法：node tools/open-browser.mjs [端口]     端口默认 3001
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : '3001';
const URL = `http://127.0.0.1:${PORT}`;

/**
 * 浏览器配置目录：默认放在**本机磁盘**，不再放 U 盘。
 *
 * 为什么改：profile 放在 U 盘上时，即使关掉了黑窗和浏览器窗口，Edge 残留的进程
 * （crashpad 这类会主动脱离进程组的子进程）仍然握着 U 盘上的文件句柄，U 盘就弹不出来。
 * 挪到本机后，U 盘上不再有任何浏览器数据 —— 浏览器爱活多久活多久，都不影响弹出。
 * 登录态不受影响：本机免登录令牌是前端注入器写进 localStorage 的，新 profile 也能自动登录。
 * 想放回去就设环境变量 USB_BROWSER_PROFILE。
 */
function defaultProfile() {
  const real = process.env.AI_REAL_USERPROFILE || process.env.USERPROFILE || '';
  if (real) return path.join(real, 'AppData', 'Local', 'usb-agent-browser-profile');
  return path.join(os.tmpdir(), 'usb-agent-browser-profile');
}
const PROFILE = process.env.USB_BROWSER_PROFILE || defaultProfile();

/**
 * 给浏览器的环境：把 START.bat 重定向到 U 盘的 USERPROFILE / APPDATA / LOCALAPPDATA / TEMP
 * **还原成真机的**。
 *
 * 为什么必须这么做：只给 --user-data-dir 不够。浏览器还会用 USERPROFILE 派生出来的
 * `AppData\LocalLow`，输入法（搜狗）这类注入到浏览器进程里的组件就会顺着这条路径
 * **把日志写进 U 盘**（实测：data\home\AppData\LocalLow\SogouPY\LOG\IME\msedge_*.log），
 * 而且这些句柄还会一直开着，U 盘照样弹不出来。
 */
function realEnv() {
  const real = process.env.AI_REAL_USERPROFILE || process.env.USERPROFILE || '';
  const env = { ...process.env, USB_BROWSER_PROFILE: PROFILE };
  if (real) {
    env.USERPROFILE = real;
    env.HOME = real;
    env.LOCALAPPDATA = path.join(real, 'AppData', 'Local');
    env.APPDATA = path.join(real, 'AppData', 'Roaming');
    env.TEMP = path.join(real, 'AppData', 'Local', 'Temp');
    env.TMP = env.TEMP;
  }
  return env;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(URL + '/', { signal: ctrl.signal });
      clearTimeout(t);
      if (res.status >= 200 && res.status < 500) return true;
    } catch (_) { /* 还没起来 */ }
    if (Date.now() > deadline) return false;
    await wait(1200);
  }
}

function firstExisting(list) {
  for (const p of list) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return '';
}

/* 关键：用「真实用户目录」（START.bat 会把它存进 AI_REAL_USERPROFILE）来找 Chrome，
   因为 LOCALAPPDATA 已被重定向到 U 盘，用 %LocalAppData% 是找不到的。 */
function realLocalAppData() {
  const real = process.env.AI_REAL_USERPROFILE || '';
  return real ? path.join(real, 'AppData', 'Local') : (process.env.LOCALAPPDATA || '');
}

function findBrowser() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const la = realLocalAppData();
  return firstExisting([
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    la && path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    la && path.join(la, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

const browser = findBrowser();

if (process.argv.includes('--dry-run')) {
  console.log(`[open-browser] 页面地址 : ${URL}`);
  console.log(`[open-browser] 浏览器   : ${browser || '（没找到 Edge/Chrome，会退回系统默认浏览器）'}`);
  console.log(`[open-browser] profile  : ${PROFILE}`);
  process.exit(0);
}

/* ⚠ 本进程必须**一直活着**，不能像以前那样开完浏览器就退出。
   Windows 上 detached:false 的子进程挂在父进程的 Job Object 上，父进程一退出就把它
   一起杀掉 —— 浏览器会刚开就消失（表现形式就是"点了 1 没反应"）。
   所以这里开完浏览器后原地待命：由 START.bat 用 `start "" /b` 拉起，与启动器共享控制台，
   控制台一关，本进程和浏览器一起被系统终止（U 盘也就不会被浏览器占着）。 */
const RUN_DIR = path.join(ROOT, 'data', 'run');
const BROWSER_PID_FILE = path.join(RUN_DIR, 'browser.pid');
try {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(BROWSER_PID_FILE, `${process.pid}\n`, 'utf8');
} catch (_) {}
for (const sig of ['SIGINT', 'SIGBREAK', 'SIGTERM']) {
  try { process.on(sig, () => {}); } catch (_) {}
}

const ok = await ready();
if (!ok) {
  console.warn(`[open-browser] 等待 ${URL} 超时，仍尝试打开浏览器（服务可能起得慢）。`);
}

try { fs.mkdirSync(PROFILE, { recursive: true }); } catch (_) {}

const args = [
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  URL,
];

if (browser) {
  console.log(`[open-browser] ${browser}`);
  console.log(`[open-browser] profile: ${PROFILE}`);
  try {
    /* detached:false + 不传 windowsHide → 与启动器共享控制台：
       关掉黑窗时系统会连带结束浏览器，U 盘才不会被它占着。
       env 用真机的用户目录（见 realEnv 的注释）。 */
    const child = spawn(browser, args, { detached: false, stdio: 'ignore', env: realEnv() });
    child.unref();
  } catch (e) {
    console.warn('[open-browser] 启动浏览器失败：', e && e.message ? e.message : e);
    spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
} else {
  console.warn('[open-browser] 没找到 Edge/Chrome，改用系统默认浏览器。');
  console.warn('[open-browser] 注意：这条路会用宿主机自己的浏览器配置（不会写进 U 盘）。');
  /* ⚠ 必须把被重定向到 U 盘的 LOCALAPPDATA/USERPROFILE 还原成真机的：
     否则默认浏览器会把它的 profile（以及输入法那类注入组件的日志）建在被重定向的
     目录里 —— 也就是建在 U 盘上，而 Edge 的后台常驻进程关窗口也不退，U 盘再也弹不出来。
     这是踩过的坑：日志里出现过 data\home\AppData\LocalLow\SogouPY\LOG\IME\msedge_*.log。 */
  spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore', windowsHide: true, env: realEnv() }).unref();
}

/* 原地待命（见上面的注释：一退出就会把刚开的浏览器带走） */
setInterval(() => {}, 60000);
