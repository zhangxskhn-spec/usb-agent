/**
 * usb-agent 模型网关（MiMo + DeepSeek 自动路由）
 * - 默认从 http://127.0.0.1:4567 起监听；启动器会在端口冲突时通过 GW_PORT 改用空闲端口
 * - mimo-*  → https://api.xiaomimimo.com/anthropic （MIMO_API_KEY）
 * - 其他    → https://api.deepseek.com/anthropic （DEEPSEEK_API_KEY）
 * - 支持流式（SSE）透传；keys.env 每 30 秒热重载
 * - model 为空/default/sonnet/opus/haiku 时使用 DEEPSEEK_MODEL
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.GW_PORT || 4567);
// 本机令牌：START.bat 在启动网关前注入 ANTHROPIC_AUTH_TOKEN，
// Claude Code / CloudCLI 请求都带它。设置了就强制校验，挡住本机其他程序的蹭用。
const GW_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || '';

/* 网关与启动器共享同一个控制台（这样关掉黑窗它就会被系统一起终止，U 盘才能安全弹出）。
   代价是终端模式下按 Ctrl+C 会连带发信号到这里 —— 注册空监听器即可忽略，
   真正要停网关时走 tools\eject-usb.bat / START.bat 的退出清理（按 pid 精确结束）。 */
try {
  process.on('SIGINT', () => {});
  process.on('SIGBREAK', () => {});
} catch (_) { /* 非 Windows 或信号不可用时忽略 */ }

function readEnvFile(file, out) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const i = l.indexOf('=');
      if (i <= 0) continue;
      out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
  } catch (e) { /* 文件缺失时忽略 */ }
}
function loadKeys() {
  const out = {};
  // 加载顺序：config/keys.env（程序随附默认值）→ data/home/keys.env（数据区覆盖，
  // 密钥可与程序目录分离存放；拷贝/分享程序文件夹时不会带出密钥）
  readEnvFile(path.join(ROOT, 'config', 'keys.env'), out);
  readEnvFile(path.join(ROOT, 'data', 'home', 'keys.env'), out);
  return out;
}

let KEYS = loadKeys();
setInterval(() => { KEYS = loadKeys(); }, 30000).unref();

// 可选请求日志：设 GW_LOG=1 后追加写入 data/home/logs/gw.log（JSON 行格式）
const GW_LOG = /^(1|true|yes|on)$/i.test(process.env.GW_LOG || '');
const LOG_FILE = path.join(ROOT, 'data', 'home', 'logs', 'gw.log');
let logStream = null;
if (GW_LOG) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    console.log('[usbai-gw] 请求日志已开启 ->', LOG_FILE);
  } catch (e) { console.warn('[usbai-gw] 日志文件打开失败:', e && e.message); }
}
function gwLog(obj) {
  if (!logStream) return;
  try { logStream.write(JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n'); } catch (e) { /* 忽略 */ }
}

function upstreamFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('mimo')) {
    return { base: 'https://api.xiaomimimo.com/anthropic', key: KEYS.MIMO_API_KEY || '', name: 'MiMo' };
  }
  return { base: 'https://api.deepseek.com/anthropic', key: KEYS.DEEPSEEK_API_KEY || '', name: 'DeepSeek' };
}

