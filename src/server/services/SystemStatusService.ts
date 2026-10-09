import os from 'os';
import { findFfmpegPath } from '../dshowEnumerator';
import { CameraRepository } from '../repositories/CameraRepository';
import { CameraProcessManager } from './CameraProcessManager';
import { MediaMtxService } from './MediaMtxService';
import { StorageService } from './StorageService';
import { RecordingService } from './RecordingService';
import { getRemoteAccessStatus } from './RemoteAccessService';
import type { PublicUser } from '../repositories/AuthRepository';
import type { SystemStatus } from '../../types/cctv';

interface StatusOptions {
  version: string;
  port: number;
  rootDir: string;
  dbPath: string;
  startedAt: number;
  demoMode: boolean;
}

export class SystemStatusService {
  constructor(
    private repo: CameraRepository,
    private cameraProcesses: CameraProcessManager,
    private media: MediaMtxService,
    private storage: StorageService,
    private recordingService: RecordingService,
    private options: StatusOptions,
  ) {}

  async snapshot(user: PublicUser, canAccessCamera: (user: PublicUser, cameraId: string) => boolean): Promise<SystemStatus> {
    const ffmpegPromise = findFfmpegPath();
    const mediaHealthPromise = this.media.health();
    const remotePromise = getRemoteAccessStatus();
    const storagePromise = this.storage.status();
    const [ffmpeg, mediamtx, remoteAccess, storage] = await Promise.all([ffmpegPromise, mediaHealthPromise, remotePromise, storagePromise]);
    const mediaRuntime = this.media.runtimeInfo();
    const recordingSummary = this.recordingService.summary();

    const allowedCameraList = this.repo.list().filter((camera) => canAccessCamera(user, camera.id));
    const allowedIds = new Set(allowedCameraList.map((camera) => camera.id));
    const cameras = (await this.cameraProcesses.allRuntimeWithMedia()).filter((camera) => allowedIds.has(camera.cameraId));
    const activeMediaSessions = cameras.reduce((sum, camera) => sum + (camera.mediaReaders || 0), 0);

    const cameraSummary = {
      total: cameras.length,
      online: cameras.filter((camera) => camera.state === 'online').length,
      offline: cameras.filter((camera) => camera.state === 'offline').length,
      transitional: cameras.filter((camera) => ['configured', 'starting', 'retrying', 'reconnecting', 'degraded'].includes(camera.state)).length,
      disabled: cameras.filter((camera) => camera.state === 'disabled').length,
      error: cameras.filter((camera) => camera.state === 'error').length,
    };

    const [webrtcReachable, hlsReachable] = mediamtx.ok
      ? await Promise.all([this.media.webrtcReachable(), this.media.hlsReachable()])
      : [false, false];

    return {
      version: this.options.version,
      backend: {
        ok: true,
        state: 'healthy',
        port: this.options.port,
        bind: '0.0.0.0',
        browserUrl: `http://localhost:${this.options.port}`,
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        uptimeSeconds: Math.floor((Date.now() - this.options.startedAt) / 1000),
        root: this.options.rootDir,
      },
      ffmpeg: { ok: Boolean(ffmpeg), state: ffmpeg ? 'healthy' : 'unhealthy', path: ffmpeg },
      mediamtx: {
        ok: mediamtx.ok,
        state: mediamtx.ok ? 'healthy' : 'unhealthy',
        installed: Boolean(mediaRuntime.binary),
        binary: mediaRuntime.binary,
        config: mediaRuntime.config,
        startedByApp: mediaRuntime.startedByApp,
        pid: mediaRuntime.pid,
        api: this.media.apiBase,
        rtsp: this.media.rtspBase,
        webrtcPort: 8889,
        hlsPort: 8888,
        iceUdpPort: 8189,
        webrtc: this.media.webrtcBase,
        hls: this.media.hlsBase,
        webrtcReachable,
        hlsReachable,
        auth: 'Short-lived token + live ACL revalidation',
        info: mediamtx.info,
        error: mediamtx.error,
      },
      database: { ok: true, state: 'healthy', engine: 'node:sqlite', path: this.options.dbPath, schemaVersion: this.repo.schemaVersion() },
      remoteAccess,
      cameras,
      cameraSummary,
      activeMediaSessions,
      storage,
      recording: {
        state: recordingSummary.active ? 'recording' : (recordingSummary.desiredCount > 0 ? 'ready' : 'idle'),
        supported: true,
        active: recordingSummary.active,
        activeCount: recordingSummary.activeCount,
        desiredCount: recordingSummary.desiredCount,
        segmentCount: recordingSummary.segmentCount,
        bytes: recordingSummary.bytes,
      },
      features: {
        usb: process.platform === 'win32' ? 'available' : 'unavailable',
        rtsp: 'available',
        onvifDiscovery: 'planned',
        recording: 'available',
        motion: 'available',
        notifications: 'available',
        ai: 'available',
        ptz: 'planned',
        twoWayAudio: 'planned',
      },
      memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, systemFree: os.freemem(), systemTotal: os.totalmem() },
      demoMode: this.options.demoMode,
    };
  }
}
