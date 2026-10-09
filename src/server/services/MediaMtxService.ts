import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'node:net';
import { logLine } from './LoggingService';

export class MediaMtxService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startedByUs = false;
  private startPromise: Promise<void> | null = null;
  readonly apiBase = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
  readonly rtspBase = process.env.MEDIAMTX_RTSP_URL || 'rtsp://127.0.0.1:8554';
  readonly webrtcBase = process.env.MEDIAMTX_WEBRTC_URL || 'http://127.0.0.1:8889';
  readonly hlsBase = process.env.MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888';

  constructor(private rootDir: string) {}

  private authAddress(): string {
    return `http://127.0.0.1:${process.env.PORT || '3000'}/internal/mediamtx/auth`;
  }

  async globalConfig(): Promise<any | null> {
    try {
      const res = await fetch(`${this.apiBase}/v3/config/global/get`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async ensureSecurityConfiguration(): Promise<void> {
    const desiredAddress = this.authAddress();
    const current = await this.globalConfig();
    const apiLoopback = current?.apiAddress === '127.0.0.1:9997' || current?.apiAddress === 'localhost:9997';
    if (current?.authMethod === 'http' && current?.authHTTPAddress === desiredAddress && apiLoopback) return;
    const res = await fetch(`${this.apiBase}/v3/config/global/patch`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authMethod: 'http',
        authHTTPAddress: desiredAddress,
        authHTTPExclude: [{ action: 'api' }, { action: 'metrics' }, { action: 'pprof' }],
        api: true,
        apiAddress: '127.0.0.1:9997',
      }),
    }).catch(() => null);
    if (!res?.ok) throw new Error('An existing MediaMTX instance is running without the required CCTV media authorization and could not be secured through its local Control API. Stop the stale MediaMTX process, then start CCTV Monitor again.');
    const verified = await this.globalConfig();
    const verifiedApiLoopback = verified?.apiAddress === '127.0.0.1:9997' || verified?.apiAddress === 'localhost:9997';
    if (verified?.authMethod !== 'http' || verified?.authHTTPAddress !== desiredAddress || !verifiedApiLoopback) throw new Error('MediaMTX media authorization/control-API isolation could not be verified after configuration update.');
  }

  async health(): Promise<{ ok: boolean; info?: any; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${this.apiBase}/v3/info`, { signal: controller.signal });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, info: await res.json() };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private binaryCandidates(): string[] {
    return [
      process.env.MEDIAMTX_PATH,
      path.join(this.rootDir, 'tools', 'mediamtx', process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx'),
      process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx',
    ].filter((v): v is string => Boolean(v));
  }

  findBinary(): string | null {
    for (const candidate of this.binaryCandidates()) {
      if (path.isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\')) {
        if (fs.existsSync(candidate)) return candidate;
        continue;
      }
      for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
        const resolved = path.join(dir.replace(/^"|"$/g, ''), candidate);
        if (fs.existsSync(resolved)) return resolved;
      }
    }
    return null;
  }


  configPath(): string {
    return process.env.MEDIAMTX_CONFIG || path.join(this.rootDir, 'tools', 'mediamtx', 'mediamtx.yml');
  }

  runtimeInfo() {
    return {
      binary: this.findBinary(),
      config: this.configPath(),
      webrtc: this.webrtcBase,
      hls: this.hlsBase,
      startedByApp: this.startedByUs,
      pid: this.child?.pid || null,
    };
  }

  async ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.ensureStartedInternal();
    try { await this.startPromise; } finally { this.startPromise = null; }
  }

  private async ensureStartedInternal(): Promise<void> {
    if ((await this.health()).ok) {
      await this.ensureSecurityConfiguration();
      return;
    }
    const binary = this.findBinary();
    if (!binary) throw new Error('MediaMTX is not running and no MediaMTX binary was found. Run scripts/setup-mediamtx.ps1 or set MEDIAMTX_PATH.');
    const conf = this.configPath();
    if (!fs.existsSync(conf)) throw new Error(`MediaMTX configuration not found: ${conf}`);

    this.child = spawn(binary, [conf], {
      cwd: path.dirname(conf),
      windowsHide: true,
      env: {
        ...process.env,
        // Keep MediaMTX auth coupled to the actual CCTV HTTP port even when PORT is overridden.
        MTX_AUTHHTTPADDRESS: this.authAddress(),
      },
    });
    this.startedByUs = true;
    logLine('mediamtx', 'INFO', `Starting MediaMTX with config ${conf}.`);
    this.child.stdout.on('data', (d) => { const text = String(d); logLine('mediamtx', 'INFO', text.trim()); process.stdout.write(`[MediaMTX] ${text}`); });
    this.child.stderr.on('data', (d) => { const text = String(d); logLine('mediamtx', 'WARN', text.trim()); process.stderr.write(`[MediaMTX] ${text}`); });
    this.child.once('exit', (code, signal) => {
      logLine('mediamtx', 'WARN', `MediaMTX exited (${code ?? signal ?? 'unknown'}).`);
      this.child = null;
      this.startedByUs = false;
    });

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if ((await this.health()).ok) {
        await this.ensureSecurityConfiguration();
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('MediaMTX did not become healthy on port 9997 within 12 seconds.');
  }

  async listPaths(): Promise<any[]> {
    try {
      const res = await fetch(`${this.apiBase}/v3/paths/list`);
      if (!res.ok) return [];
      const body: any = await res.json();
      const items = Array.isArray(body?.items) ? body.items : Array.isArray(body?.paths) ? body.paths : Array.isArray(body) ? body : [];
      return items;
    } catch { return []; }
  }

  pathStateFromList(streamPath: string, items: any[]): { state: 'absent' | 'present-not-ready' | 'ready'; info: any | null } {
    const info = items.find((item: any) => String(item?.name || item?.path || '') === streamPath) || null;
    if (!info) return { state: 'absent', info: null };
    const ready = Boolean(info?.ready ?? info?.sourceReady ?? info?.source);
    return { state: ready ? 'ready' : 'present-not-ready', info };
  }

  async pathState(streamPath: string): Promise<{ state: 'absent' | 'present-not-ready' | 'ready'; info: any | null }> {
    return this.pathStateFromList(streamPath, await this.listPaths());
  }

  async pathReady(streamPath: string): Promise<boolean> {
    return (await this.pathState(streamPath)).state === 'ready';
  }

  async pathInfo(streamPath: string): Promise<any | null> {
    return (await this.pathState(streamPath)).info;
  }

  async waitForPath(streamPath: string, timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.pathReady(streamPath)) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  private async tcpReachable(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
    try {
      const url = new URL(baseUrl);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      return await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: url.hostname, port });
        const done = (ok: boolean) => {
          socket.removeAllListeners();
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
      });
    } catch {
      return false;
    }
  }

  async webrtcReachable(timeoutMs = 1500): Promise<boolean> {
    return this.tcpReachable(this.webrtcBase, timeoutMs);
  }

  async hlsReachable(timeoutMs = 1500): Promise<boolean> {
    return this.tcpReachable(this.hlsBase, timeoutMs);
  }

  async recoverIfNeeded(): Promise<boolean> {
    if ((await this.health()).ok) return true;
    try {
      await this.ensureStarted();
      logLine('recovery', 'INFO', 'MediaMTX recovery succeeded.');
      return true;
    } catch (error: any) {
      logLine('recovery', 'ERROR', `MediaMTX recovery failed: ${error?.message || String(error)}`);
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this.startedByUs || !this.child) return;
    const child = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 2500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
    });
  }
}
