import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { CameraRepository } from '../repositories/CameraRepository';
import { MediaMtxService } from './MediaMtxService';
import { findFfmpegPath } from '../dshowEnumerator';
import type { Camera, CameraRuntimeSnapshot, CameraStatus } from '../../types/cctv';
import { logLine } from './LoggingService';
import { CredentialService } from './CredentialService';
import { CameraSourceAdapterRegistry } from './CameraSourceAdapter';
import type { CameraStateTransition } from './OperationalEventService';

interface RuntimeProcess {
  process: ChildProcessWithoutNullStreams;
  stopping: boolean;
  encoder: string;
  sourceType: string;
  startedAt: string;
}

interface RuntimeMeta {
  state: CameraStatus;
  reason: string | null;
  stateSince: string;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  lastOfflineReason: string | null;
  restartCount: number;
  consecutiveFailures: number;
  recoveryAttempt: number;
  lastRecovery: string | null;
  lastExit: string | null;
  nextRetryAt: string | null;
  circuitOpenUntil: string | null;
  mediaPathPresent: boolean;
  streamReady: boolean;
  mediaReaders: number;
  mediaMisses: number;
}

function redactMediaError(text: string): string {
  return String(text || '').replace(/rtsp:\/\/[^\s@]+@/gi, 'rtsp://***@');
}

function isoNow(): string { return new Date().toISOString(); }

export class CameraProcessManager {
  private sources: CameraSourceAdapterRegistry;
  private runtimes = new Map<string, RuntimeProcess>();
  private meta = new Map<string, RuntimeMeta>();
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private startPromises = new Map<string, Promise<Camera>>();
  private restartDelays = [2000, 5000, 15000, 30000, 60000];
  private failureHistory = new Map<string, number[]>();
  private shuttingDown = false;
  private readonly failureWindowMs = 10 * 60_000;
  private readonly circuitFailureThreshold = 5;
  private readonly circuitCooldownMs = 5 * 60_000;

  constructor(
    private repo: CameraRepository,
    private media: MediaMtxService,
    credentials: CredentialService,
    private onTransition?: (transition: CameraStateTransition) => void,
  ) {
    this.sources = new CameraSourceAdapterRegistry(repo, credentials);
  }

  prepareForStartup(): void {
    this.shuttingDown = false;
    for (const camera of this.repo.list()) {
      const state: CameraStatus = camera.enabled ? 'configured' : 'disabled';
      this.repo.patch(camera.id, { status: state });
      this.meta.set(camera.id, this.createMeta(state, camera.enabled ? 'STARTUP_RECONCILIATION' : 'CAMERA_DISABLED'));
    }
  }

  async start(cameraId: string): Promise<Camera> {
    if (this.shuttingDown) throw Object.assign(new Error('CCTV Monitor is shutting down.'), { code: 'SHUTTING_DOWN' });
    const pending = this.startPromises.get(cameraId);
    if (pending) return pending;
    const promise = this.startInternal(cameraId);
    this.startPromises.set(cameraId, promise);
    try { return await promise; } finally { this.startPromises.delete(cameraId); }
  }

