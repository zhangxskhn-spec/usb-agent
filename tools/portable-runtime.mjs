import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(ROOT, 'data', 'run');
const PID_FILE = path.join(RUN_DIR, 'gateway.pid');
const PORT_FILE = path.join(RUN_DIR, 'gateway.port');
const WATCH_PID_FILE = path.join(RUN_DIR, 'gw-watch.pid');   /* supervise 常驻进程的 pid */
const BROWSER_PID_FILE = path.join(RUN_DIR, 'browser.pid');  /* open-browser 常驻进程的 pid */

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const done = (available) => {
      server.removeAllListeners();
      try { server.close(); } catch (_) {}
      resolve(available);
    };
    server.once('error', () => done(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => done(true));
  });
}

async function findPort(start) {
  const first = Number.parseInt(start || '3001', 10);
  for (let port = Number.isFinite(first) ? first : 3001; port < 65535; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error('没有可用端口');
}

function readPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch (_) { return 0; }
}

function readPort() {
  try { return Number.parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10) || 0; }
  catch (_) { return 0; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function isOurGateway(port) {
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 700 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(res.statusCode === 200 && body.includes('"gw":"usbai"')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startGateway(port, quiet) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const oldPid = readPid();
  if (isAlive(oldPid) && readPort() === Number(port) && await isOurGateway(Number(port))) {
    if (!quiet) console.log(oldPid);
    return;
  }
  /* ⚠ Windows 上 detached:false 的子进程会被放进父进程的 Job Object，
     父进程一退出，内核就把它连同 Job 一起杀掉（实测确认）。
     所以网关必须 detached:true 才能真正"后台常驻"—— 但这样它又会脱离控制台，
     关黑窗带不走它。两者兼顾的办法：由 supervise 常驻父进程拉起（见下）。
     这里的 detached:true 路径保留给「我自己就是常驻监督者」的场景。 */
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'anthropic-gw.mjs')], {
    cwd: ROOT,
    env: { ...process.env, GW_PORT: String(port) },
    detached: false,
    stdio: 'ignore',
  });
  child.unref();
  fs.writeFileSync(PID_FILE, `${child.pid}\n`, 'utf8');
  fs.writeFileSync(PORT_FILE, `${port}\n`, 'utf8');
  /* supervise 模式下不打印：由 start /b 拉起时这一行会直接糊在启动窗口上 */
  if (!quiet) console.log(child.pid);
}

/**
 * supervise <port> —— 网关的「常驻监督者」
 *
 * 为什么需要它：为了让「关掉黑窗就能连带结束网关、U 盘才能弹出来」，
 * 网关必须 detached:false（共享控制台、不弹窗）；但 detached:false 的子进程会
 * 挂在父进程的 Job Object 上，父进程一退出就被杀 —— 于是网关根本活不下来。
 * 解法就是让父进程（本函数所在的进程）**一直活着**：它由 START.bat 用
 * `start "" /b` 拉起，与启动器共享控制台；控制台一关，它和网关一起被系统终止。
 */
async function supervise(port) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(WATCH_PID_FILE, `${process.pid}\n`, 'utf8');
  await startGateway(port, true);
  /* 忽略 Ctrl+C：本进程一死，Job 里的网关也会被带走。
     真正要停时由 stop-all / release-usb 按 pid 精确结束。 */
  for (const sig of ['SIGINT', 'SIGBREAK', 'SIGTERM']) {
    try { process.on(sig, () => {}); } catch (_) {}
  }
  /* 保活：不 unref 的定时器让事件循环一直有活干，进程就不会退出 */
  setInterval(() => {}, 60000);
}

function killPidFile(file) {
  const pid = (() => {
    try { return Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10); } catch (_) { return 0; }
  })();
  if (pid && pid !== process.pid) {
    try { process.kill(pid); } catch (_) {}
  }
  try { fs.rmSync(file, { force: true }); } catch (_) {}
}

/** 停掉网关 + 它的常驻监督者（关黑窗时系统自己会收，这里是显式退出的路径） */
async function stopGateway() {
  const pid = readPid();
  const port = readPort();
  if (pid && isAlive(pid) && await isOurGateway(port)) {
    try { process.kill(pid); } catch (_) {}
  }
  try { fs.rmSync(PID_FILE, { force: true }); } catch (_) {}
  try { fs.rmSync(PORT_FILE, { force: true }); } catch (_) {}
  killPidFile(WATCH_PID_FILE);
}

/**
 * 顺手关掉本会话打开的浏览器（含 crashpad 这类会脱离进程组、关窗口也带不走的残留）。
 * 按「命令行里带本包浏览器配置目录」匹配，只杀这一份 profile 的进程，不碰宿主浏览器。
 */
