import type { CameraStatus } from '../../types/cctv';
import type { StorageStatusSnapshot } from './StorageService';
import { CameraRepository } from '../repositories/CameraRepository';
import {
  OperationalEventRepository,
  type OperationalEventCategory,
  type OperationalEventFilter,
  type OperationalEventRow,
  type OperationalEventSeverity,
} from '../repositories/OperationalEventRepository';

export interface CameraStateTransition {
  cameraId: string;
  cameraName: string;
  previousState: CameraStatus;
  previousReason: string | null;
  nextState: CameraStatus;
  reason: string | null;
  occurredAt: string;
  hadBeenOnline: boolean;
  lastOfflineReason: string | null;
  errorMessage?: string | null;
}

export interface ClientOperationalEvent {
  id: string;
  timestamp: string;
  timeOnly: string;
  camera: string;
  cameraId: string;
  eventType: string;
  message: string;
  severity: OperationalEventSeverity;
  category: OperationalEventCategory;
  title: string;
  acknowledgedAt: string | null;
  metadata: Record<string, unknown> | null;
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

export class OperationalEventService {
  private mediaHealthy: boolean | null = null;
  private listeners = new Set<(event: OperationalEventRow) => void>();
  private storageWarningActive = false;
  private cameraOutages = new Set<string>();

  constructor(private events: OperationalEventRepository, private cameras: CameraRepository) {}

  systemStarted(version: string): OperationalEventRow {
    return this.record({
      type: 'SYSTEM_STARTED', category: 'system', severity: 'info', title: 'CCTV Monitor started',
      description: `CCTV Monitor ${version} started.`, metadata: { version },
    });
  }

  cameraTransition(transition: CameraStateTransition): void {
    if (transition.previousState === transition.nextState) return;
    const base = {
      cameraId: transition.cameraId,
      cameraName: transition.cameraName,
      category: 'camera' as const,
      metadata: { previousState: transition.previousState, previousReason: transition.previousReason, nextState: transition.nextState, reason: transition.reason, occurredAt: transition.occurredAt, error: transition.errorMessage || null, lastOfflineReason: transition.lastOfflineReason },
    };

    if (transition.previousState === 'disabled' && transition.nextState === 'starting') {
      this.record({ ...base, type: 'CAMERA_ENABLED', severity: 'info', title: `${transition.cameraName} enabled`, description: `${transition.cameraName} was enabled and is starting.` });
      return;
    }
    if (transition.nextState === 'disabled') {
      this.cameraOutages.delete(transition.cameraId);
      this.record({ ...base, type: 'CAMERA_DISABLED', severity: 'info', title: `${transition.cameraName} disabled`, description: `${transition.cameraName} was disabled.` });
      return;
    }
    if (transition.nextState === 'offline') {
      if (transition.reason === 'APPLICATION_SHUTDOWN' || transition.reason === 'WORKER_STOPPED') return;
      if (this.cameraOutages.has(transition.cameraId)) return;
      this.cameraOutages.add(transition.cameraId);
      this.record({ ...base, type: 'CAMERA_OFFLINE', severity: 'warning', title: `${transition.cameraName} offline`, description: `${transition.cameraName} is offline${transition.reason ? ` (${transition.reason})` : ''}.` });
      return;
    }
    if (transition.nextState === 'error') {
      this.cameraOutages.add(transition.cameraId);
      this.record({ ...base, type: 'CAMERA_ERROR', severity: 'critical', title: `${transition.cameraName} needs attention`, description: `${transition.cameraName} entered an error state${transition.reason ? ` (${transition.reason})` : ''}.` });
      return;
    }
    if (transition.nextState === 'online') {
      const intentionalRestart = transition.lastOfflineReason === 'WORKER_STOPPED' || transition.lastOfflineReason === 'APPLICATION_SHUTDOWN';
      if (transition.hadBeenOnline && intentionalRestart) return;
      const wasOutage = this.cameraOutages.delete(transition.cameraId);
      if (wasOutage && transition.hadBeenOnline) {
        this.record({ ...base, type: 'CAMERA_RECOVERED', severity: 'info', title: `${transition.cameraName} recovered`, description: `${transition.cameraName} recovered and its stream is ready.` });
        return;
      }
      if (!transition.hadBeenOnline) {
        this.record({ ...base, type: 'CAMERA_ONLINE', severity: 'info', title: `${transition.cameraName} online`, description: `${transition.cameraName} stream is online and ready.` });
      }
    }
  }

  observeMediaHealth(ok: boolean, error?: string | null): void {
    const previous = this.mediaHealthy;
    this.mediaHealthy = ok;
    if (previous === null) {
      if (!ok) this.record({ type: 'MEDIAMTX_OFFLINE', category: 'system', severity: 'critical', title: 'Media server unavailable', description: `MediaMTX is unavailable${error ? `: ${error}` : '.'}`, metadata: { error: error || null } });
      return;
    }
    if (previous && !ok) this.record({ type: 'MEDIAMTX_OFFLINE', category: 'system', severity: 'critical', title: 'Media server unavailable', description: `MediaMTX became unavailable${error ? `: ${error}` : '.'}`, metadata: { error: error || null } });
    if (!previous && ok) this.record({ type: 'MEDIAMTX_RECOVERED', category: 'system', severity: 'info', title: 'Media server recovered', description: 'MediaMTX recovered and is responding again.' });
  }

  recordingStarted(cameraId: string): void {
    const camera = this.cameras.get(cameraId);
    if (!camera) return;
    this.record({ cameraId, cameraName: camera.name, type: 'RECORDING_STARTED', category: 'camera', severity: 'info', title: `${camera.name} recording started`, description: `Continuous recording started for ${camera.name}.`, metadata: { mode: 'continuous' } });
  }

