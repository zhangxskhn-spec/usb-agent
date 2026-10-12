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

function mapPortableProjectPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (!raw || raw === '@plain') return raw;
  if (samePath(raw, WORKSPACE_ROOT)) return '@plain';

  // Projects below this package workspace survive a drive-letter change.
  const slashPath = raw.replace(/\\/g, '/');
  const match = slashPath.match(new RegExp('(?:^|\\/)' + PACKAGE_NAME + '\\/workspace(?:\\/(.*))?$', 'i'));
  if (!match) return raw;
  const relative = match[1] ? match[1].split('/').filter(Boolean) : [];
  return relative.length ? path.join(WORKSPACE_ROOT, ...relative) : '@plain';
}

function mapTrustPath(rawPath) {
  const mapped = mapPortableProjectPath(rawPath);
  return mapped === '@plain' ? WORKSPACE_ROOT : mapped;
}

function updateProjectPaths(db) {
  const projectRows = db.prepare('SELECT project_path FROM projects').all();
  const sessionRows = db.prepare('SELECT DISTINCT project_path FROM sessions WHERE project_path IS NOT NULL').all();
  const mappings = new Map();
  for (const row of [...projectRows, ...sessionRows]) {
    const oldPath = String(row.project_path || '');
    const nextPath = mapPortableProjectPath(oldPath);
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

function repairClaudeTrustFile() {
  const filePath = path.join(HOME, '.claude.json');
  if (!fs.existsSync(filePath)) return false;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
  if (!data.projects || typeof data.projects !== 'object') return false;
  let changed = false;
  const nextProjects = {};
  for (const [projectPath, settings] of Object.entries(data.projects)) {
    const nextPath = mapTrustPath(projectPath);
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
  if (!fs.existsSync(DB_PATH)) {
    log('数据库不存在，跳过');
    return;
  }
  const require = createRequire(import.meta.url);
  const Database = require(path.join(ROOT, 'runtime', 'node', 'node_modules', '@cloudcli-ai', 'cloudcli', 'node_modules', 'better-sqlite3'));
  const db = new Database(DB_PATH, { timeout: 5000 });
  try {
    const index = buildTranscriptIndex();
    const total = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE jsonl_path IS NOT NULL').get().count;
    if (checkOnly) {
      const missing = db.prepare('SELECT jsonl_path FROM sessions WHERE jsonl_path IS NOT NULL').all().filter((row) => !exists(row.jsonl_path)).length;
      const externalProjects = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE project_path <> '@plain'").get().count;
      log(`transcripts=${total}, missing=${missing}, external-projects=${externalProjects}, indexed=${index.size}`);
      return;
    }
    const result = db.transaction(() => ({
      projects: updateProjectPaths(db),
      transcripts: updateTranscriptPaths(db, index),
    }))();
    const trustChanged = repairClaudeTrustFile();
    if (result.projects || result.transcripts.length || trustChanged) {
      log(`已修复：项目 ${result.projects} 条，transcript ${result.transcripts.length} 条，信任路径 ${trustChanged ? '1' : '0'} 条`);
    }
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
