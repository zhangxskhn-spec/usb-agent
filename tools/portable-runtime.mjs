import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(ROOT, 'data', 'run');
const PID_FILE = path.join(RUN_DIR, 'gateway.pid');
const PORT_FILE = path.join(RUN_DIR, 'gateway.port');

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

async function startGateway(port) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const oldPid = readPid();
  if (isAlive(oldPid) && readPort() === Number(port) && await isOurGateway(Number(port))) {
    console.log(oldPid);
    return;
  }
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'anthropic-gw.mjs')], {
    cwd: ROOT,
    env: { ...process.env, GW_PORT: String(port) },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  fs.writeFileSync(PID_FILE, `${child.pid}\n`, 'utf8');
  fs.writeFileSync(PORT_FILE, `${port}\n`, 'utf8');
  console.log(child.pid);
}

async function stopGateway() {
  const pid = readPid();
  const port = readPort();
  if (pid && isAlive(pid) && await isOurGateway(port)) {
    try { process.kill(pid); } catch (_) {}
  }
  try { fs.rmSync(PID_FILE, { force: true }); } catch (_) {}
  try { fs.rmSync(PORT_FILE, { force: true }); } catch (_) {}
}

function printPort() {
  const port = readPort();
  if (port) console.log(port);
}

const [command, value] = process.argv.slice(2);
try {
  if (command === 'find-port') console.log(await findPort(value));
  else if (command === 'start-gateway') await startGateway(value || process.env.GW_PORT || 4567);
  else if (command === 'stop-gateway') await stopGateway();
  else if (command === 'read-port') printPort();
  else throw new Error('用法: find-port <起始端口> | start-gateway <端口> | stop-gateway');
} catch (error) {
  console.error(`[portable-runtime] ${error.message || error}`);
  process.exitCode = 1;
}