function resolveModel(model) {
  let m = String(model || '').trim();
  if (!m || m === 'default' || m === 'sonnet' || m === 'opus' || m === 'haiku') {
    m = KEYS.DEFAULT_MODEL || KEYS.DEEPSEEK_MODEL || 'deepseek-flash';
  }
  // [1m] 只是界面端的 1M 上下文标记，上游不认，转发前剥掉
  m = m.replace(/\[1m\]$/i, '');
  return m;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, gw: 'usbai', keys: { mimo: !!KEYS.MIMO_API_KEY, deepseek: !!KEYS.DEEPSEEK_API_KEY } }));
    return;
  }

  // 令牌校验（/health 除外，供启动器判活）
  if (GW_TOKEN) {
    const auth = String(req.headers['authorization'] || '');
    const xkey = String(req.headers['x-api-key'] || '');
    if (auth !== 'Bearer ' + GW_TOKEN && xkey !== GW_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: '网关令牌无效。' } }));
      return;
    }
  }

  // 客户端断开时中断上游请求，避免白烧 token
  // ⚠ 必须监听 res 的 close：req 的 'close' 在「请求体读完」时就会触发，
  //   会误杀每一个正常请求（表现为上游 7ms 就被 abort → 空 200）。
  const aborter = new AbortController();
  res.on('close', () => { if (!res.writableFinished) aborter.abort(); });

  // 上游最长时长兜底（流式同样生效）：上游挂死时连接不会永不释放
  const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;
  const upTimer = setTimeout(() => aborter.abort(), UPSTREAM_TIMEOUT_MS);
  if (upTimer.unref) upTimer.unref();
  res.on('close', () => clearTimeout(upTimer));

  const requestStartedAt = Date.now();
  // 读取完整请求体
  const chunks = [];
  let size = 0;
  try {
    for await (const c of req) {
      chunks.push(c);
      size += c.length;
      if (size > 64 * 1024 * 1024) { res.writeHead(413); res.end(); return; }
    }
  } catch (e) { res.writeHead(400); res.end(); return; }
  let body = Buffer.concat(chunks);
  const bodyReadMs = Date.now() - requestStartedAt;

  // 解析 model 并路由（非 JSON 则透传原样）
  let model = '';
  try {
    const j = JSON.parse(body.toString('utf8'));
    model = resolveModel(j.model);
    j.model = model;
    body = Buffer.from(JSON.stringify(j), 'utf8');
  } catch (e) { /* 保留原 body */ }

  const up = upstreamFor(model);
  const t0 = Date.now();
  let upstreamHeadersMs = null;
  let firstChunkMs = null;
  const timing = (extra = {}) => ({
    bytes: body.length,
    bodyReadMs,
    upstreamHeadersMs,
    firstChunkMs,
    totalMs: Date.now() - requestStartedAt,
    ...extra,
  });
  if (!up.key) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: '未配置 ' + up.name + ' 的 API Key。请用记事本打开 config\\keys.env 填写后重试（网关会自动热加载）。' },
    }));
    gwLog({ m: req.method, u: req.url, model, up: up.name, st: 401, err: 'no-key', ...timing(), ms: Date.now() - t0 });
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (['host', 'connection', 'content-length', 'authorization', 'x-api-key', 'accept-encoding'].includes(lk)) continue;
    headers[k] = v;
  }
  headers['authorization'] = 'Bearer ' + up.key;
  headers['x-api-key'] = up.key;
  if (body.length) headers['content-length'] = String(body.length);

  const url = up.base + req.url;
  try {
    const resp = await fetch(url, { method: req.method, headers, body: body.length ? body : undefined, signal: aborter.signal });
    upstreamHeadersMs = Date.now() - requestStartedAt;
    // 上游 2xx 却没给响应体：明确报错，避免前端只看到「空响应 HTTP 200」无从排查
    if (!resp.body && resp.status >= 200 && resp.status < 300) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: '网关：' + up.name + ' 上游返回了空响应（HTTP ' + resp.status + '），请稍后重试。' },
      }));
      gwLog({ m: req.method, u: req.url, model, up: up.name, st: 'empty', ...timing(), ms: Date.now() - t0 });
      return;
    }
    const h = {};
    for (const [k, v] of resp.headers) {
      const lk = k.toLowerCase();
      if (['content-length', 'transfer-encoding', 'connection', 'content-encoding'].includes(lk)) continue;
      h[k] = v;
    }
    res.writeHead(resp.status, h);
    if (resp.body) {
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkMs === null) firstChunkMs = Date.now() - requestStartedAt;
        res.write(Buffer.from(value));
      }
    }
    res.end();
    gwLog({ m: req.method, u: req.url, model, up: up.name, st: resp.status, ...timing(), ms: Date.now() - t0 });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      // 客户端主动断开：上游已中断，静默收尾
      try { res.end(); } catch (_) { /* 已断开 */ }
      gwLog({ m: req.method, u: req.url, model, up: up.name, st: 'abort', ...timing(), ms: Date.now() - t0 });
      return;
    }
    try {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: '网关请求 ' + up.name + ' 上游失败: ' + (e && e.message ? e.message : e) },
      }));
    } catch (_) { /* 客户端已断开 */ }
    gwLog({ m: req.method, u: req.url, model, up: up.name, st: 502, err: String(e && e.message ? e.message : e).slice(0, 200), ...timing(), ms: Date.now() - t0 });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[usbai-gw] http://127.0.0.1:' + PORT + '  (mimo→MiMo, 其余→DeepSeek)');
});
