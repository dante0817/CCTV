import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = Number(process.env.CCTV_LOG_MAX_BYTES || 2 * 1024 * 1024);
const MAX_FILES = Math.max(1, Number(process.env.CCTV_LOG_MAX_FILES || 5));
let rootDir = process.cwd();
let consolePatched = false;

export function configureLogging(root: string) {
  rootDir = root;
  fs.mkdirSync(logDir(), { recursive: true });
}

export function logDir() {
  return path.join(rootDir, 'logs');
}

function redact(input: string): string {
  return input
    .replace(/(password|passwd|pwd|secret|token|authorization|cookie|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/(rtsp:\/\/)([^/@\s:]+):([^/@\s]+)@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]');
}

function fileFor(channel: string) {
  const safe = channel.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  return path.join(logDir(), `${safe}.log`);
}

function rotate(file: string) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) return;
    if (fs.existsSync(`${file}.${MAX_FILES}`)) fs.rmSync(`${file}.${MAX_FILES}`, { force: true });
    for (let i = MAX_FILES - 1; i >= 1; i -= 1) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Logging must never take down CCTV Monitor.
  }
}

export function logLine(channel: string, level: 'INFO' | 'WARN' | 'ERROR', message: unknown) {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = fileFor(channel);
    rotate(file);
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(text)}\n`, 'utf8');
  } catch {
    // Best-effort only.
  }
}

export function patchConsoleLogging() {
  if (consolePatched) return;
  consolePatched = true;
  const original = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
  console.log = (...args: any[]) => { logLine('server', 'INFO', args.map(String).join(' ')); original.log(...args); };
  console.warn = (...args: any[]) => { logLine('server', 'WARN', args.map(String).join(' ')); original.warn(...args); };
  console.error = (...args: any[]) => { logLine('server', 'ERROR', args.map(String).join(' ')); original.error(...args); };
}

export function tailLog(channel: string, maxBytes = 64 * 1024): string {
  try {
    const file = fileFor(channel);
    if (!fs.existsSync(file)) return '';
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return redact(buffer.toString('utf8'));
  } catch {
    return '';
  }
}

export function redactedEnvSnapshot() {
  const keys = [
    'PORT', 'NODE_ENV', 'FFMPEG_PATH', 'MEDIAMTX_PATH', 'MEDIAMTX_CONFIG', 'MEDIAMTX_API_URL',
    'MEDIAMTX_RTSP_URL', 'MEDIAMTX_WEBRTC_URL', 'MEDIAMTX_HLS_URL', 'CCTV_DB_PATH', 'CCTV_DEMO_MODE',
  ];
  return keys.map((key) => `${key}=${process.env[key] || ''}`).join('\n') + '\n';
}
