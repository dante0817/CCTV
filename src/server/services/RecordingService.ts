import fs from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { findFfmpegPath } from '../dshowEnumerator';
import { CameraRepository } from '../repositories/CameraRepository';
import { RecordingRepository, type RecordingSegmentRow, type RecordingRetentionPolicy, type RecordingHealthSummary, type RecordingQuarantineRow } from '../repositories/RecordingRepository';
import { CameraProcessManager } from './CameraProcessManager';
import { MediaMtxService } from './MediaMtxService';
import { StorageService } from './StorageService';
import { logLine } from './LoggingService';
import { CredentialService } from './CredentialService';

interface RecorderRuntime {
  cameraId: string;
  process: ChildProcessWithoutNullStreams;
  startedAt: string;
  stopping: boolean;
  lastError: string | null;
}

export interface RecordingRuntimeSnapshot {
  cameraId: string;
  desired: boolean;
  supported: boolean;
  active: boolean;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  directory: string;
}

export interface RecordingSummary {
  supported: true;
  active: boolean;
  activeCount: number;
  desiredCount: number;
  segmentCount: number;
  bytes: number;
}

export interface RecordingRetentionRunResult {
  enabled: boolean;
  ranAt: string;
  deletedCount: number;
  deletedBytes: number;
  beforeBytes: number;
  afterBytes: number;
  freeBytesBefore: number | null;
  freeBytesAfterEstimate: number | null;
  reason: 'disabled' | 'no_action' | 'policy';
}

export interface RecordingReconcileResult {
  checkedAt: string;
  health: RecordingHealthSummary;
  quarantined: RecordingQuarantineRow[];
}

type RecordingEvent = (kind: 'started' | 'stopped' | 'error', cameraId: string, message?: string | null) => void;

function safeId(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '-'); }
function isoNow(): string { return new Date().toISOString(); }
function redactMediaError(text: string): string { return String(text || '').replace(/rtsp:\/\/[^\s@]+@/gi, 'rtsp://***@'); }

export class RecordingService {
  private runtimes = new Map<string, RecorderRuntime>();
  private scanTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private retryAt = new Map<string, number>();
  private failures = new Map<string, number>();
  private lastErrors = new Map<string, string>();
  private lastErrorEventAt = new Map<string, number>();
  // Files that were newest and unindexed at process startup may be remnants of an abnormal shutdown.
  // Keep them on disk, but never advertise them as playable until a future repair workflow validates them.
  private startupExcludedPaths = new Set<string>();
  private segmentSeconds = Math.max(30, Math.min(3600, Number(process.env.CCTV_RECORDING_SEGMENT_SECONDS || 60)));
  private lastRetentionRunAt = 0;
  private retentionIntervalMs = 60_000;

  constructor(
    private cameras: CameraRepository,
    private recordings: RecordingRepository,
    private cameraProcesses: CameraProcessManager,
    private media: MediaMtxService,
    private storage: StorageService,
    private credentials: CredentialService,
    private onEvent?: RecordingEvent,
  ) {}