  recordingStopped(cameraId: string): void {
    const camera = this.cameras.get(cameraId);
    if (!camera) return;
    this.record({ cameraId, cameraName: camera.name, type: 'RECORDING_STOPPED', category: 'camera', severity: 'info', title: `${camera.name} recording stopped`, description: `Continuous recording stopped for ${camera.name}.`, metadata: { mode: 'continuous' } });
  }

  recordingError(cameraId: string, message?: string | null): void {
    const camera = this.cameras.get(cameraId);
    if (!camera) return;
    this.record({ cameraId, cameraName: camera.name, type: 'RECORDING_ERROR', category: 'camera', severity: 'warning', title: `${camera.name} recording interrupted`, description: `Continuous recording for ${camera.name} was interrupted${message ? `: ${message}` : '.'}`, metadata: { mode: 'continuous', error: message || null } });
  }

  motionDetected(cameraId: string, sceneScore: number, sensitivity: number, detectedAt: string, preSeconds: number, postSeconds: number, zoneName: string | null = null, zoneId: number | null = null): OperationalEventRow | null {
    const camera = this.cameras.get(cameraId);
    if (!camera) return null;
    const zoneSuffix = zoneName ? ` in ${zoneName}` : '';
    return this.record({
      cameraId,
      cameraName: camera.name,
      type: 'MOTION_DETECTED',
      category: 'camera',
      severity: 'info',
      title: `${camera.name} motion detected${zoneName ? ` — ${zoneName}` : ''}`,
      description: `Motion was detected by ${camera.name}${zoneSuffix}.`,
      metadata: { sceneScore, sensitivity, detectedAt, preSeconds, postSeconds, detector: 'ffmpeg-scene-change', zoneId, zoneName },
    });
  }

  aiDetected(cameraId: string, objectType: 'person' | 'vehicle', confidence: number, objectCount: number, classes: string[], detectedAt: string): OperationalEventRow | null {
    const camera = this.cameras.get(cameraId);
    if (!camera) return null;
    const label = objectType === 'person' ? (objectCount === 1 ? 'person' : 'persons') : (objectCount === 1 ? 'vehicle' : 'vehicles');
    const type = objectType === 'person' ? 'PERSON_DETECTED' : 'VEHICLE_DETECTED';
    const classText = classes.length ? ` (${[...new Set(classes)].join(', ')})` : '';
    return this.record({
      cameraId,
      cameraName: camera.name,
      type,
      category: 'camera',
      severity: 'info',
      title: `${camera.name} ${label} detected`,
      description: `${objectCount} ${label} detected by ${camera.name}${classText}.`,
      metadata: { detector: 'tiny-yolov3-onnx', objectType, confidence, objectCount, classes, detectedAt },
    });
  }

  observeStorage(snapshot: StorageStatusSnapshot): void {
    const freeRatio = snapshot.totalBytes && snapshot.freeBytes != null ? snapshot.freeBytes / snapshot.totalBytes : null;
    const warning = !snapshot.writable || snapshot.state === 'unhealthy' || (freeRatio != null && freeRatio <= 0.10);
    if (warning && !this.storageWarningActive) {
      this.storageWarningActive = true;
      this.record({
        type: 'STORAGE_WARNING', category: 'storage', severity: snapshot.writable ? 'warning' : 'critical', title: 'Storage needs attention',
        description: !snapshot.writable ? 'The CCTV data/recording directory is not writable.' : 'The CCTV data volume has 10% or less free space remaining.',
        metadata: { path: snapshot.path, writable: snapshot.writable, totalBytes: snapshot.totalBytes, freeBytes: snapshot.freeBytes, error: snapshot.error },
      });
    } else if (!warning && this.storageWarningActive) {
      this.storageWarningActive = false;
      this.record({ type: 'STORAGE_RECOVERED', category: 'storage', severity: 'info', title: 'Storage healthy again', description: 'The CCTV data volume returned to a healthy state.', metadata: { path: snapshot.path, freeBytes: snapshot.freeBytes } });
    }
  }

  list(filter: OperationalEventFilter = {}): ClientOperationalEvent[] {
    return this.events.list(filter).map((event) => this.toClient(event));
  }

  acknowledge(id: number): ClientOperationalEvent | null {
    const event = this.events.acknowledge(id);
    return event ? this.toClient(event) : null;
  }

  onRecorded(listener: (event: OperationalEventRow) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void { this.listeners.clear(); this.events.close(); }

  private record(input: {
    cameraId?: string | null;
    cameraName?: string | null;
    type: string;
    category: OperationalEventCategory;
    severity: OperationalEventSeverity;
    title: string;
    description: string;
    metadata?: Record<string, unknown> | null;
  }): OperationalEventRow {
    const row = this.events.create(input);
    this.events.prune();
    for (const listener of this.listeners) {
      try { listener(row); } catch (error) { console.error('[notifications] Operational-event listener failed:', error); }
    }
    return row;
  }

  private toClient(row: OperationalEventRow): ClientOperationalEvent {
    const cameraName = row.camera_name || (row.camera_id ? this.cameras.get(row.camera_id)?.name : null) || 'System';
    return {
      id: String(row.id),
      timestamp: row.created_at,
      timeOnly: formatTime(row.created_at),
      camera: cameraName,
      cameraId: row.camera_id || '',
      eventType: row.type,
      message: row.description,
      severity: row.severity,
      category: row.category,
      title: row.title,
      acknowledgedAt: row.acknowledged_at,
      metadata: row.metadata,
    };
  }
}
