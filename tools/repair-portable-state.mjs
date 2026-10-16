/**
 * Repair state copied between computers or drive letters.
 *
 * CloudCLI stores transcript paths and trust records as absolute paths. The
 * portable launcher changes HOME to data/home, so those paths must be rebased
 * before the server starts. This migration is intentionally idempotent and
 * only rewrites paths when the target file can be found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.join(ROOT, 'data', 'home');
const CLAUDE_HOME = path.join(HOME, '.claude');
const DB_PATH = path.join(HOME, '.cloudcli', 'auth.db');
const WORKSPACE_ROOT = path.join(ROOT, 'workspace');
const PACKAGE_NAME = path.basename(ROOT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quiet = process.argv.includes('--quiet');
const checkOnly = process.argv.includes('--check');

function log(...args) {
  if (!quiet) console.log('[portable-state]', ...args);
}

function normalizeForCompare(value) {
  return path.normalize(String(value || '').replace(/[\\/]+/g, path.sep)).toLowerCase();
}

function samePath(a, b) {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function walkJsonl(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'subagents') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(fullPath, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) out.push(fullPath);
  }
  return out;
}

function buildTranscriptIndex() {
  const byId = new Map();
  for (const filePath of walkJsonl(path.join(CLAUDE_HOME, 'projects'))) {
    const stem = path.basename(filePath, '.jsonl').toLowerCase();
    if (!byId.has(stem)) byId.set(stem, filePath);
    try {
      const firstLine = fs.readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0];
      const parsed = JSON.parse(firstLine);
      const sessionId = String(parsed.sessionId || parsed.session_id || '').trim().toLowerCase();
      if (sessionId && !byId.has(sessionId)) byId.set(sessionId, filePath);
    } catch {
      // A partial transcript is still indexed by its filename.
    }
  }
  return byId;
}

function rebaseTranscriptPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (!raw) return null;
  const portableMarker = raw.replace(/\\/g, '/').match(/(?:^|\/)\.claude\/projects\/(.+)$/i);
  if (!portableMarker) return null;
  const relative = portableMarker[1].split('/').filter(Boolean);
  if (!relative.length) return null;
  const candidate = path.join(CLAUDE_HOME, 'projects', ...relative);
  return exists(candidate) ? candidate : null;
}

/**
 * Collects the package roots this state file was ever produced under.
 *
 * Any project path ending in `…/data/home` was written while some copy of this
 * package was running: `data/home` is its portable HOME by construction, so the
 * segment before it *is* a package root. The same holds for
 * `…/<current folder name>/workspace`. Recording those roots lets a project
 * created inside the package (or on the package folder itself) follow the
 * package to its new path, even after the folder was renamed or the drive
 * letter changed.
 */
function collectStalePackageRoots(db) {
  const roots = new Map();
  const consider = (rawPath) => {
    const slashPath = String(rawPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!slashPath || slashPath.startsWith('@')) return;
    const found = [];
    const homeMatch = slashPath.match(/^(.+)\/data\/home(?:\/.*)?$/i);
    if (homeMatch) found.push(homeMatch[1]);
    const workspaceMatch = slashPath.match(new RegExp('^(.+)\\/' + PACKAGE_NAME + '\\/workspace(?:\\/.*)?$', 'i'));
    if (workspaceMatch) found.push(workspaceMatch[1]);
    for (const candidate of found) {
      const key = normalizeForCompare(candidate);
      if (key && !roots.has(key)) roots.set(key, candidate.split('/').join(path.sep));
    }
  };
  for (const row of db.prepare('SELECT project_path FROM projects').all()) consider(row.project_path);
  for (const row of db.prepare('SELECT DISTINCT project_path FROM sessions WHERE project_path IS NOT NULL').all()) consider(row.project_path);
  for (const key of Object.keys(readClaudeTrustProjects())) consider(key);
  return roots;
}

function isInside(childPath, parentDir) {
  const child = normalizeForCompare(childPath);
  const parent = normalizeForCompare(parentDir);
  if (!child || !parent) return false;
  return child === parent || child.startsWith(parent + path.sep);
}

