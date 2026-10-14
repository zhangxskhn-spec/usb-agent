/**
 * deploy-to-usb.mjs —— 推荐的上盘方式：U 盘上只留一个 runtime 文件，其余多线程同步
 *
 * 为什么要这样：整包 4.8 万个文件，其中 4.78 万个在 runtime\ 里。往 U 盘（尤其 FAT32）写这种
 * 「又多又碎」的东西是最慢的场景，压缩包也只是把慢挪到了解压那一步（治标）。
 * 这里换成「瘦身布局」：
 *   - U 盘上 runtime 只以 **runtime.zip + runtime.sha256** 两个文件存在（顺序写，与文件数无关）
 *   - 首次在目标机器启动时由 START.bat 调 tools\runtime-home.bat 展开到**本机磁盘**一次，
 *     之后每次启动直接复用（见 runtime-home.bat 的哈希缓存目录）
 *   - 运行时从本机 SSD 读，不走 U 盘，界面响应也更快
 * 代价：目标机器本机磁盘会留一份约 1.6 GB 的缓存；不想留就去控制面板手工删，
 *       或运行 tools\forget-runtime-cache.bat。
 *
 * 用法：
 *   node tools/deploy-to-usb.mjs E                 # 部署到 E:\<当前包名>
 *   node tools/deploy-to-usb.mjs "E:\U盘AI助手（usb-agent）"
 *   node tools/deploy-to-usb.mjs E --inline        # 老布局：runtime 目录也直接同步过去（4.8 万文件，慢）
 *   node tools/deploy-to-usb.mjs E --keep-runtime  # 保留目标机上已有的 runtime 目录（不删）
 *   node tools/deploy-to-usb.mjs E --skip-runtime  # 只同步程序文件与 data（改了代码后快速更新）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TAR, tarAvailable, zipDir, zipHasMembers } from './zip-util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const inline = process.argv.includes('--inline');
const keepRuntime = process.argv.includes('--keep-runtime');
const skipRuntime = process.argv.includes('--skip-runtime');

const rawTarget = args[0];
if (!rawTarget) {
  console.error('用法: node tools/deploy-to-usb.mjs <盘符或目标目录> [--inline] [--keep-runtime]');
  process.exit(1);
}
/* 只给盘符（如 E、E:、E:\）时，落到「盘根 + 当前包目录名」，和现有布局一致 */
const DEST = /^[A-Za-z]:?\\?$/.test(rawTarget.trim())
  ? path.join(rawTarget.replace(/[\\/:]+$/, '') + ':\\', path.basename(ROOT))
  : path.resolve(rawTarget);

if (!fs.existsSync(path.parse(DEST).root)) {
  console.error(`[deploy] 目标盘不存在：${path.parse(DEST).root}`);
  process.exit(1);
}
if (path.resolve(DEST).toLowerCase() === ROOT.toLowerCase()) {
  console.error('[deploy] 目标就是源目录，没必要同步。');
  process.exit(1);
}

