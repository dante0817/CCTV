import fs from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { findFfmpegPath } from '../dshowEnumerator';
import { CameraRepository } from '../repositories/CameraRepository';
import { MotionRepository, type MotionReview, type MotionReviewStatus, type MotionSettings, type MotionZone } from '../repositories/MotionRepository';
import { RecordingRepository } from '../repositories/RecordingRepository';
import { CameraProcessManager } from './CameraProcessManager';
import { CredentialService } from './CredentialService';
import { MediaMtxService } from './MediaMtxService';
import { OperationalEventService } from './OperationalEventService';
import { logLine } from './LoggingService';

interface MotionRuntimeInternal {
  key: string;
  cameraId: string;
  zone: MotionZone | null;
  sensitivity: number;
  process: ChildProcessWithoutNullStreams;
  startedAt: string;
  stopping: boolean;
  lineBuffer: string;
  lastError: string | null;
}

export interface MotionRuntimeSnapshot {
  cameraId: string;
  supported: boolean;
  enabled: boolean;
  active: boolean;
  pid: number | null;
  analyzerCount: number;
  activeZoneCount: number;
  startedAt: string | null;
  lastDetectedAt: string | null;
  lastScore: number | null;
  lastError: string | null;
  threshold: number;
  settings: MotionSettings;
  zones: MotionZone[];
}

export interface MotionEventContext {
  eventId: number;
  cameraId: string;
  detectedAt: string;
  sceneScore: number;
  sensitivity: number;
  zoneId: number | null;
  zoneName: string | null;
  snapshotUrl: string | null;
  review: MotionReview;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function isoNow(): string { return new Date().toISOString(); }
function safePart(value: string): string { return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 100) || 'camera'; }