/**
 * Whether a path is really "inside the package" — this package's own HOME
 * (`data/home`) or web shell (`app/webui`), or anywhere below a previous copy
 * of the package (another folder name, computer, or drive letter).
 *
 * CloudCLI treats every in-package path as a pseudo project: `wbIsPlainProjectPath`
 * in the server patch classifies them as plain conversations, and the sidebar
 * hides them from the project list. A path that satisfied that test while the
 * package lived elsewhere stops matching once the package moves, which is how a
 * pseudo project suddenly reappears as a real — but broken — project card.
 *
 * A stale path is only claimed as ours when it is already gone, so an unrelated
 * project that merely happens to be missing is left alone for the user to tidy.
 */
function isPackageOwnedPath(rawPath, roots) {
  const raw = String(rawPath || '').trim();
  if (!raw) return false;
  if (isInside(raw, HOME) || isInside(raw, path.join(ROOT, 'app', 'webui'))) return true;
  if (dirExists(raw)) return false;

  const slashPath = raw.replace(/\\/g, '/').toLowerCase();
  for (const key of roots.keys()) {
    if (!key) continue;
    const prefix = key.replace(/\\/g, '/');
    if (slashPath === prefix || slashPath.startsWith(prefix + '/')) return true;
  }
  return false;
}

function mapPortableProjectPath(rawPath, roots) {
  const raw = String(rawPath || '').trim();
  if (!raw || raw === '@plain') return raw;
  if (samePath(raw, WORKSPACE_ROOT)) return '@plain';
  // 包内部路径（本包 data/home、app/webui，或旧包根下的任何位置）按设计不是项目：
  // 并回便携哨兵 '@plain'，会话变成「普通对话」，cwd 由服务端解析到 workspace。
  if (isPackageOwnedPath(raw, roots)) return '@plain';

  // Projects below this package workspace survive a drive-letter change.
  const slashPath = raw.replace(/\\/g, '/');
  const match = slashPath.match(new RegExp('(?:^|\\/)' + PACKAGE_NAME + '\\/workspace(?:\\/(.*))?$', 'i'));
  if (!match) return raw;
  const relative = match[1] ? match[1].split('/').filter(Boolean) : [];
  return relative.length ? path.join(WORKSPACE_ROOT, ...relative) : '@plain';
}

function mapTrustPath(rawPath, roots) {
  const mapped = mapPortableProjectPath(rawPath, roots);
  return mapped === '@plain' ? WORKSPACE_ROOT : mapped;
}

function updateProjectPaths(db, roots) {
  const projectRows = db.prepare('SELECT project_path FROM projects').all();
  const sessionRows = db.prepare('SELECT DISTINCT project_path FROM sessions WHERE project_path IS NOT NULL').all();
  const mappings = new Map();
  for (const row of [...projectRows, ...sessionRows]) {
    const oldPath = String(row.project_path || '');
    const nextPath = mapPortableProjectPath(oldPath, roots);
    if (nextPath && nextPath !== oldPath) mappings.set(oldPath, nextPath);
  }

  let changed = 0;
  for (const [oldPath, nextPath] of mappings) {
    const targetExists = Boolean(db.prepare('SELECT 1 FROM projects WHERE project_path = ?').get(nextPath));
    if (targetExists) {
      db.prepare('UPDATE sessions SET project_path = ? WHERE project_path = ?').run(nextPath, oldPath);
      db.prepare('DELETE FROM projects WHERE project_path = ?').run(oldPath);
    } else {
      db.prepare('UPDATE projects SET project_path = ? WHERE project_path = ?').run(nextPath, oldPath);
      db.prepare('UPDATE sessions SET project_path = ? WHERE project_path = ?').run(nextPath, oldPath);
    }
    changed += 1;
  }
  return changed;
}

function updateTranscriptPaths(db, index) {
  const rows = db.prepare('SELECT session_id, provider_session_id, jsonl_path FROM sessions WHERE jsonl_path IS NOT NULL').all();
  const updates = [];
  for (const row of rows) {
    const oldPath = String(row.jsonl_path || '');
    let nextPath = rebaseTranscriptPath(oldPath);
    if (!nextPath) {
      const keys = [row.provider_session_id, row.session_id].filter(Boolean).map((value) => String(value).toLowerCase());
      nextPath = keys.map((key) => index.get(key)).find(Boolean) || null;
    }
    if (nextPath && !samePath(oldPath, nextPath)) updates.push({ sessionId: row.session_id, nextPath });
  }
  const update = db.prepare('UPDATE sessions SET jsonl_path = ? WHERE session_id = ?');
  for (const item of updates) update.run(item.nextPath, item.sessionId);
  return updates;
}

