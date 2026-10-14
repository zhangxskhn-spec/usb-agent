/**
 * release-usb.mjs —— 一键释放 U 盘（安全弹出前的收尾）
 *
 * 背景：这个便携包里同时跑着好几个进程，全都“脚踩在 U 盘上”：
 *   - 本地模型网关   runtime\node\node.exe  tools\anthropic-gw.mjs
 *   - 网页壳         runtime\node\node.exe  ...cloudcli\cli.js
 *   - Claude Code     runtime\node\node_modules\@anthropic-ai\claude-code\bin\claude.exe
 *   - 本会话浏览器   msedge/chrome --user-data-dir=<U盘>\data\browser-profile
 * 只要还有一个活着，Windows 就会拒绝弹出（“该设备正在使用中”）。
 *
 * 做法：按「命令行里是否出现本包根目录」枚举进程，逐个结束；网关另外按 pid 文件精确结束。
 * 关掉黑窗的场景已由「网关共享控制台」解决，本脚本是显式退出的兜底 + 应急。
 *
 * 用法：
 *   node tools/release-usb.mjs            # 结束占用进程（带确认输出）
 *   node tools/release-usb.mjs --check    # 只列出占用进程，不结束
 *   node tools/release-usb.mjs --root "E:\usb-agent"   # 释放另一个位置的同名包（换过盘符/盘里另有一份时）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootIdx = process.argv.findIndex((a) => a === '--root');
const ROOT = rootIdx >= 0 && process.argv[rootIdx + 1] ? path.resolve(process.argv[rootIdx + 1]) : HERE;
const RUN_DIR = path.join(ROOT, 'data', 'run');
const PID_FILE = path.join(RUN_DIR, 'gateway.pid');
const PORT_FILE = path.join(RUN_DIR, 'gateway.port');
const CHECK_ONLY = process.argv.includes('--check');

/* 这些是“宿主外壳”，绝不结束：批处理窗口、终端、资源管理器。
   否则脚本会把自己的窗口一起干掉，用户看不到结果。 */
const SHELL_NAMES = new Set([
  'cmd.exe', 'conhost.exe', 'powershell.exe', 'pwsh.exe',
  'windowsterminal.exe', 'openconsole.exe', 'explorer.exe', 'wscript.exe', 'cscript.exe',
]);