export class MotionService {
  private runtimes = new Map<string, MotionRuntimeInternal>();
  private lastDetectedAt = new Map<string, number>();
  private lastScores = new Map<string, number>();
  private lastErrors = new Map<string, string>();
  private retryAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private cameras: CameraRepository,
    private motion: MotionRepository,
    private recordings: RecordingRepository,
    private cameraProcesses: CameraProcessManager,
    private media: MediaMtxService,
    private credentials: CredentialService,
    private events: OperationalEventService,
    private snapshotRoot: string,
  ) {}

  async startSupervisor(): Promise<void> {
    this.shuttingDown = false;
    await fs.mkdir(this.snapshotRoot, { recursive: true });
    await this.cleanupOrphanSnapshots();
    await this.supervise();
    await this.linkRecentDetections();
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), 10_000);
      this.timer.unref?.();
    }
  }

  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const key of [...this.runtimes.keys()]) await this.stopWorker(key);
    this.retryAt.clear();
  }

  settings(cameraId: string): MotionSettings { return this.motion.getSettings(cameraId); }
  zones(cameraId: string): MotionZone[] { return this.motion.listZones(cameraId); }

  async createZone(cameraId: string, input: Partial<Omit<MotionZone, 'id' | 'cameraId' | 'updatedAt'>>): Promise<MotionZone> {
    this.ensureUsbCamera(cameraId);
    const zone = this.motion.createZone(cameraId, input);
    await this.restartAnalyzers(cameraId);
    return zone;
  }

  async updateZone(cameraId: string, zoneId: number, input: Partial<Omit<MotionZone, 'id' | 'cameraId' | 'updatedAt'>>): Promise<MotionZone> {
    this.ensureUsbCamera(cameraId);
    const zone = this.motion.updateZone(cameraId, zoneId, input);
    await this.restartAnalyzers(cameraId);
    return zone;
  }

  async deleteZone(cameraId: string, zoneId: number): Promise<boolean> {
    this.ensureUsbCamera(cameraId);
    const deleted = this.motion.deleteZone(cameraId, zoneId);
    if (deleted) await this.restartAnalyzers(cameraId);
    return deleted;
  }

  async updateSettings(cameraId: string, input: Partial<Omit<MotionSettings, 'cameraId' | 'updatedAt'>>): Promise<MotionRuntimeSnapshot> {
    const camera = this.cameras.get(cameraId);
    if (!camera) throw Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' });
    if (input.enabled && camera.source_type !== 'usb') {
      throw Object.assign(new Error('P0.16.1 motion detection is qualified for USB cameras only. RTSP motion analysis will be qualified with real network-camera hardware later.'), { code: 'MOTION_SOURCE_UNSUPPORTED' });
    }
    const previous = this.motion.getSettings(cameraId);
    const next = this.motion.updateSettings(cameraId, input);
    this.clearCameraRetry(cameraId);
    this.lastErrors.delete(cameraId);
    if (!next.enabled) await this.stopCameraWorkers(cameraId);
    if (next.enabled && (!previous.enabled || previous.sensitivity !== next.sensitivity)) await this.restartAnalyzers(cameraId);
    return this.runtime(cameraId);
  }

  runtime(cameraId: string): MotionRuntimeSnapshot {
    const camera = this.cameras.get(cameraId);
    const settings = this.motion.getSettings(cameraId);
    const zones = this.motion.listZones(cameraId);
    const workers = [...this.runtimes.values()].filter((item) => item.cameraId === cameraId && item.process.exitCode === null);
    const startedAt = workers.map((item) => item.startedAt).sort()[0] || null;
    const lastMs = Math.max(0, ...[...this.lastDetectedAt.entries()].filter(([key]) => key.startsWith(`${cameraId}::`)).map(([, value]) => value));
    return {
      cameraId,
      supported: camera?.source_type === 'usb',
      enabled: settings.enabled,
      active: workers.length > 0,
      pid: workers[0]?.process.pid ?? null,
      analyzerCount: workers.length,
      activeZoneCount: zones.filter((zone) => zone.enabled).length,
      startedAt,
      lastDetectedAt: lastMs ? new Date(lastMs).toISOString() : null,
      lastScore: this.lastScores.get(cameraId) ?? null,
      lastError: this.lastErrors.get(cameraId) ?? workers.find((item) => item.lastError)?.lastError ?? null,
      threshold: this.thresholdFor(settings.sensitivity),
      settings,
      zones,
    };
  }

  runtimesSnapshot(): MotionRuntimeSnapshot[] { return this.cameras.list().map((camera) => this.runtime(camera.id)); }

  context(eventId: number): MotionEventContext | null {
    const detection = this.motion.getDetection(eventId);
    if (!detection) return null;
    return {
      eventId,
      cameraId: detection.camera_id,
      detectedAt: detection.detected_at,
      sceneScore: detection.scene_score,
      sensitivity: detection.sensitivity,
      zoneId: detection.zone_id,
      zoneName: detection.zone_name,
      snapshotUrl: detection.snapshot_path ? `/api/v1/events/${eventId}/snapshot` : null,
      review: this.motion.getReview(eventId),
    };
  }

  review(eventId: number, status: MotionReviewStatus, note = ''): MotionReview {
    if (!this.motion.getDetection(eventId)) throw Object.assign(new Error('Motion event not found.'), { code: 'NOT_FOUND' });
    return this.motion.setReview(eventId, status, note);
  }

  async snapshotPath(eventId: number): Promise<string | null> {
    const detection = this.motion.getDetection(eventId);
    if (!detection?.snapshot_path) return null;
    const root = path.resolve(this.snapshotRoot);
    const candidate = path.resolve(root, detection.snapshot_path);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
    try { const stat = await fs.stat(candidate); return stat.isFile() && stat.size > 0 ? candidate : null; }
    catch { return null; }
  }

  async linkEvent(eventId: number): Promise<number[]> {
    const detection = this.motion.getDetection(eventId);
    if (!detection) return [];
    const start = new Date(Date.parse(detection.detected_at) - detection.pre_seconds * 1000).toISOString();
    const end = new Date(Date.parse(detection.detected_at) + detection.post_seconds * 1000).toISOString();
    for (const row of this.recordings.listOverlapping(detection.camera_id, start, end)) this.motion.linkRecording(eventId, row.id);
    return this.motion.linkedRecordingIds(eventId);
  }

  linkedRecordingIds(eventId: number): number[] { return this.motion.linkedRecordingIds(eventId); }

  private async tick(): Promise<void> {
    try { await this.supervise(); } catch (error: any) { logLine('motion', 'WARN', `Motion supervisor failed: ${error?.message || String(error)}`); }
    try { await this.linkRecentDetections(); } catch (error: any) { logLine('motion', 'WARN', `Motion-to-recording linking failed: ${error?.message || String(error)}`); }
  }

  private ensureUsbCamera(cameraId: string): void {
    const camera = this.cameras.get(cameraId);
    if (!camera) throw Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' });
    if (camera.source_type !== 'usb') throw Object.assign(new Error('P0.16.1 motion zones are qualified for USB cameras only.'), { code: 'MOTION_SOURCE_UNSUPPORTED' });
  }

  private targetKey(cameraId: string, zone: MotionZone | null): string { return `${cameraId}::${zone ? `zone:${zone.id}` : 'global'}`; }

  private desiredTargets(cameraId: string): Array<MotionZone | null> {
    const zones = this.motion.listZones(cameraId);
    if (zones.length === 0) return [null];
    return zones.filter((zone) => zone.enabled);
  }

  private async supervise(): Promise<void> {
    if (this.shuttingDown) return;
    for (const camera of this.cameras.list()) {
      const settings = this.motion.getSettings(camera.id);
      const live = this.cameraProcesses.runtime(camera.id);
      const shouldRun = settings.enabled && camera.source_type === 'usb' && camera.enabled && live.state === 'online' && live.streamReady && Boolean(camera.stream?.path);
      const targets = shouldRun ? this.desiredTargets(camera.id) : [];
      const desiredKeys = new Set(targets.map((zone) => this.targetKey(camera.id, zone)));
      for (const [key, runtime] of [...this.runtimes.entries()]) {
        if (runtime.cameraId === camera.id && !desiredKeys.has(key)) await this.stopWorker(key);
      }
      if (!shouldRun) continue;
      for (const zone of targets) {
        const key = this.targetKey(camera.id, zone);
        if (this.runtimes.has(key)) continue;
        if ((this.retryAt.get(key) || 0) > Date.now()) continue;
        try { await this.startWorker(camera.id, settings, zone); }
        catch (error: any) {
          const message = error?.message || String(error);
          this.lastErrors.set(camera.id, message);
          this.retryAt.set(key, Date.now() + 30_000);
          logLine('motion', 'WARN', `[${camera.id}] Motion analyzer start deferred${zone ? ` for zone ${zone.name}` : ''}: ${message}`);
        }
      }
    }
  }

  private async startWorker(cameraId: string, settings: MotionSettings, zone: MotionZone | null): Promise<void> {
    const key = this.targetKey(cameraId, zone);
    if (this.shuttingDown || this.runtimes.has(key)) return;
    const camera = this.cameras.get(cameraId);
    if (!camera?.stream?.path) throw new Error('Camera stream path is unavailable.');
    const ffmpeg = await findFfmpegPath();
    if (!ffmpeg) throw new Error('FFmpeg was not found.');
    const input = this.internalRtspUrl(camera.stream.path);
    const sensitivity = zone?.sensitivity ?? settings.sensitivity;
    const threshold = this.thresholdFor(sensitivity);
    const filters: string[] = ['fps=2'];
    if (zone) filters.push(`crop=iw*${(zone.width / 100).toFixed(4)}:ih*${(zone.height / 100).toFixed(4)}:iw*${(zone.x / 100).toFixed(4)}:ih*${(zone.y / 100).toFixed(4)}`);
    filters.push('scale=320:-2', `select='gt(scene,${threshold.toFixed(4)})'`, 'metadata=print:key=lavfi.scene_score');
    const args = ['-hide_banner', '-loglevel', 'info', '-rtsp_transport', 'tcp', '-i', input, '-map', '0:v:0', '-an', '-vf', filters.join(','), '-f', 'null', '-'];
    const child = spawn(ffmpeg, args, { windowsHide: true });
    const runtime: MotionRuntimeInternal = { key, cameraId, zone, sensitivity, process: child, startedAt: isoNow(), stopping: false, lineBuffer: '', lastError: null };
    this.runtimes.set(key, runtime);
    this.lastErrors.delete(cameraId);
    this.retryAt.delete(key);
    child.stderr.on('data', (chunk) => this.consumeOutput(runtime, String(chunk)));
    child.once('error', (error) => this.handleExit(runtime, `Motion analyzer process error: ${error.message}`));
    child.once('exit', () => this.handleExit(runtime, 'Motion analyzer exited.'));
    logLine('motion', 'INFO', `[${cameraId}] Motion analyzer started${zone ? ` for zone ${zone.name}` : ' for full frame'}; sensitivity=${sensitivity}, threshold=${threshold.toFixed(4)}, cooldown=${settings.cooldownSeconds}s.`);
  }

  private consumeOutput(runtime: MotionRuntimeInternal, chunk: string): void {
    runtime.lineBuffer += chunk;
    const lines = runtime.lineBuffer.split(/\r?\n/);
    runtime.lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const match = line.match(/lavfi\.scene_score=([0-9.]+)/);
      if (!match) continue;
      const score = Number(match[1]);
      if (!Number.isFinite(score)) continue;
      void this.handleDetection(runtime, score);
    }
  }

  private async handleDetection(runtime: MotionRuntimeInternal, score: number): Promise<void> {
    const cameraId = runtime.cameraId;
    const settings = this.motion.getSettings(cameraId);
    if (!settings.enabled || this.shuttingDown) return;
    const now = Date.now();
    const cooldownKey = runtime.key;
    const last = this.lastDetectedAt.get(cooldownKey) || 0;
    if (now - last < settings.cooldownSeconds * 1000) return;
    this.lastDetectedAt.set(cooldownKey, now);
    this.lastScores.set(cameraId, score);
    const detectedAt = new Date(now).toISOString();
    const camera = this.cameras.get(cameraId);
    if (camera) this.cameras.patch(cameraId, { lastMotion: new Date(now).toLocaleTimeString() });
    const event = this.events.motionDetected(cameraId, score, runtime.sensitivity, detectedAt, settings.preSeconds, settings.postSeconds, runtime.zone?.name ?? null, runtime.zone?.id ?? null);
    if (!event) return;
    this.motion.createDetection({ eventId: event.id, cameraId, detectedAt, sceneScore: score, settings, zone: runtime.zone });
    await Promise.allSettled([this.linkEvent(event.id), this.captureSnapshot(cameraId, event.id, runtime.zone)]);
  }

  private async captureSnapshot(cameraId: string, eventId: number, zone: MotionZone | null): Promise<void> {
    const camera = this.cameras.get(cameraId);
    if (!camera?.stream?.path) return;
    const ffmpeg = await findFfmpegPath();
    if (!ffmpeg) return;
    const cameraDir = safePart(cameraId);
    const relative = path.join(cameraDir, `${eventId}.jpg`);
    const directory = path.join(this.snapshotRoot, cameraDir);
    const finalPath = path.join(this.snapshotRoot, relative);
    const tempPath = path.join(directory, `${eventId}.tmp.jpg`);
    await fs.mkdir(directory, { recursive: true });
    const filters: string[] = [];
    if (zone) filters.push(`drawbox=x=iw*${(zone.x / 100).toFixed(4)}:y=ih*${(zone.y / 100).toFixed(4)}:w=iw*${(zone.width / 100).toFixed(4)}:h=ih*${(zone.height / 100).toFixed(4)}:color=yellow@0.95:t=3`);
    filters.push('scale=640:-2');
    const args = ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', this.internalRtspUrl(camera.stream.path), '-map', '0:v:0', '-an', '-frames:v', '1', '-q:v', '3', '-vf', filters.join(','), '-y', tempPath];
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpeg, args, { windowsHide: true });
        const timeout = setTimeout(() => { try { child.kill('SIGTERM'); } catch {}; reject(new Error('Snapshot capture timed out.')); }, 8_000);
        timeout.unref?.();
        child.once('error', reject);
        child.once('exit', (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Snapshot FFmpeg exited with code ${code}.`)); });
      });
      const stat = await fs.stat(tempPath);
      if (!stat.size) throw new Error('Snapshot file is empty.');
      await fs.rename(tempPath, finalPath);
      this.motion.setSnapshotPath(eventId, relative);
    } catch (error: any) {
      try { await fs.rm(tempPath, { force: true }); } catch {}
      logLine('motion', 'WARN', `[${cameraId}] Snapshot capture failed for event ${eventId}: ${error?.message || String(error)}`);
    }
  }

  private internalRtspUrl(streamPath: string): string {
    const base = new URL(this.media.rtspBase);
    base.username = '_cctv_recorder';
    base.password = this.credentials.internalSecret('mediamtx-recorder');
    return `${base.toString().replace(/\/$/, '')}/${streamPath}`;
  }

  private handleExit(runtime: MotionRuntimeInternal, message: string): void {
    this.runtimes.delete(runtime.key);
    if (runtime.stopping || this.shuttingDown) return;
    runtime.lastError = message;
    this.lastErrors.set(runtime.cameraId, message);
    this.retryAt.set(runtime.key, Date.now() + 30_000);
    logLine('motion', 'WARN', `[${runtime.cameraId}] ${message}${runtime.zone ? ` (${runtime.zone.name})` : ''}`);
  }

  private async stopWorker(key: string): Promise<void> {
    const rt = this.runtimes.get(key);
    if (!rt) return;
    rt.stopping = true;
    this.runtimes.delete(key);
    if (rt.process.exitCode !== null) return;
    try { rt.process.stdin.write('q\n'); } catch {}
    const soft = setTimeout(() => { if (rt.process.exitCode === null) { try { rt.process.kill('SIGTERM'); } catch {} } }, 1500);
    soft.unref?.();
  }

  private async stopCameraWorkers(cameraId: string): Promise<void> {
    for (const [key, runtime] of [...this.runtimes.entries()]) if (runtime.cameraId === cameraId) await this.stopWorker(key);
  }

  private async restartAnalyzers(cameraId: string): Promise<void> {
    await this.stopCameraWorkers(cameraId);
    this.clearCameraRetry(cameraId);
    await this.supervise();
  }

  private clearCameraRetry(cameraId: string): void {
    for (const key of [...this.retryAt.keys()]) if (key.startsWith(`${cameraId}::`)) this.retryAt.delete(key);
  }

  private async linkRecentDetections(): Promise<void> {
    for (const detection of this.motion.listRecentDetections(3600)) await this.linkEvent(detection.event_id);
  }

  private async cleanupOrphanSnapshots(): Promise<void> {
    const referenced = new Set(this.motion.listSnapshotPaths().map((value) => path.normalize(value)));
    let cameraDirs: string[] = [];
    try { cameraDirs = await fs.readdir(this.snapshotRoot); } catch { return; }
    for (const cameraDir of cameraDirs) {
      const dir = path.join(this.snapshotRoot, cameraDir);
      let entries: string[] = [];
      try { entries = await fs.readdir(dir); } catch { continue; }
      for (const name of entries) {
        if (!/\.jpg$/i.test(name)) continue;
        const relative = path.join(cameraDir, name);
        if (!referenced.has(path.normalize(relative))) { try { await fs.rm(path.join(dir, name), { force: true }); } catch {} }
      }
    }
  }

  private thresholdFor(sensitivity: number): number {
    return clamp(0.21 - clamp(sensitivity, 1, 100) * 0.002, 0.01, 0.20);
  }
}