const human = (n) => {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const walk = (dir) => {
  let files = 0; let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let list;
    try { list = fs.readdirSync(cur, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of list) {
      const p = path.join(cur, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else { files += 1; try { bytes += fs.statSync(p).size; } catch (_) {} }
    }
  }
  return { files, bytes };
};

const tar = TAR;
if (!inline && !tarAvailable()) {
  console.error('[deploy] 找不到系统 tar.exe（Win10 1803+ 才有）。可用 --inline 走老布局。');
  process.exit(1);
}

console.log(`[deploy] 源目录  ：${ROOT}`);
console.log(`[deploy] 目标目录：${DEST}`);
console.log(`[deploy] 模式    ：${inline ? '老布局（runtime 目录直接同步）' : '瘦身布局（runtime 只留一个 zip）'}`);
console.log('');

/* ---------- 1) 同步除 runtime / data 之外的所有文件 ---------- */
console.log('[deploy] 1/4 同步程序文件（多线程）...');
const rcArgs = [
  ROOT, DEST,
  '/MIR', '/MT:32', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
  '/XD', path.join(ROOT, 'data'), path.join(ROOT, '.git'),
  '/XF', 'runtime.zip', 'runtime.sha256',
];
if (!inline) rcArgs.push('/XD', path.join(ROOT, 'runtime'));
let rc = 0;
try { execFileSync('robocopy', rcArgs, { stdio: 'ignore', timeout: 60 * 60 * 1000, windowsHide: true }); }
catch (e) { rc = e.status == null ? 99 : e.status; }
if (rc >= 8) console.warn(`[deploy]      robocopy 返回 ${rc}（>=8 表示有文件没同步成功，可重跑）`);
else console.log(`[deploy]      程序文件已同步（robocopy ${rc}）`);

/* ---------- 2) 同步 data（只补新增，不覆盖不删除） ---------- */
console.log('[deploy] 2/4 同步 data（只补新增，不动目标机已有的新数据）...');
try {
  execFileSync('robocopy', [
    path.join(ROOT, 'data'), path.join(DEST, 'data'),
    '/E', '/XO', '/MT:32', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
    '/XD',
    path.join(ROOT, 'data', 'browser-profile'),
    path.join(ROOT, 'data', 'home', 'temp'),
    path.join(ROOT, 'data', 'home', '.npm-cache'),
    path.join(ROOT, 'data', 'home', 'AppData'),
    path.join(ROOT, 'data', 'home', 'logs'),
  ], { stdio: 'ignore', timeout: 60 * 60 * 1000, windowsHide: true });
} catch (_) { /* 0-7 都是正常 */ }
console.log('[deploy]      data 已处理');

/* ---------- 3) runtime：打包成单个 zip 放到目标机 ---------- */
if (skipRuntime) {
  console.log('[deploy] 3/4 --skip-runtime：不动 runtime（只同步了程序文件与 data）');
  const hasZip = fs.existsSync(path.join(DEST, 'runtime.zip'));
  const hasDir = fs.existsSync(path.join(DEST, 'runtime', 'node', 'node.exe'));
  if (!hasZip && !hasDir) console.warn('[deploy]      注意：目标机上既没有 runtime.zip 也没有 runtime\\ 目录，START.bat 会起不来。请跑一次不带 --skip-runtime 的部署。');
} else if (inline) {
  console.log('[deploy] 3/4 --inline：同步 runtime 目录（这一步很慢，取决于文件数）...');
  const rt = walk(path.join(ROOT, 'runtime'));
  console.log(`[deploy]      runtime 共 ${rt.files} 个文件 / ${human(rt.bytes)}`);
  try {
    execFileSync('robocopy', [
      path.join(ROOT, 'runtime'), path.join(DEST, 'runtime'),
      '/MIR', '/MT:32', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
    ], { stdio: 'inherit', timeout: 6 * 60 * 60 * 1000, windowsHide: true });
  } catch (_) {}
  try { fs.rmSync(path.join(DEST, 'runtime.zip'), { force: true }); } catch (_) {}
  try { fs.rmSync(path.join(DEST, 'runtime.sha256'), { force: true }); } catch (_) {}
  console.log('[deploy]      runtime 目录已同步，U 盘上不再是瘦身布局。');
} else {
  const rtZip = path.join(DEST, 'runtime.zip');
  console.log('[deploy] 3/4 打包 runtime（自己写 zip，直接顺序写入 U 盘上的单个文件）...');
  const t0 = Date.now();
  const packed = zipDir(path.join(ROOT, 'runtime'), rtZip);
  const zipSize = packed.size;
  if (!zipSize || !packed.files) {
    try { fs.rmSync(rtZip, { force: true }); } catch (_) {}
    console.error('[deploy] 打包失败：没有打包出任何文件。');
    process.exit(1);
  }
  /* 关键成员在不在？在的话基本可以放心，缺了就明确报错，别把半成品搬上 U 盘 */
  const chk = zipHasMembers(rtZip, ['node/node.exe', 'node/cloudcli.cmd', 'node/claude.cmd', 'git/bin/bash.exe', 'git/usr/bin/bash.exe']);
  if (!chk.ok) {
    try { fs.rmSync(rtZip, { force: true }); } catch (_) {}
    console.error('[deploy] 打包结果不完整，缺少：' + chk.missing.join('、'));
    process.exit(1);
  }
  if (packed.skipped.length) {
    console.warn('[deploy]      跳过（读不到的 reparse point，运行时用不到）：' + packed.skipped.join('、'));
  }
  console.log(`[deploy]      ${packed.files} 个文件 + ${packed.dirs} 个目录 → ${human(zipSize)}（原始 ${human(packed.rawBytes)}），用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const digest = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(rtZip)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
  fs.writeFileSync(path.join(DEST, 'runtime.sha256'), digest + '\r\n', 'utf8');
  console.log(`[deploy]      sha256 = ${digest.slice(0, 16)}...（写进 runtime.sha256，换机后缓存仍能命中）`);

  /* 目标机上旧的 runtime 目录（老布局）会让 START.bat 继续走就地模式，瘦身就白做了 */
  const destRuntime = path.join(DEST, 'runtime');
  if (fs.existsSync(destRuntime) && !keepRuntime) {
    console.log('[deploy]      目标机上有旧的 runtime\\ 目录（老布局），正在删除以免继续占 U 盘空间...');
    try {
      fs.rmSync(destRuntime, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      console.warn('[deploy]      删除报错：', e && e.message ? e.message : e);
    }
    console.log(fs.existsSync(destRuntime) ? '[deploy]      删除未完全成功（可能有文件被占用），请关掉占用程序后重跑。' : '[deploy]      旧 runtime\\ 已删除');
  } else if (fs.existsSync(destRuntime)) {
    console.log('[deploy]      --keep-runtime：保留了旧的 runtime\\ 目录（START.bat 会优先用它，瘦身不生效）');
  }
}

/* ---------- 4) 统计 ---------- */
console.log('[deploy] 4/4 统计目标目录...');
const st = walk(DEST);
console.log('');
console.log(`[deploy] 完成：${DEST}`);
console.log(`[deploy] 现在共 ${st.files} 个文件 / ${human(st.bytes)}`);
if (!inline && !skipRuntime) console.log('[deploy] 提示：首次在目标机器上双击 START.bat 时会展开 runtime 到本机磁盘（约 1~3 分钟，只做一次）。');
