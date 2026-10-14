/**
 * zip-util.mjs —— 自己写的 zip 打包器（Node 版），以及读 zip 的辅助函数
 *
 * 为什么不用 Windows 自带的 tar.exe 打包（踩过的坑，两个都是致命的）：
 *   1) 便携 Git 里的 `git/etc/mtab` 是 Git for Windows 造的 junction 型 reparse point
 *      （目标写成 POSIX 路径 /proc/mounts），libarchive 对它 stat 报 EINVAL，
 *      整次打包直接以失败退出；用 --exclude 也未必拦得住（路径前缀规则不一致）。
 *   2) **更严重**：从祖先目录递归打包时，bsdtar 会静默丢掉 `git/bin/*`（bash.exe、git.exe、
 *      sh.exe）—— 目录项在、文件不在、一个字的报错都没有。缺了 bash.exe，
 *      Claude Code 的 Bash 工具直接就废了，而且你要在目标机上才会发现。
 * 所以打包端自己来：用 fs 遍历（reparse point / 硬链接都能正常读），逐个文件 deflateRaw，
 * 手写 zip 结构。解压端仍然用系统 tar.exe（它读标准 zip 没问题，读也不会丢文件）。
 *
 * 兼容性：zip64 不需要（本包 < 4GB，单文件 < 4GB）。文件名用 UTF-8（通用位 11）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

export const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

export function tarAvailable() {
  return fs.existsSync(TAR);
}

/* ---------------- CRC32 ---------------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const year = d.getFullYear() < 1980 ? 1980 : d.getFullYear();
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  const date = (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/* ---------------- 遍历 ---------------- */
function walkTree(srcDir, excludes) {
  const entries = [];
  const skipped = [];
  const ex = excludes.map((e) => e.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''));
  const isExcluded = (rel) => ex.some((e) => rel === e || rel.startsWith(e + '/'));
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(srcDir, rel) : srcDir;
    let list;
    try { list = fs.readdirSync(abs, { withFileTypes: true }); }
    catch (e) { skipped.push(`${rel} (readdir ${e.code})`); continue; }
    if (rel) entries.push({ rel, dir: true, size: 0, mtime: Date.now() });
    for (const ent of list) {
      const childRel = rel ? rel + '/' + ent.name : ent.name;
      if (isExcluded(childRel)) { skipped.push(childRel + ' (excluded)'); continue; }
      const childAbs = path.join(srcDir, path.join(...childRel.split('/')));
      let st;
      try { st = fs.statSync(childAbs); }
      catch (e) { skipped.push(`${childRel} (stat ${e.code})`); continue; }
      if (st.isDirectory()) stack.push(childRel);
      else entries.push({ rel: childRel, dir: false, size: st.size, mtime: st.mtimeMs });
    }
  }
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { entries, skipped };
}

/* ---------------- 打包 ---------------- */
/**
 * 把 srcDir 的内容打进 outZip。成员名前缀可选（如 'runtime/'）。
 * @returns {{files:number, dirs:number, rawBytes:number, size:number, skipped:string[]}}
 */
export function zipDir(srcDir, outZip, options = {}) {
  const store = !!options.store;
  let prefix = String(options.prefix || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  if (prefix) prefix += '/';
  const { entries, skipped } = walkTree(srcDir, options.excludes || []);

  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  const fd = fs.openSync(outZip, 'w');
  const central = [];
  let offset = 0;
  let files = 0;
  let dirs = 0;
  let rawBytes = 0;
  const writeAt = (buf) => { fs.writeSync(fd, buf, 0, buf.length); offset += buf.length; };

  try {
    for (const e of entries) {
      const name = prefix + e.rel + (e.dir ? '/' : '');
      const nameBuf = Buffer.from(name, 'utf8');
      const { time, date } = dosDateTime(e.mtime);
      let stored = Buffer.alloc(0);
      let method = 0;
      let crc = 0;
      if (!e.dir) {
        let raw;
        try {
          raw = fs.readFileSync(path.join(srcDir, path.join(...e.rel.split('/'))));
        } catch (err) {
          skipped.push(`${e.rel} (read ${err.code})`);
          continue;
        }
        rawBytes += raw.length;
        crc = crc32(raw);
        if (store || !raw.length) { stored = raw; method = 0; }
        else { stored = zlib.deflateRawSync(raw, { level: 6 }); method = 8; }
        void raw;
      }
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x0800, 6);           /* 位 11：文件名为 UTF-8 */
      head.writeUInt16LE(method, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(date, 12);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(stored.length, 18);
      head.writeUInt32LE(e.size, 22);
      head.writeUInt16LE(nameBuf.length, 26);
      head.writeUInt16LE(0, 28);
      const localOffset = offset;
      writeAt(head);
      writeAt(nameBuf);
      if (stored.length) writeAt(stored);

      central.push({ nameBuf, method, time, date, crc, comp: stored.length, uncomp: e.size, localOffset, dir: e.dir });
      if (e.dir) dirs += 1; else files += 1;
    }

    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(c.time, 12);
      h.writeUInt16LE(c.date, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.comp, 20);
      h.writeUInt32LE(c.uncomp, 24);
      h.writeUInt16LE(c.nameBuf.length, 28);
      h.writeUInt16LE(0, 30);
      h.writeUInt16LE(0, 32);
      h.writeUInt16LE(0, 34);
      h.writeUInt16LE(0, 36);
      h.writeUInt32LE((c.dir ? 0x10 : 0x20) << 16 >>> 0, 38);
      h.writeUInt32LE(c.localOffset, 42);
      writeAt(h);
      writeAt(c.nameBuf);
    }
    const cdSize = offset - cdStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    writeAt(eocd);
  } finally {
    fs.closeSync(fd);
  }

  return { files, dirs, rawBytes, size: offset, skipped };
}

/** 列出 zip 成员（去掉尾斜杠），解压端是 tar.exe，读标准 zip 没问题 */
export function listZip(zipPath) {
  const out = execFileSync(TAR, ['-tf', zipPath], { encoding: 'utf8', timeout: 30 * 60 * 1000, windowsHide: true, maxBuffer: 512 * 1024 * 1024 });
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^\.\//, '').replace(/\/$/, ''));
}

/** 校验 zip 里确实有这些关键成员（成员名按去掉 ./ 与尾斜杠后比较） */
export function zipHasMembers(zipPath, members) {
  let list;
  try { list = listZip(zipPath); } catch (_) { return { ok: false, missing: members }; }
  const norm = (s) => s.replace(/^\.\//, '').replace(/\/+$/, '');
  const set = new Set(list.map(norm));
  const missing = members.filter((m) => !set.has(norm(m)));
  return { ok: missing.length === 0, missing };
}