  private async startInternal(cameraId: string): Promise<Camera> {
    const camera = this.repo.get(cameraId);
    if (!camera) throw new Error('Camera not found.');
    if (this.runtimes.has(cameraId)) return camera;

    const timer = this.restartTimers.get(cameraId);
    if (timer) { clearTimeout(timer); this.restartTimers.delete(cameraId); }
    this.updateMeta(cameraId, { nextRetryAt: null });

    const ffmpeg = await findFfmpegPath();
    if (!ffmpeg) {
      this.transition(cameraId, 'error', 'FFMPEG_NOT_FOUND');
      throw new Error('FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH.');
    }
    await this.media.ensureStarted();

    const streamPath = camera.stream?.path || `cam-${camera.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const preexistingPath = await this.media.pathState(streamPath);
    if (preexistingPath.state === 'ready') {
      this.transition(cameraId, 'error', 'UNMANAGED_STREAM_PRESENT');
      throw Object.assign(new Error(`MediaMTX path '${streamPath}' is already being published before this camera worker started. Stop the stale publisher/FFmpeg process and retry.`), { code: 'UNMANAGED_STREAM_PRESENT', stage: 'stream' });
    }

    const stream = { path: streamPath, protocol: 'webrtc' as const, whepPath: `/${streamPath}/whep` };
    this.transition(cameraId, 'starting', 'START_REQUESTED');
    const prepared = await this.sources.prepare(camera);
    const encoder = prepared.encoder;
    const args = [...prepared.ffmpegArgs];
    const sourceDescription = prepared.sourceDescription;
    this.repo.patch(cameraId, { stream, last_error: null, ...prepared.cameraPatch });

    args.push('-rtsp_transport', 'tcp', '-f', 'rtsp', `${this.media.rtspBase}/${streamPath}`);
    logLine('camera-manager', 'INFO', `Starting ${cameraId} (${camera.source_type}) with ${encoder} from ${sourceDescription}.`);
    const child = spawn(ffmpeg, args, { windowsHide: true });
    const runtime: RuntimeProcess = { process: child, stopping: false, encoder, sourceType: camera.source_type || 'unknown', startedAt: isoNow() };
    this.runtimes.set(cameraId, runtime);
    this.transition(cameraId, 'starting', 'FFMPEG_STARTED');

    let recentError = '';
    let exitedEarly = false;
    child.stderr.on('data', (chunk) => {
      const text = redactMediaError(chunk.toString());
      recentError += text;
      if (recentError.length > 10000) recentError = recentError.slice(-10000);
      logLine('ffmpeg', 'INFO', `[${cameraId}] ${text.trim()}`);
    });
    child.once('error', (error) => {
      const message = redactMediaError(error.message);
      logLine('camera-manager', 'ERROR', `[${cameraId}] FFmpeg process error: ${message}`);
      this.transition(cameraId, 'error', 'FFMPEG_PROCESS_ERROR', message);
    });
    child.once('exit', (code, signal) => {
      exitedEarly = true;
      this.runtimes.delete(cameraId);
      this.updateMeta(cameraId, { lastExit: isoNow(), mediaPathPresent: false, streamReady: false, mediaReaders: 0 });
      if (runtime.stopping || this.shuttingDown) return;
      const current = this.repo.get(cameraId);
      if (!current?.enabled) return;
      const message = redactMediaError(recentError.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `FFmpeg exited (${code ?? signal}).`);
      logLine('camera-manager', 'WARN', `[${cameraId}] ${message}`);
      this.transition(cameraId, 'offline', 'FFMPEG_EXITED', message);
      this.scheduleRestart(cameraId, 'FFMPEG_EXITED');
    });

    const readyDeadline = Date.now() + (camera.source_type === 'rtsp' ? 15000 : 10000);
    let ready = false;
    while (Date.now() < readyDeadline && !exitedEarly && child.exitCode === null) {
      const pathState = await this.media.pathState(streamPath);
      this.updateMediaMeta(cameraId, pathState.info, pathState.state);
      if (pathState.state === 'ready') { ready = true; break; }
      this.transition(cameraId, pathState.state === 'absent' ? 'starting' : 'starting', pathState.state === 'absent' ? 'WAITING_FOR_MEDIA_PATH' : 'MEDIA_PATH_CONNECTING', undefined, false);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (exitedEarly || child.exitCode !== null) {
      const msg = redactMediaError(recentError.split(/\r?\n/).filter(Boolean).slice(-4).join(' ') || 'FFmpeg exited before MediaMTX reported the stream as ready.');
      throw Object.assign(new Error(msg), { code: 'FFMPEG_EXITED', stage: 'stream' });
    }

    if (!ready) {
      runtime.stopping = true;
      await this.terminate(child);
      this.runtimes.delete(cameraId);
      const msg = redactMediaError(recentError.split(/\r?\n/).filter(Boolean).slice(-4).join(' ') || 'MediaMTX did not report the stream path as ready.');
      this.transition(cameraId, 'offline', 'MEDIA_PATH_TIMEOUT', msg);
      throw Object.assign(new Error(msg), { code: 'MEDIAMTX_PATH_NOT_READY', stage: 'stream' });
    }

    if (!this.repo.get(cameraId)?.enabled) {
      runtime.stopping = true;
      await this.terminate(child);
      this.runtimes.delete(cameraId);
      this.transition(cameraId, 'disabled', 'CAMERA_DISABLED');
      return this.repo.get(cameraId)!;
    }

    const previousFailures = this.getMeta(cameraId).consecutiveFailures;
    const now = isoNow();
    this.failureHistory.delete(cameraId);
    this.updateMeta(cameraId, {
      consecutiveFailures: 0,
      recoveryAttempt: 0,
      nextRetryAt: null,
      circuitOpenUntil: null,
      lastRecovery: previousFailures > 0 ? now : this.getMeta(cameraId).lastRecovery,
      mediaMisses: 0,
    });
    this.transition(cameraId, 'online', 'STREAM_READY');
    logLine('camera-manager', 'INFO', `[${cameraId}] Stream is LIVE at path ${streamPath}.`);
    const current = this.repo.get(cameraId)!;
    const updated = this.repo.patch(cameraId, {
      status: 'online', enabled: true, codec: encoder === 'stream-copy' ? current.codec : `H.264 (${encoder})`, last_error: null,
      lastSeen: new Date().toLocaleTimeString(), stream,
      usb_source: current.usb_source ? { ...current.usb_source, encoder_active: encoder, last_capture_error: null } : undefined,
      rtsp_source: current.rtsp_source ? { ...current.rtsp_source, encoder_active: encoder } : undefined,
    });
    return updated!;
  }

  async stop(cameraId: string, disabled = true, stopReason?: string): Promise<Camera | null> {
    const timer = this.restartTimers.get(cameraId);
    if (timer) { clearTimeout(timer); this.restartTimers.delete(cameraId); }
    this.updateMeta(cameraId, { nextRetryAt: null, circuitOpenUntil: disabled ? null : this.getMeta(cameraId).circuitOpenUntil });
    const runtime = this.runtimes.get(cameraId);
    if (runtime) {
      runtime.stopping = true;
      await this.terminate(runtime.process);
      this.runtimes.delete(cameraId);
    }
    if (disabled) {
      this.failureHistory.delete(cameraId);
      this.updateMeta(cameraId, { consecutiveFailures: 0, recoveryAttempt: 0, mediaPathPresent: false, streamReady: false, mediaReaders: 0, mediaMisses: 0 });
      this.transition(cameraId, 'disabled', 'CAMERA_DISABLED');
      return this.repo.patch(cameraId, { enabled: false, status: 'disabled' });
    }
    this.updateMeta(cameraId, { mediaPathPresent: false, streamReady: false, mediaReaders: 0, mediaMisses: 0 });
    this.transition(cameraId, 'offline', stopReason || (this.shuttingDown ? 'APPLICATION_SHUTDOWN' : 'WORKER_STOPPED'));
    return this.repo.patch(cameraId, { enabled: this.repo.get(cameraId)?.enabled ?? false, status: 'offline' });
  }

  async restart(cameraId: string): Promise<Camera> {
    await this.stop(cameraId, false);
    return this.start(cameraId);
  }

  async startEnabled(): Promise<void> {
    for (const camera of this.repo.list().filter((c) => c.enabled)) {
      try { await this.start(camera.id); }
      catch (error: any) {
        const message = redactMediaError(error?.message || String(error));
        if (error?.code !== 'UNMANAGED_STREAM_PRESENT') {
          this.transition(camera.id, 'offline', error?.code || 'START_FAILED', message);
          logLine('camera-manager', 'WARN', `[${camera.id}] Startup failed; recovery scheduled: ${message}`);
          this.scheduleRestart(camera.id, error?.code || 'START_FAILED');
        } else {
          logLine('camera-manager', 'ERROR', `[${camera.id}] Startup blocked: ${message}`);
        }
      }
    }
  }

  async superviseEnabled(): Promise<void> {
    if (this.shuttingDown) return;
    const pathSnapshot = await this.media.listPaths();
    for (const camera of this.repo.list().filter((c) => c.enabled)) {
      if (this.startPromises.has(camera.id)) continue;
      const runtime = this.runtimes.get(camera.id);
      if (runtime) {
        const pathState = camera.stream?.path ? this.media.pathStateFromList(camera.stream.path, pathSnapshot) : { state: 'absent' as const, info: null };
        this.updateMediaMeta(camera.id, pathState.info, pathState.state);
        const meta = this.getMeta(camera.id);
        if (pathState.state === 'ready') {
          if (meta.state !== 'online') this.transition(camera.id, 'online', 'STREAM_READY');
          this.updateMeta(camera.id, { mediaMisses: 0 });
          continue;
        }

        const misses = meta.mediaMisses + 1;
        this.updateMeta(camera.id, { mediaMisses: misses });
        if (misses === 1) {
          this.transition(camera.id, 'degraded', pathState.state === 'absent' ? 'MEDIA_PATH_MISSING' : 'MEDIA_PATH_NOT_READY');
          continue;
        }

        logLine('recovery', 'WARN', `[${camera.id}] FFmpeg is alive but MediaMTX stream is not ready for ${misses} supervisor checks; recycling worker.`);
        await this.stop(camera.id, false, 'STUCK_MEDIA_PIPELINE');
        this.scheduleRestart(camera.id, 'STUCK_MEDIA_PIPELINE');
        continue;
      }

      if (this.restartTimers.has(camera.id)) continue;
      const meta = this.getMeta(camera.id);
      if (meta.circuitOpenUntil && Date.parse(meta.circuitOpenUntil) > Date.now()) continue;
      if (meta.circuitOpenUntil) this.updateMeta(camera.id, { circuitOpenUntil: null, consecutiveFailures: 0, recoveryAttempt: 0 });

      try { await this.start(camera.id); }
      catch (error: any) {
        const message = redactMediaError(error?.message || String(error));
        if (error?.code === 'UNMANAGED_STREAM_PRESENT') {
          this.transition(camera.id, 'error', 'UNMANAGED_STREAM_PRESENT', message);
          continue;
        }
        this.transition(camera.id, 'offline', error?.code || 'RECONCILE_FAILED', message);
        logLine('camera-manager', 'WARN', `[${camera.id}] Supervisor recovery failed: ${message}`);
        this.scheduleRestart(camera.id, error?.code || 'RECONCILE_FAILED');
      }
    }
  }

  async reconcileEnabled(): Promise<void> { await this.superviseEnabled(); }

  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    for (const id of [...this.runtimes.keys()]) await this.stop(id, false);
  }

  runtime(cameraId: string): CameraRuntimeSnapshot {
    const camera = this.repo.get(cameraId);
    const rt = this.runtimes.get(cameraId);
    const meta = this.getMeta(cameraId);
    return {
      cameraId,
      name: camera?.name || cameraId,
      enabled: Boolean(camera?.enabled),
      state: meta.state,
      reason: meta.reason,
      stateSince: meta.stateSince,
      sourceType: camera?.source_type,
      running: Boolean(rt),
      pid: rt?.process.pid ?? null,
      encoder: rt?.encoder ?? null,
      workerStartedAt: rt?.startedAt ?? null,
      restartCount: meta.restartCount,
      consecutiveFailures: meta.consecutiveFailures,
      recoveryAttempt: meta.recoveryAttempt,
      reconnectScheduled: this.restartTimers.has(cameraId),
      starting: this.startPromises.has(cameraId),
      nextRetryAt: meta.nextRetryAt,
      circuitOpenUntil: meta.circuitOpenUntil,
      lastRecovery: meta.lastRecovery,
      lastExit: meta.lastExit,
      lastOnlineAt: meta.lastOnlineAt,
      lastOfflineAt: meta.lastOfflineAt,
      mediaPathPresent: meta.mediaPathPresent,
      streamReady: meta.streamReady,
      mediaReaders: meta.mediaReaders,
    };
  }

  allRuntime(): CameraRuntimeSnapshot[] { return this.repo.list().map((camera) => this.runtime(camera.id)); }

  async allRuntimeWithMedia(): Promise<CameraRuntimeSnapshot[]> {
    const cameras = this.repo.list();
    const pathSnapshot = await this.media.listPaths();
    for (const camera of cameras) {
      if (!camera.stream?.path) continue;
      const pathState = this.media.pathStateFromList(camera.stream.path, pathSnapshot);
      this.updateMediaMeta(camera.id, pathState.info, pathState.state);
    }
    return cameras.map((camera) => this.runtime(camera.id));
  }

  private scheduleRestart(cameraId: string, reason: string) {
    if (this.shuttingDown || this.restartTimers.has(cameraId)) return;
    const camera = this.repo.get(cameraId);
    if (!camera?.enabled) return;
    const existingMeta = this.getMeta(cameraId);
    if (existingMeta.circuitOpenUntil && Date.parse(existingMeta.circuitOpenUntil) > Date.now()) return;

    const now = Date.now();
    const history = [...(this.failureHistory.get(cameraId) || []), now].filter((stamp) => now - stamp <= this.failureWindowMs);
    this.failureHistory.set(cameraId, history);
    const meta = this.getMeta(cameraId);
    const attempt = meta.recoveryAttempt + 1;
    this.updateMeta(cameraId, { restartCount: meta.restartCount + 1, consecutiveFailures: history.length, recoveryAttempt: attempt });

    if (history.length >= this.circuitFailureThreshold) {
      const circuitOpenUntil = new Date(now + this.circuitCooldownMs).toISOString();
      this.updateMeta(cameraId, { circuitOpenUntil, nextRetryAt: circuitOpenUntil });
      this.transition(cameraId, 'error', 'CIRCUIT_BREAKER_OPEN', `Recovery paused after ${history.length} failures within 10 minutes. Automatic retry resumes after ${circuitOpenUntil}.`);
      logLine('recovery', 'ERROR', `[${cameraId}] Recovery circuit opened until ${circuitOpenUntil}. Last reason: ${reason}`);
      return;
    }

    const baseDelay = this.restartDelays[Math.min(attempt - 1, this.restartDelays.length - 1)];
    const jitter = Math.round(baseDelay * 0.1 * (Math.random() * 2 - 1));
    const delay = Math.max(1000, baseDelay + jitter);
    const nextRetryAt = new Date(now + delay).toISOString();
    this.updateMeta(cameraId, { nextRetryAt });
    this.transition(cameraId, 'retrying', reason);
    logLine('recovery', 'WARN', `[${cameraId}] Recovery attempt ${attempt} scheduled in ${delay} ms.`);
    const timer = setTimeout(async () => {
      this.restartTimers.delete(cameraId);
      this.updateMeta(cameraId, { nextRetryAt: null });
      if (this.shuttingDown) return;
      const current = this.repo.get(cameraId);
      if (!current?.enabled) return;
      try {
        await this.start(cameraId);
        logLine('recovery', 'INFO', `[${cameraId}] Recovery attempt ${attempt} succeeded.`);
      } catch (error: any) {
        const message = redactMediaError(error?.message || String(error));
        if (error?.code === 'UNMANAGED_STREAM_PRESENT') {
          this.transition(cameraId, 'error', 'UNMANAGED_STREAM_PRESENT', message);
          return;
        }
        this.transition(cameraId, 'offline', error?.code || 'RECOVERY_FAILED', message);
        logLine('recovery', 'WARN', `[${cameraId}] Recovery attempt ${attempt} failed: ${message}`);
        this.scheduleRestart(cameraId, error?.code || 'RECOVERY_FAILED');
      }
    }, delay);
    this.restartTimers.set(cameraId, timer);
  }

  private getMeta(cameraId: string): RuntimeMeta {
    const existing = this.meta.get(cameraId);
    if (existing) return existing;
    const camera = this.repo.get(cameraId);
    const created = this.createMeta(camera?.enabled ? (camera.status || 'configured') : 'disabled', camera?.enabled ? 'RUNTIME_INITIALIZED' : 'CAMERA_DISABLED');
    this.meta.set(cameraId, created);
    return created;
  }

  private createMeta(state: CameraStatus, reason: string | null): RuntimeMeta {
    return {
      state,
      reason,
      stateSince: isoNow(),
      lastOnlineAt: state === 'online' ? isoNow() : null,
      lastOfflineAt: ['offline', 'error'].includes(state) ? isoNow() : null,
      lastOfflineReason: ['offline', 'error'].includes(state) ? reason : null,
      restartCount: 0,
      consecutiveFailures: 0,
      recoveryAttempt: 0,
      lastRecovery: null,
      lastExit: null,
      nextRetryAt: null,
      circuitOpenUntil: null,
      mediaPathPresent: false,
      streamReady: false,
      mediaReaders: 0,
      mediaMisses: 0,
    };
  }

  private transition(cameraId: string, state: CameraStatus, reason: string | null, errorMessage?: string, persist = true): void {
    const meta = this.getMeta(cameraId);
    const previousState = meta.state;
    const previousReason = meta.reason;
    const stateChanged = previousState !== state;
    const changed = stateChanged || meta.reason !== reason;
    const hadBeenOnline = Boolean(meta.lastOnlineAt);
    const now = isoNow();
    if (changed) {
      meta.state = state;
      meta.reason = reason;
      meta.stateSince = now;
    }
    if (state === 'online') meta.lastOnlineAt = now;
    if (state === 'offline' || state === 'error') { meta.lastOfflineAt = now; meta.lastOfflineReason = reason; }
    this.meta.set(cameraId, meta);
    if (persist) {
      const lastError = errorMessage !== undefined ? errorMessage : (state === 'online' || state === 'starting' || state === 'configured' || state === 'disabled' ? null : this.repo.get(cameraId)?.last_error || null);
      this.repo.patch(cameraId, { status: state, last_error: lastError, lastSeen: state === 'online' ? new Date().toLocaleTimeString() : this.repo.get(cameraId)?.lastSeen || 'Never' });
    }
    if (stateChanged && this.onTransition) {
      const camera = this.repo.get(cameraId);
      try {
        this.onTransition({
          cameraId,
          cameraName: camera?.name || cameraId,
          previousState,
          previousReason,
          nextState: state,
          reason,
          occurredAt: now,
          hadBeenOnline,
          lastOfflineReason: meta.lastOfflineReason,
          errorMessage: errorMessage || null,
        });
      } catch (error: any) {
        logLine('events', 'ERROR', `[${cameraId}] Failed to persist operational transition ${previousState} -> ${state}: ${error?.message || String(error)}`);
      }
    }
  }

  private updateMeta(cameraId: string, patch: Partial<RuntimeMeta>): void {
    this.meta.set(cameraId, { ...this.getMeta(cameraId), ...patch });
  }

  private updateMediaMeta(cameraId: string, info: any | null, state: 'absent' | 'present-not-ready' | 'ready'): void {
    this.updateMeta(cameraId, {
      mediaPathPresent: state !== 'absent',
      streamReady: state === 'ready',
      mediaReaders: Array.isArray(info?.readers) ? info.readers.length : Number(info?.readersCount || 0),
    });
  }

  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => { if (resolved) return; resolved = true; resolve(); };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish();
      }, 2500);
      child.once('exit', () => { clearTimeout(timer); finish(); });
      try { child.kill('SIGTERM'); } catch { clearTimeout(timer); finish(); }
    });
  }
}
