/**
 * pack-for-usb.mjs —— 把「碎小文件」打成一个压缩包，专门解决拷 U 盘慢的问题
 *
 * 为什么：整包有 4.8 万多个小文件（多半是 runtime\node\node_modules）。往 U 盘传时，
 * 每个文件都要单独开/写/关一次并更新目录项，U 盘（尤其 exFAT/FAT32）在这上面极慢，
 * 常常几十分钟还卡住。打成一个文件后，U 盘只需要写「一个大文件」，通常能快好几倍。
 *
 * 用法（在包根目录执行，或双击 pack-for-usb.bat）：
 *   node tools/pack-for-usb.mjs                 # 打全包（排除数据缓存）-> usb-agent-pack.zip
 *   node tools/pack-for-usb.mjs --runtime       # 只打 runtime      -> usb-agent-runtime.zip
 *   node tools/pack-for-usb.mjs --fast          # 不压缩，打包最快（U 盘要多拷一些字节）
 *   node tools/pack-for-usb.mjs -o D:\xx.zip    # 指定输出位置
 *
 * 打包用 Windows 自带的 tar.exe（Win10 1803+ 都有，走 libarchive，不额外装软件）。
 * 打完之后：把 zip 拷到 U 盘，再在 U 盘上运行 tools\unpack-on-usb.bat 解开即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TAR, tarAvailable, zipDir } from './zip-util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const runtimeOnly = args.includes('--runtime');
const fast = args.includes('--fast');   /* 不压缩：打包更快、U 盘要多拷一些字节 */
const outIdx = args.findIndex((a) => a === '-o' || a === '--out');
const OUT = outIdx >= 0 && args[outIdx + 1]
  ? path.resolve(args[outIdx + 1])
  : path.join(path.dirname(ROOT), runtimeOnly ? 'usb-agent-runtime.zip' : 'usb-agent-pack.zip');

/* 体积大又能在目标机重建的目录，一律不进包（换台电脑第一次启动会自己长出来） */
const EXCLUDES = [
  'data/browser-profile',
  'data/home/temp',
  'data/home/.npm-cache',
  'data/home/AppData',
  'data/home/logs',
  '.git',
];

/* 统计文件数（只用于给用户一个「多少碎文件」的直觉）。
   跳过符号链接/目录联接，并对深度设上限，避免撞上 junction 环路把统计跑成死循环。 */
function countFiles(target, state, depth) {
  state = state || { files: 0, bytes: 0 };
  depth = depth || 0;
  if (depth > 40) return state;
  let entries;
  try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch (_) { return state; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(target, e.name);
    if (e.isDirectory()) {
      if (EXCLUDES.some((x) => normSlashes(p).endsWith('/' + x.replace(/\//g, '/')))) continue;
      countFiles(p, state, depth + 1);
    } else {
      state.files += 1;
      try { state.bytes += fs.statSync(p).size; } catch (_) {}
    }
  }
  return state;
}

function normSlashes(p) { return String(p).replace(/\\/g, '/'); }

const human = (n) => {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

const tar = TAR;
if (!tarAvailable()) {
  console.error('[pack] 找不到打包工具：需要 Windows 自带的 %SystemRoot%\\System32\\tar.exe（Win10 1803+）。');
  process.exit(1);
}

const targets = runtimeOnly ? ['runtime'] : ['.'];
console.log(`[pack] 打包工具：${tar}`);
console.log(`[pack] 源目录  ：${ROOT}`);
console.log(`[pack] 输出文件：${OUT}`);

const t0 = Date.now();
console.log('[pack] 正在统计文件数（4 万多个小文件，稍等一下）...');
for (const t of targets) {
  const st = countFiles(path.join(ROOT, t === '.' ? '.' : t));
  console.log(`[pack] ${t === '.' ? '整包' : t}：${st.files} 个文件 / ${human(st.bytes)}`);
}

try {
  const packed = zipDir(ROOT, OUT, {
    store: fast,
    excludes: runtimeOnly ? [] : EXCLUDES,
    prefix: runtimeOnly ? 'runtime' : '',
  });
  if (!packed.files) {
    try { fs.rmSync(OUT, { force: true }); } catch (_) {}
    console.error('[pack] 打包失败：没有打包出任何文件。');
    process.exit(1);
  }
  if (packed.skipped.length) {
    console.warn('[pack] 跳过（读不到的 reparse point，运行时用不到）：' + packed.skipped.join('、'));
  }
  console.log(`[pack] ${packed.files} 个文件 + ${packed.dirs} 个目录`);
} catch (e) {
  console.error('[pack] 打包失败：', e && e.message ? e.message : e);
  process.exit(1);
}

const zipped = fs.statSync(OUT).size;
console.log('');
console.log(`[pack] 完成，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
console.log(`[pack] 单个文件 ${human(zipped)} —— 拷到 U 盘只需搬这一个文件。`);
console.log('[pack] 下一步：把 zip 拷进 U 盘，然后在 U 盘上双击 tools\\unpack-on-usb.bat 解开。');