function readClaudeTrustFile() {
  const filePath = path.join(HOME, '.claude.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function readClaudeTrustProjects() {
  const data = readClaudeTrustFile();
  return data && data.projects && typeof data.projects === 'object' ? data.projects : {};
}

/** Project rows whose folder is gone: every chat in them fails at launch. */
function listBrokenProjects(db) {
  return db
    .prepare("SELECT project_path, custom_project_name FROM projects WHERE project_path <> '@plain'")
    .all()
    .filter((row) => !dirExists(row.project_path))
    .map((row) => ({
      path: String(row.project_path),
      name: row.custom_project_name && String(row.custom_project_name).trim()
        ? String(row.custom_project_name).trim()
        : path.basename(String(row.project_path)) || String(row.project_path),
    }));
}

function reportBrokenProjects(broken, label) {
  if (!broken.length || quiet) return;
  log(`${label} ${broken.length} 个项目文件夹不存在，该项目里的对话一发送就会失败：`);
  for (const item of broken.slice(0, 10)) {
    console.log(`      - ${item.name}  →  ${item.path}`);
  }
  console.log('        处理办法：侧栏项目行 ⋯ →「移除项目」，或重新为现有文件夹建一个项目。');
}

/**
 * 写入 Claude Code 的 settings.json（网关模型别名 + 中文状态行）。
 *
 * ① modelPicker：Claude Code 只认识官方模型名，mimo-* / deepseek-* 会让它每次启动
 *    在欢迎界面之上刷 7 行 unknown-model 警告，模型名也只能显示原始 id。modelPicker
 *    是官方支持的声明方式：声明后警告消失、/model 下拉显示友好名称与中文说明，
 *    behavesAs 让它按 Sonnet 的能力与上下文窗口处理（网关就是 Anthropic 兼容端点）。
 *    具体哪 4 个模型见下面的 MODELS（都逐个实测过上游可用）。
 *    `replaceBuiltInOptions: true` 是关键：官方说明是「只留 Default 一行 + 这些 options，
 *    内置的 Claude 阵容、网关发现的模型、ANTHROPIC_CUSTOM_MODEL_OPTION 全部隐藏」。
 *    不加它的话，/model 里会混进用不了的 Claude 模型（网关根本不提供），以及
 *    START.bat 为映射 Opus/Sonnet/Haiku 三档而设的 ANTHROPIC_DEFAULT_*_MODEL
 *    带来的三行重复「Custom ··· model」，看着很乱。
 * ② statusLine：输入框上方常驻一行中文速查（当前模型 / 换模型 / 换模式 / 退出）+ 一行
 *    模式中英对照，解决「不知道怎么用」。命令里写的是 node.exe 与脚本的绝对路径——实测
 *    状态行命令走的是 sh 而不是 cmd，`%VAR%` 不会展开，所以只能用绝对路径；而它是每台
 *    机器启动时现算的，换盘符/换机器都会自动更新。运行时目录取自 USBAI_RUNTIME
 *    （瘦身布局下它指向本机展开缓存，不是包内 runtime）。
 * ③ 权限模式默认 auto：`permissions.defaultMode = "auto"`。默认的 manual 每改一个文件
 *    都要按确认，用户「感觉卡住了」多半就是这个。
 *
 * 幂等：内容一致时一个字节都不写；用户手改坏了则原样保留不动。
 */
/* /model 里显示哪几个模型。
 *
 * 就是网关真正能路由、且上游认账的那 4 个——2026-10-16 逐个发真实请求实测：
 *   mimo-v2.6-pro ✅  mimo-v2.6-flash ✅  deepseek-flash ✅  deepseek-v4-pro ✅
 *   deepseek-v4.1-flash ❌ DeepSeek 端点 400：「The supported API model names are
 *                        deepseek-flash, deepseek-v4-pro」——它的现役 id 就是 deepseek-flash。
 * 顺序与网页端下拉一致（claude-models.provider.js 的 CLAUDE_PREDEFINED_MODELS）。
 */
const MODELS = [
  ['mimo-v2.6-pro', 'MiMo V2.6 Pro', '小米 MiMo · 复杂推理，慢一些'],
  ['mimo-v2.6-flash', 'MiMo V2.6 Flash', '小米 MiMo · 响应最快，日常问答、写文案'],
  ['deepseek-flash', 'DeepSeek V4.1 Flash', 'DeepSeek · 现役主力，代码、长文'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', 'DeepSeek · 更强推理，稍慢'],
];

function modelPickerRows() {
  const rows = MODELS.map(([model, label, description]) => ({
    model,
    label,
    behavesAs: 'claude-sonnet-4-5',
    description,
  }));
  // keys.env 里若配了这 4 个之外的模型（自定义场景），补在最后，别把它藏起来。
  for (const prefix of ['MIMO', 'DEEPSEEK']) {
    const id = String(process.env[`${prefix}_MODEL`] || '').replace('[1m]', '').trim();
    if (!id || rows.some((row) => row.model === id)) continue;
    rows.push({ model: id, label: id, behavesAs: 'claude-sonnet-4-5' });
  }
  return rows;
}

function statuslineCommand() {
  const runtime = process.env.USBAI_RUNTIME || path.join(ROOT, 'runtime');
  const nodeExe = path.join(runtime, 'node', 'node.exe');
  const script = path.join(ROOT, 'tools', 'cli-statusline.mjs');
  return `"${nodeExe}" "${script}"`;
}

function ensureClaudeSettings() {
  const file = path.join(CLAUDE_HOME, 'settings.json');
  let data = {};
  if (exists(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      return false; // 用户手改坏了，别覆盖
    }
  }
  const want = {
    // 只留 Default + 下面这几行，隐藏内置 Claude 阵容与三档 Custom 重复行
    modelPicker: { replaceBuiltInOptions: true, options: modelPickerRows() },
    statusLine: { type: 'command', command: statuslineCommand() },
  };
  let changed = false;
  for (const [key, value] of Object.entries(want)) {
    if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
    data[key] = value;
    changed = true;
  }
  // 默认用 acceptEdits（接受编辑）：**不能**用 auto。
  //   · 默认的 manual 每改一个文件都要按一次确认，用户「感觉卡住了」多半就是这个；
  //   · auto 理论上最合适，但实测在这套环境下**永远不可用**——官方底部直接提示
  //     `auto mode unavailable for this model`，即使把模型名换成 claude-sonnet-4-5
  //     也一样（auto 要靠官方的模型分类器，网关不是真 Anthropic 端点，拿不到这个能力）；
  //   · 只剩 acceptEdits 是「不再逐条问」里最稳的：改文件直接落盘，跑命令仍会问你。
  // 官方 settings 键是 permissions.defaultMode；只认用户级设置——我们写的正是
  // $CLAUDE_CONFIG_DIR/settings.json（二进制原文：repo-level settings cannot grant
  // `defaultMode: auto`）。留出其它 permissions 子键不动（allow/deny 规则等）。
  const permissions = { ...(data.permissions || {}) };
  if (permissions.defaultMode !== 'acceptEdits') {
    permissions.defaultMode = 'acceptEdits';
    data.permissions = permissions;
    changed = true;
  }
  if (!changed) return false;
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * 预置「已信任本工作区」，让 Claude Code 不再弹英文的信任确认。
 *
 * 启动时那个 > No, exit / Yes, I trust this folder 的二叉框就是它：Claude Code 要求
 * 用户确认「这个文件夹是你自己的吗」才允许读写。官方给出的免弹方式（二进制里的原文）
 * 就是写 `projects[<路径>].hasTrustDialogAccepted: true`。键是正斜杠规范化路径；在 git
 * 仓库里 Claude Code 认的是仓库根，所以仓库根与 workspace 两个都写。
 * 只针对本包自己的目录，不碰用户其它项目。
 * 附带的 hasCompletedOnboarding / hasSeenAutoDefaultNotice 只为「开箱即用」：
 * 省掉首次的英文引导向导和那一大段 Auto mode 说明。
 */
function trustKeys() {
  return [ROOT, WORKSPACE_ROOT].map((p) => String(p).replace(/\\/g, '/').replace(/\/+$/, ''));
}

function ensureWorkspaceTrust() {
  const files = [path.join(CLAUDE_HOME, '.claude.json'), path.join(HOME, '.claude.json')];
  let changed = false;
  for (const file of files) {
    let data = null;
    if (exists(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      } catch {
        continue; // 解析不了就别动
      }
    }
    const fresh = data === null;
    data = data || { hasCompletedOnboarding: true, hasSeenAutoDefaultNotice: true };
    const projects = { ...(data.projects || {}) };
    let local = false;
    for (const key of trustKeys()) {
      if (projects[key] && projects[key].hasTrustDialogAccepted === true) continue;
      projects[key] = { ...(projects[key] || {}), hasTrustDialogAccepted: true };
      local = true;
    }
    if (!local && !fresh) continue;
    data.projects = projects;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      changed = true;
    } catch {
      /* 写不了就算了，最多再弹一次确认框 */
    }
  }
  return changed;
}

function repairClaudeTrustFile(roots) {
  const filePath = path.join(HOME, '.claude.json');
  const data = readClaudeTrustFile();
  if (!data) return false;
  if (!data.projects || typeof data.projects !== 'object') return false;
  let changed = false;
  const nextProjects = {};
  for (const [projectPath, settings] of Object.entries(data.projects)) {
    const nextPath = mapTrustPath(projectPath, roots);
    nextProjects[nextPath || projectPath] = settings;
    changed ||= nextPath !== projectPath;
  }
  if (!changed) return false;
  data.projects = nextProjects;
  fs.copyFileSync(filePath, `${filePath}.bak-portable`);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return true;
}

function main() {
  // 与数据库无关，先做：保证 Claude Code 开箱即用、欢迎界面不被警告刷屏。
  if (!checkOnly) {
    if (ensureWorkspaceTrust()) log('已预置工作区信任（Claude Code 不再弹英文的信任确认）');
    if (ensureClaudeSettings()) log('已写入 Claude Code 设置（模型别名 + 中文状态行）');
  }
  if (!fs.existsSync(DB_PATH)) {
    log('数据库不存在，跳过');
    return;
  }
  const require = createRequire(import.meta.url);
  const Database = require(path.join(ROOT, 'runtime', 'node', 'node_modules', '@cloudcli-ai', 'cloudcli', 'node_modules', 'better-sqlite3'));
  const db = new Database(DB_PATH, { timeout: 5000 });
  try {
    const index = buildTranscriptIndex();
    const roots = collectStalePackageRoots(db);
    const total = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE jsonl_path IS NOT NULL').get().count;
    if (checkOnly) {
      const missing = db.prepare('SELECT jsonl_path FROM sessions WHERE jsonl_path IS NOT NULL').all().filter((row) => !exists(row.jsonl_path)).length;
      const externalProjects = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE project_path <> '@plain'").get().count;
      const broken = listBrokenProjects(db);
      log(`transcripts=${total}, missing=${missing}, external-projects=${externalProjects}, indexed=${index.size}, stale-roots=${roots.size}, missing-project-dirs=${broken.length}`);
      reportBrokenProjects(broken, '发现');
      return;
    }
    const result = db.transaction(() => ({
      projects: updateProjectPaths(db, roots),
      transcripts: updateTranscriptPaths(db, index),
    }))();
    const trustChanged = repairClaudeTrustFile(roots);
    if (result.projects || result.transcripts.length || trustChanged) {
      log(`已修复：项目 ${result.projects} 条，transcript ${result.transcripts.length} 条，信任路径 ${trustChanged ? '1' : '0'} 条`);
    }
    // 修不了的（真的被删掉的外部项目）要显式报出来：这种项目里发消息必然失败，
    // 而 Claude Code 的报错是「native binary … failed to launch」，完全指不到路径。
    reportBrokenProjects(listBrokenProjects(db), '⚠ 仍有');
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.warn('[portable-state] 修复失败，继续启动：', error?.message || error);
  process.exitCode = 0;
}