function norm(p) {
  return String(p || '')
    .replace(/\//g, '\\')
    .replace(/\\\\+/g, '\\')
    .toLowerCase();
}

const ROOT_N = norm(ROOT);

function readPid(file) {
  try {
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch (_) { return 0; }
}

/* ---- 进程枚举：优先 PowerShell CIM（wmic 在新系统上已被移除），失败再退回 wmic ---- */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return [];
  const header = splitCsvLine(rows[0]).map((h) => h.trim().toLowerCase());
  const iName = header.indexOf('name');
  const iPid = header.indexOf('processid');
  const iCmd = header.indexOf('commandline');
  const iExe = header.indexOf('executablepath');
  if (iPid < 0) return [];
  const list = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cols = splitCsvLine(rows[i]);
    const pid = Number.parseInt((cols[iPid] || '').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    list.push({
      pid,
      name: String(cols[iName >= 0 ? iName : -1] || '').trim(),
      cmd: String(cols[iCmd >= 0 ? iCmd : -1] || ''),
      exe: String(cols[iExe >= 0 ? iExe : -1] || ''),
    });
  }
  return list;
}

function listProcesses() {
  /* ⚠ 编码：控制台默认码页是 936，PowerShell 会按 ANSI 输出，中文路径会被解成乱码，
     那样和 ROOT 就永远比不中（"扫了 250 个进程却一个都没匹配上"就是这么来的）。
     这里强制 PowerShell 用 UTF-8 输出，并且解码失败时再退回 GBK 兜一层。 */
  const psCmd = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
    + 'Get-CimInstance Win32_Process | Select-Object Name,ProcessId,CommandLine,ExecutablePath | ConvertTo-Csv -NoTypeInformation';
  try {
    const buf = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd,
    ], { timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const list = parseCsv(decodeSmart(buf));
    if (list.length) return list;
  } catch (_) { /* 退回到 wmic */ }
  try {
    const buf = execFileSync('wmic', ['process', 'get', 'Name,ProcessId,CommandLine,ExecutablePath', '/format:csv'], {
      timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    });
    return parseCsv(decodeSmart(buf));
  } catch (_) { return []; }
}

/* 先按 UTF-8 解；出现替换字符说明不是 UTF-8，再按 GBK(cp936) 解一次。 */
function decodeSmart(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  const asUtf8 = b.toString('utf8');
  if (asUtf8.indexOf('\uFFFD') < 0) return asUtf8;
  try { return new TextDecoder('gbk').decode(b); } catch (_) { return asUtf8; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

/* 深度扫描：有些进程命令行里看不到本包路径，但**从 U 盘加载了 DLL/EXE**
   （典型：浏览器把自己的配置/组件目录指到 U 盘后，命令行被改写；SearchIndexer 之类）。
   这类进程 light 扫描会漏掉，于是「明明什么都没跑却弹不出来」。 */
function listModuleHolders() {
  const pattern = ROOT.replace(/'/g, "''");
  const psCmd = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
    + `Get-Process | ForEach-Object { $p=$_; try { $m = $p.Modules | Where-Object { $_.FileName -like '${pattern}*' }; `
    + `if ($m) { '{0}|{1}|{2}' -f $p.Id, $p.ProcessName, ($m | Select-Object -First 1 -ExpandProperty FileName) } } catch {} }`;
  try {
    const buf = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd,
    ], { timeout: 60000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const self = new Set([process.pid, process.ppid]);
    return decodeSmart(buf).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|');
      const pid = Number.parseInt(parts[0], 10);
      return { pid, name: parts[1] || '', cmd: '', exe: parts[2] || '' };
    }).filter((p) => Number.isInteger(p.pid) && p.pid > 0 && !self.has(p.pid)
      && !SHELL_NAMES.has(String(p.name).toLowerCase()));
  } catch (_) { return []; }
}

/* 判定「这个进程是不是踩在本包上」。
   ⚠ 不能只判断「命令行里出现包目录」：IDE / 编辑器 / 终端的命令行里常常只因为
   『当前工作目录是这个包』就带上这段路径（实测 WorkBuddy.exe 就这么被误判了），
   真按这个杀会连 IDE 一起干掉。必须认准**包里的可执行文件/脚本**。
   ① 命令行（或 --user-data-dir）指向包内的 runtime\ / tools\ / app\ / node_modules\
   ② 可执行文件本身就在包目录里（node.exe、claude.exe 这类，最稳） */
function inPackage(cmd) {
  const n = norm(cmd);
  if (!n.includes(ROOT_N)) return false;
  return ['\\runtime\\', '\\tools\\', '\\app\\', '\\node_modules\\', '/runtime/', '/tools/', '/app/', '/node_modules/', '\\data\\', '/data/']
    .some((seg) => n.includes(ROOT_N + seg));
}

function occupants(list) {
  const self = new Set([process.pid, process.ppid]);
  return list.filter((p) => {
    if (self.has(p.pid)) return false;
    if (SHELL_NAMES.has(String(p.name).toLowerCase())) return false;
    if (/release-usb\.mjs/i.test(p.cmd)) return false;
    return inPackage(p.cmd) || norm(p.exe).includes(ROOT_N);
  });
}

function tryKill(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch (_) { /* 已退出或无权限 */ }
}

function label(p) {
  const n = String(p.name || '?').toLowerCase();
  if (n === 'node.exe') {
    if (/anthropic-gw\.mjs/i.test(p.cmd)) return '模型网关';
    return '网页壳 / Node 服务';
  }
  if (n === 'claude.exe') return 'Claude Code';
  if (n === 'msedge.exe' || n === 'chrome.exe') return '本会话浏览器';
  return p.name || '未知进程';
}

/* ---- 主流程 ---- */
const all = listProcesses();
let before = occupants(all);
const deep = !process.argv.includes('--fast');
let byModule = deep ? listModuleHolders() : [];
const merge = (a, b) => {
  const seen = new Set(a.map((p) => p.pid));
  return a.concat(b.filter((p) => !seen.has(p.pid)));
};
before = merge(before, byModule);

if (CHECK_ONLY) {
  console.log(`[release-usb] 本包路径：${ROOT}`);
  console.log(`[release-usb] 已扫描 ${all.length} 个进程${deep ? `（含 ${byModule.length} 个「加载了本包文件」的进程）` : ''}。`);
  if (!all.length) console.log('[release-usb] [警告] 进程枚举没拿到任何结果，可能被安全策略拦了。');
  if (!before.length) console.log('[release-usb] U 盘上没有被本包占用的进程，可以直接安全弹出。');
  else {
    console.log('[release-usb] 仍在占用 U 盘的进程：');
    before.forEach((p) => console.log(`   PID ${String(p.pid).padStart(6)}  ${label(p)}`));
  }
  process.exit(0);
}

/* 1) 网关先按 pid 文件精确结束（最准） */
const gwPid = readPid(PID_FILE);
if (gwPid && alive(gwPid)) {
  tryKill(gwPid);
  console.log(`[release-usb] 已结束模型网关 (PID ${gwPid})`);
}

/* 2) 兜底：按根目录路径扫一遍所有残留进程 */
before.forEach((p) => {
  if (p.pid === gwPid) return;
  tryKill(p.pid);
  console.log(`[release-usb] 已结束 ${label(p)} (PID ${p.pid})`);
});

/* 3) 等系统真正回收句柄后再复查（浅扫 + 深扫），还有残留就再来一轮 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1200);
let after = occupants(listProcesses());
if (deep) after = merge(after, listModuleHolders());
if (after.length) {
  await wait(1500);
  after.forEach((p) => tryKill(p.pid));
  await wait(1200);
  after = occupants(listProcesses());
  if (deep) after = merge(after, listModuleHolders());
}

try { fs.rmSync(PID_FILE, { force: true }); } catch (_) {}
try { fs.rmSync(PORT_FILE, { force: true }); } catch (_) {}

if (!after.length) {
  console.log('[release-usb] 完成：共享已释放，现在可以安全弹出 U 盘了。');
} else {
  console.log('[release-usb] 仍有进程没结束（通常是杀毒软件拦住或需要手动关闭）：');
  after.forEach((p) => console.log(`   PID ${String(p.pid).padStart(6)}  ${label(p)}`));
  console.log('           请手动关闭上面的窗口/浏览器后重试，或在任务管理器里结束对应进程。');
  process.exitCode = 1;
}
/* 都没扫到占用、却依然弹不出来时，给出排查方向（这些是扫描看不到的持有者） */
console.log('');
console.log('[release-usb] 如果 Windows 仍提示「正在使用中」，逐条试：');
console.log('   1) 关掉打开着 U 盘目录的「资源管理器」窗口（资源管理器持有目录句柄，脚本不动它）；');
console.log('   2) 关掉 START.bat 那个黑窗（它的当前目录就在 U 盘上）；');
console.log('   3) 等 10 秒再试（U 盘的写入缓存需要回刷）；');
console.log('   4) 仍不行就注销/重启一次，或用「任务管理器 → 性能 → 打开资源监视器 → 磁盘」看谁在读 U 盘。');