function killBrowsers() {
  const profile = process.env.USB_BROWSER_PROFILE
    || path.join(process.env.AI_REAL_USERPROFILE || process.env.USERPROFILE || '',
      'AppData', 'Local', 'usb-agent-browser-profile');
  if (!profile) return;
  /* 两份 profile 都要清：
     a) 本包专用的浏览器 profile（默认在本机）；
     b) 被重定向到包里的 LOCALAPPDATA（早期"找不到浏览器就 start <url>"那条路留下的
        Edge，它带 --user-data-dir=<包>\data\home\AppData\...\Edge\User Data，
        而且 Edge 的后台常驻进程关窗口也不退，会一直占着 U 盘）。
     只杀浏览器进程，且必须"配置目录落在包内"，绝不碰宿主机自己的浏览器。 */
  const needles = [profile, ROOT].filter(Boolean).map((s) => s.replace(/\\/g, '/').toLowerCase());
  const BROWSERS = new Set(['msedge.exe', 'chrome.exe', 'msedgewebview2.exe']);

  /* 全量枚举后在 Node 里过滤：把路径塞进 PowerShell 的 -like 表达式会被命令行编码搞坏
     （中文路径实测匹配不到），所以只让 PowerShell 输出 CSV，比较交给我们自己。 */
  const ps = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
    + 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation';
  let raw = '';
  try {
    raw = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  } catch (_) { return; }

  let killed = 0;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('"ProcessId"')) continue;
    const m = t.match(/^"?(\d+)"?\s*,\s*"?/);
    if (!m) continue;
    const pid = Number.parseInt(m[1], 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    const lower = t.replace(/\\/g, '/').toLowerCase();
    if (!needles.some((n) => lower.indexOf(n) >= 0)) continue;
    if (!/(msedge|chrome)\.exe/i.test(t)) continue;   /* 只杀浏览器 */
    try { process.kill(pid); killed += 1; } catch (_) {}
  }
  /* 第二轮：Edge 的后台常驻进程（--no-startup-window）命令行里**没有任何路径**，
     只能靠"它加载了本包里的文件"来认。只针对浏览器进程，绝不碰别的。 */
  /* ⚠ 必须扫全量 `Get-Process` 再回来过滤：写成 `Get-Process msedge,chrome` 时，
     只要 chrome 不存在整条命令就报错退出（execFileSync 抛异常 → 结果全空），
     后台那条 msedge 就漏掉了。 */
  const rootLike = ROOT.replace(/'/g, "''");
  const ps2 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
    + 'Get-Process | ForEach-Object { $p=$_; try { '
    + `$m = $p.Modules | Where-Object { $_.FileName -like '${rootLike}*' }; `
    + 'if ($m) { \'{0}|{1}\' -f $p.Id, $p.ProcessName } } catch {} }';
  let raw2 = '';
  try {
    raw2 = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps2,
    ], { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  } catch (_) { /* 忽略 */ }
  for (const line of raw2.split(/\r?\n/)) {
    const t2 = String(line).trim();
    if (!t2) continue;
    const [pidStr, name] = t2.split('|');
    const pid = Number.parseInt(String(pidStr).trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!/^(msedge|chrome)/i.test(String(name || ''))) continue;   /* 只杀浏览器 */
    try { process.kill(pid); killed += 1; } catch (_) {}
  }

  if (killed) console.log(`[portable-runtime] closed ${killed} browser process(es) for this profile`);
}

/** 停掉本会话拉起的全部常驻进程：网关 + 监督者 + 浏览器监督者 + 浏览器本身 */
async function stopAll() {
  await stopGateway();
  killPidFile(BROWSER_PID_FILE);
  killBrowsers();
}

function printPort() {
  const port = readPort();
  if (port) console.log(port);
}

const [command, value] = process.argv.slice(2);
try {
  if (command === 'find-port') console.log(await findPort(value));
  else if (command === 'start-gateway') await startGateway(value || process.env.GW_PORT || 4567);
  else if (command === 'supervise') await supervise(value || process.env.GW_PORT || 4567);
  else if (command === 'stop-gateway') await stopGateway();
  else if (command === 'stop-all') await stopAll();
  else if (command === 'read-port') printPort();
  else throw new Error('用法: find-port <起始端口> | supervise <端口> | start-gateway <端口> | stop-gateway | stop-all');
} catch (error) {
  console.error(`[portable-runtime] ${error.message || error}`);
  process.exitCode = 1;
}