  async startSupervisor(): Promise<void> {
    this.shuttingDown = false;
    await fs.mkdir(this.storage.recordingPath, { recursive: true });
    await this.captureStartupExclusions();
    await this.scanAll(true);
    await this.supervise();
    if (!this.scanTimer) {
      this.scanTimer = setInterval(() => void this.scanAndSupervise(), 10000);
      this.scanTimer.unref?.();
    }
  }

  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    for (const cameraId of [...this.runtimes.keys()]) await this.stopWorker(cameraId, false, false);
    this.retryAt.clear();
    await this.scanAll(false);
  }

  async setContinuous(cameraId: string, enabled: boolean): Promise<RecordingRuntimeSnapshot> {
    const camera = this.cameras.get(cameraId);
    if (!camera) throw Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' });
    if (camera.source_type !== 'usb') throw Object.assign(new Error('P0.16.1 recording remains qualified for USB cameras only. RTSP recording will be qualified in a later release.'), { code: 'RECORDING_SOURCE_UNSUPPORTED' });
    if (enabled) {
      this.cameras.patch(cameraId, { recording: true, recordingMode: 'continuous' });
      this.retryAt.delete(cameraId);
      this.failures.delete(cameraId);
      this.lastErrors.delete(cameraId);
      const live = this.cameraProcesses.runtime(cameraId);
      if (camera.enabled && live.state === 'online' && live.streamReady) await this.ensureWorker(cameraId);
    } else {
      this.cameras.patch(cameraId, { recording: false, recordingMode: 'disabled' });
      this.retryAt.delete(cameraId);
      this.failures.delete(cameraId);
      this.lastErrors.delete(cameraId);
      await this.stopWorker(cameraId, true, true);
    }
    return this.runtime(cameraId);
  }

  runtime(cameraId: string): RecordingRuntimeSnapshot {
    const camera = this.cameras.get(cameraId);
    const rt = this.runtimes.get(cameraId);
    return {
      cameraId,
      desired: Boolean(camera?.recording && camera.recordingMode === 'continuous'),
      supported: camera?.source_type === 'usb',
      active: Boolean(rt && rt.process.exitCode === null),
      pid: rt?.process.pid ?? null,
      startedAt: rt?.startedAt ?? null,
      lastError: rt?.lastError ?? this.lastErrors.get(cameraId) ?? null,
      directory: this.cameraDirectory(cameraId),
    };
  }

  runtimesSnapshot(): RecordingRuntimeSnapshot[] { return this.cameras.list().map((camera) => this.runtime(camera.id)); }

  summary(cameraIds?: string[] | null): RecordingSummary {
    const allow = cameraIds ? new Set(cameraIds) : null;
    const all = this.cameras.list().filter((camera) => !allow || allow.has(camera.id));
    const indexed = this.recordings.summary(cameraIds);
    const activeCount = all.filter((camera) => this.runtimes.has(camera.id)).length;
    return {
      supported: true,
      active: activeCount > 0,
      activeCount,
      desiredCount: all.filter((camera) => camera.recording && camera.recordingMode === 'continuous').length,
      segmentCount: indexed.count,
      bytes: indexed.bytes,
    };
  }

  list(cameraId?: string | null, date?: string | null, limit = 250, protectedOnly = false): RecordingSegmentRow[] {
    return this.recordings.list({ cameraId, date, limit, protectedOnly });
  }

  get(id: number): RecordingSegmentRow | null { return this.recordings.get(id); }
  policy(): RecordingRetentionPolicy { return this.recordings.getPolicy(); }
  updatePolicy(input: Partial<Omit<RecordingRetentionPolicy, 'updatedAt'>>): RecordingRetentionPolicy { return this.recordings.updatePolicy(input); }
  health(): RecordingHealthSummary { return this.recordings.health(); }
  quarantine(limit = 250): RecordingQuarantineRow[] { return this.recordings.listQuarantine(limit); }

  protect(id: number, value: boolean): RecordingSegmentRow {
    const row = this.recordings.get(id);
    if (!row) throw Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' });
    const updated = this.recordings.setProtected(id, value);
    if (!updated) throw Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' });
    return updated;
  }

  async deleteSegment(id: number): Promise<{ row: RecordingSegmentRow; deletedFile: boolean }> {
    const row = this.recordings.get(id);
    if (!row) throw Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' });
    if (row.is_protected) throw Object.assign(new Error('Protected recordings must be unlocked before deletion.'), { code: 'RECORDING_PROTECTED' });
    const file = this.safeRecordingFile(row.file_path);
    let deletedFile = false;
    try { await fs.unlink(file); deletedFile = true; }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    this.recordings.deleteRow(id);
    this.storage.invalidateRecordingSizeCache();
    return { row, deletedFile };
  }

  async deleteSegments(ids: number[]): Promise<{ deletedCount: number; deletedBytes: number; skippedProtected: number; missing: number }> {
    let deletedCount = 0; let deletedBytes = 0; let skippedProtected = 0; let missing = 0;
    for (const id of [...new Set(ids.filter((value) => Number.isInteger(value) && value > 0))]) {
      const row = this.recordings.get(id);
      if (!row) { missing += 1; continue; }
      if (row.is_protected) { skippedProtected += 1; continue; }
      const result = await this.deleteSegment(id);
      deletedCount += 1; deletedBytes += result.row.size_bytes;
    }
    return { deletedCount, deletedBytes, skippedProtected, missing };
  }

  async reconcile(): Promise<RecordingReconcileResult> {
    for (const camera of this.cameras.list()) await this.scanCamera(camera.id, this.runtimes.has(camera.id));
    for (const row of this.recordings.listAll()) await this.verifyFile(row);
    for (const item of this.recordings.listQuarantine(5000)) {
      try { await fs.access(this.safeRecordingFile(item.file_path)); }
      catch { this.recordings.removeQuarantine(item.file_path); this.startupExcludedPaths.delete(path.resolve(item.file_path)); }
    }
    return { checkedAt: isoNow(), health: this.recordings.health(), quarantined: this.recordings.listQuarantine(250) };
  }

  async runRetention(): Promise<RecordingRetentionRunResult> {
    const policy = this.recordings.getPolicy();
    const before = this.recordings.summary().bytes;
    const storage = await this.storage.status();
    const base = { enabled: policy.enabled, ranAt: isoNow(), deletedCount: 0, deletedBytes: 0, beforeBytes: before, afterBytes: before, freeBytesBefore: storage.freeBytes, freeBytesAfterEstimate: storage.freeBytes };
    if (!policy.enabled) return { ...base, reason: 'disabled' };
    const candidates = this.recordings.listRetentionCandidates();
    const cutoff = policy.maxAgeDays > 0 ? Date.now() - policy.maxAgeDays * 86_400_000 : null;
    let indexedBytes = before;
    let freeEstimate = storage.freeBytes;
    let deletedCount = 0; let deletedBytes = 0;
    for (const row of candidates) {
      const oldEnough = cutoff != null && Date.parse(row.started_at) < cutoff;
      const overStorage = policy.maxStorageBytes > 0 && indexedBytes > policy.maxStorageBytes;
      const lowFree = policy.minFreeBytes > 0 && freeEstimate != null && freeEstimate < policy.minFreeBytes;
      if (!oldEnough && !overStorage && !lowFree) continue;
      try {
        const result = await this.deleteSegment(row.id);
        deletedCount += 1; deletedBytes += result.row.size_bytes;
        indexedBytes = Math.max(0, indexedBytes - result.row.size_bytes);
        if (freeEstimate != null) freeEstimate += result.row.size_bytes;
      } catch (error: any) {
        logLine('recording', 'WARN', `Retention skipped recording ${row.id}: ${error?.message || String(error)}`);
      }
    }
    this.lastRetentionRunAt = Date.now();
    return { enabled: policy.enabled, ranAt: isoNow(), deletedCount, deletedBytes, beforeBytes: before, afterBytes: indexedBytes, freeBytesBefore: storage.freeBytes, freeBytesAfterEstimate: freeEstimate, reason: deletedCount ? 'policy' : 'no_action' };
  }

  async hasRecordingFiles(cameraId: string): Promise<boolean> {
    const dir = this.cameraDirectory(cameraId);
    try {
      const entries = await fs.readdir(dir);
      return entries.some((name) => /^segment-\d{8}T\d{6}\.mp4$/i.test(name));
    } catch { return false; }
  }

  async verifyFile(row: RecordingSegmentRow): Promise<RecordingSegmentRow | null> {
    let file: string;
    try { file = this.safeRecordingFile(row.file_path); } catch { return this.recordings.markMissing(row.id); }
    try {
      const stat = await fs.stat(file);
      if (stat.size <= 0 || !(await this.looksLikeMp4(file))) return this.recordings.markStatus(row.id, 'corrupt');
      if (row.status !== 'complete') return this.recordings.markStatus(row.id, 'complete');
      return { ...row, file_path: file };
    } catch { return this.recordings.markMissing(row.id); }
  }

  async supervise(): Promise<void> {
    if (this.shuttingDown) return;
    for (const camera of this.cameras.list()) {
      const desired = camera.recording && camera.recordingMode === 'continuous';
      const rt = this.runtimes.get(camera.id);
      if (!desired || camera.source_type !== 'usb') {
        if (rt) await this.stopWorker(camera.id, false, false);
        continue;
      }
      const live = this.cameraProcesses.runtime(camera.id);
      if (!camera.enabled || live.state !== 'online' || !live.streamReady) {
        if (rt) await this.stopWorker(camera.id, false, false);
        continue;
      }
      if (rt) {
        if (Date.now() - Date.parse(rt.startedAt) >= 60_000) { this.failures.delete(camera.id); this.retryAt.delete(camera.id); }
        continue;
      }
      const retryAt = this.retryAt.get(camera.id) || 0;
      if (retryAt > Date.now()) continue;
      try { await this.ensureWorker(camera.id); }
      catch (error: any) {
        const message = redactMediaError(error?.message || String(error));
        this.scheduleRetry(camera.id, message);
        logLine('recording', 'WARN', `[${camera.id}] Recorder start deferred: ${message}`);
      }
    }
  }

  private async scanAndSupervise(): Promise<void> {
    try { await this.scanAll(true); } catch (error: any) { logLine('recording', 'WARN', `Recording index scan failed: ${error?.message || String(error)}`); }
    try { await this.supervise(); } catch (error: any) { logLine('recording', 'WARN', `Recording supervisor failed: ${error?.message || String(error)}`); }
    if (Date.now() - this.lastRetentionRunAt >= this.retentionIntervalMs) {
      this.lastRetentionRunAt = Date.now();
      try { if (this.recordings.getPolicy().enabled) await this.runRetention(); }
      catch (error: any) { logLine('recording', 'WARN', `Retention run failed: ${error?.message || String(error)}`); }
    }
  }

  private async ensureWorker(cameraId: string): Promise<void> {
    if (this.shuttingDown || this.runtimes.has(cameraId)) return;
    const camera = this.cameras.get(cameraId);
    if (!camera) throw new Error('Camera not found.');
    if (camera.source_type !== 'usb') throw Object.assign(new Error('Continuous recording MVP supports USB cameras only.'), { code: 'RECORDING_SOURCE_UNSUPPORTED' });
    const live = this.cameraProcesses.runtime(cameraId);
    if (!camera.enabled || live.state !== 'online' || !live.streamReady || !camera.stream?.path) {
      throw Object.assign(new Error('Camera stream is not ready. Recording will start automatically after the camera is online.'), { code: 'CAMERA_STREAM_NOT_READY' });
    }
    const ffmpeg = await findFfmpegPath();
    if (!ffmpeg) throw Object.assign(new Error('FFmpeg was not found.'), { code: 'FFMPEG_NOT_FOUND' });
    await fs.mkdir(this.cameraDirectory(cameraId), { recursive: true });
    const outputPattern = path.join(this.cameraDirectory(cameraId), 'segment-%Y%m%dT%H%M%S.mp4');
    const recorderUser = '_cctv_recorder';
    const recorderPassword = this.credentials.internalSecret('mediamtx-recorder');
    const base = new URL(this.media.rtspBase);
    base.username = recorderUser;
    base.password = recorderPassword;
    const input = `${base.toString().replace(/\/$/, '')}/${camera.stream.path}`;
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-rtsp_transport', 'tcp', '-i', input,
      '-map', '0:v:0', '-an', '-c:v', 'copy',
      '-f', 'segment', '-segment_time', String(this.segmentSeconds),
      '-reset_timestamps', '1', '-strftime', '1',
      '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
      outputPattern,
    ];
    const child = spawn(ffmpeg, args, { windowsHide: true });
    const runtime: RecorderRuntime = { cameraId, process: child, startedAt: isoNow(), stopping: false, lastError: null };
    this.runtimes.set(cameraId, runtime);
    this.lastErrors.delete(cameraId);
    let stderr = '';
    let failureHandled = false;
    const handleUnexpected = (rawMessage: string) => {
      if (failureHandled || runtime.stopping || this.shuttingDown) return;
      failureHandled = true;
      this.runtimes.delete(cameraId);
      const message = redactMediaError(rawMessage || 'Recorder process exited unexpectedly.');
      runtime.lastError = message;
      this.lastErrors.set(cameraId, message);
      this.scheduleRetry(cameraId, message);
      logLine('recording', 'WARN', `[${cameraId}] ${message}`);
      const lastEvent = this.lastErrorEventAt.get(cameraId) || 0;
      if (Date.now() - lastEvent >= 60_000) { this.lastErrorEventAt.set(cameraId, Date.now()); this.onEvent?.('error', cameraId, message); }
    };
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.once('error', (error) => handleUnexpected(`Recorder process error: ${error.message}`));
    child.once('exit', (_code, _signal) => {
      this.runtimes.delete(cameraId);
      if (runtime.stopping || this.shuttingDown) return;
      handleUnexpected(stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || 'Recorder process exited unexpectedly.');
    });
    logLine('recording', 'INFO', `[${cameraId}] Continuous recording started from MediaMTX path ${camera.stream.path}; segment=${this.segmentSeconds}s.`);
    this.onEvent?.('started', cameraId, null);
  }

  private async stopWorker(cameraId: string, userRequested: boolean, emitEvent: boolean): Promise<void> {
    const rt = this.runtimes.get(cameraId);
    if (!rt) return;
    rt.stopping = true;
    await this.terminate(rt.process);
    this.runtimes.delete(cameraId);
    await this.scanCamera(cameraId, false);
    logLine('recording', 'INFO', `[${cameraId}] Recorder stopped${userRequested ? ' by configuration' : ''}.`);
    if (emitEvent) this.onEvent?.('stopped', cameraId, null);
  }

  private scheduleRetry(cameraId: string, message: string): void {
    if (this.shuttingDown) return;
    this.lastErrors.set(cameraId, message);
    const count = Math.min(10, (this.failures.get(cameraId) || 0) + 1);
    this.failures.set(cameraId, count);
    const delays = [5000, 15000, 30000, 60000, 120000];
    const delay = delays[Math.min(delays.length - 1, count - 1)];
    this.retryAt.set(cameraId, Date.now() + delay);
  }

  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      child.once('exit', finish);
      try { child.stdin.write('q\n'); } catch {}
      const softTimer = setTimeout(() => {
        if (child.exitCode === null) { try { child.kill('SIGTERM'); } catch {} }
      }, 2500);
      softTimer.unref?.();
      const hardTimer = setTimeout(() => { if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch {} } finish(); }, 5000);
      hardTimer.unref?.();
    });
  }

  private cameraDirectory(cameraId: string): string { return path.join(this.storage.recordingPath, safeId(cameraId)); }

  private safeRecordingFile(filePath: string): string {
    const root = path.resolve(this.storage.recordingPath);
    const file = path.resolve(filePath);
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('Recording path is outside the configured recording directory.'), { code: 'UNSAFE_RECORDING_PATH' });
    return file;
  }


  private async looksLikeMp4(filePath: string): Promise<boolean> {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(64);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      return result.bytesRead >= 12 && buffer.subarray(0, result.bytesRead).includes(Buffer.from('ftyp'));
    } catch { return false; }
    finally { try { await handle?.close(); } catch {} }
  }

  private async captureStartupExclusions(): Promise<void> {
    this.startupExcludedPaths.clear();
    for (const camera of this.cameras.list()) {
      const dir = this.cameraDirectory(camera.id);
      let entries: string[];
      try { entries = (await fs.readdir(dir)).filter((name) => /^segment-\d{8}T\d{6}\.mp4$/i.test(name)).sort(); }
      catch { continue; }
      const newest = entries.at(-1);
      if (!newest) continue;
      const fullPath = path.join(dir, newest);
      // If it was already indexed by a clean prior shutdown, it is trusted.
      if (!this.recordings.getByPath(fullPath)) {
        this.startupExcludedPaths.add(path.resolve(fullPath));
        let sizeBytes = 0; try { sizeBytes = Number((await fs.stat(fullPath)).size); } catch {}
        this.recordings.addQuarantine({ cameraId: camera.id, filePath: path.resolve(fullPath), reason: 'startup_unverified_latest_segment', sizeBytes });
      }
    }
  }

  private async scanAll(skipNewestForAll: boolean): Promise<void> {
    for (const camera of this.cameras.list()) await this.scanCamera(camera.id, skipNewestForAll || this.runtimes.has(camera.id));
  }

  private parseStart(fileName: string, fallbackMs: number): Date {
    const match = fileName.match(/^segment-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.mp4$/i);
    if (!match) return new Date(fallbackMs);
    const [, y, mo, d, h, mi, s] = match;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  }

  private async scanCamera(cameraId: string, skipNewest: boolean): Promise<void> {
    const camera = this.cameras.get(cameraId);
    if (!camera) return;
    const dir = this.cameraDirectory(cameraId);
    let entries: string[];
    try { entries = (await fs.readdir(dir)).filter((name) => /^segment-\d{8}T\d{6}\.mp4$/i.test(name)).sort(); }
    catch { return; }
    const stats = await Promise.all(entries.map(async (name) => ({ name, stat: await fs.stat(path.join(dir, name)) })));
    for (let i = 0; i < stats.length; i += 1) {
      if (skipNewest && i === stats.length - 1) continue;
      const current = stats[i];
      const fullPath = path.resolve(path.join(dir, current.name));
      if (this.startupExcludedPaths.has(fullPath) && !this.recordings.getByPath(fullPath)) continue;
      if (current.stat.size <= 0) { this.recordings.addQuarantine({ cameraId, filePath: fullPath, reason: 'empty_recording_file', sizeBytes: current.stat.size }); continue; }
      if (!(await this.looksLikeMp4(fullPath))) { this.recordings.addQuarantine({ cameraId, filePath: fullPath, reason: 'invalid_mp4_signature', sizeBytes: current.stat.size }); continue; }
      const started = this.parseStart(current.name, current.stat.birthtimeMs || current.stat.mtimeMs);
      const next = stats[i + 1];
      const ended = next ? this.parseStart(next.name, next.stat.birthtimeMs || next.stat.mtimeMs) : new Date(Math.max(current.stat.mtimeMs, started.getTime() + 1000));
      const duration = Math.max(1, (ended.getTime() - started.getTime()) / 1000);
      this.recordings.upsert({
        cameraId,
        cameraName: camera.name,
        filePath: fullPath,
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
        durationSeconds: duration,
        sizeBytes: current.stat.size,
        status: 'complete',
        codec: 'H.264',
      });
      this.recordings.removeQuarantine(fullPath);
    }
  }
}
