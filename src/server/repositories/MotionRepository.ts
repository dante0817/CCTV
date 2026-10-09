import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface MotionSettings {
  cameraId: string;
  enabled: boolean;
  sensitivity: number;
  cooldownSeconds: number;
  preSeconds: number;
  postSeconds: number;
  updatedAt: string;
}

export interface MotionZone {
  id: number;
  cameraId: string;
  name: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  sensitivity: number | null;
  updatedAt: string;
}

export type MotionReviewStatus = 'unreviewed' | 'confirmed' | 'dismissed';

export interface MotionReview {
  eventId: number;
  status: MotionReviewStatus;
  note: string;
  reviewedAt: string | null;
}

export interface MotionDetectionRow {
  event_id: number;
  camera_id: string;
  detected_at: string;
  scene_score: number;
  sensitivity: number;
  pre_seconds: number;
  post_seconds: number;
  zone_id: number | null;
  zone_name: string | null;
  snapshot_path: string | null;
  created_at: string;
}

export class MotionRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }

  getSettings(cameraId: string): MotionSettings {
    const row = this.db.prepare('SELECT * FROM camera_motion_settings WHERE camera_id=?').get(cameraId) as any;
    if (!row) return {
      cameraId,
      enabled: false,
      sensitivity: 85,
      cooldownSeconds: 20,
      preSeconds: 15,
      postSeconds: 45,
      updatedAt: new Date(0).toISOString(),
    };
    return this.mapSettings(row);
  }

  updateSettings(cameraId: string, input: Partial<Omit<MotionSettings, 'cameraId' | 'updatedAt'>>): MotionSettings {
    const current = this.getSettings(cameraId);
    const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
    };
    const next = {
      enabled: input.enabled ?? current.enabled,
      sensitivity: clampInt(input.sensitivity, current.sensitivity, 1, 100),
      cooldownSeconds: clampInt(input.cooldownSeconds, current.cooldownSeconds, 5, 300),
      preSeconds: clampInt(input.preSeconds, current.preSeconds, 0, 120),
      postSeconds: clampInt(input.postSeconds, current.postSeconds, 5, 300),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO camera_motion_settings (camera_id, enabled, sensitivity, cooldown_seconds, pre_seconds, post_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(camera_id) DO UPDATE SET
        enabled=excluded.enabled,
        sensitivity=excluded.sensitivity,
        cooldown_seconds=excluded.cooldown_seconds,
        pre_seconds=excluded.pre_seconds,
        post_seconds=excluded.post_seconds,
        updated_at=excluded.updated_at
    `).run(cameraId, next.enabled ? 1 : 0, next.sensitivity, next.cooldownSeconds, next.preSeconds, next.postSeconds, next.updatedAt);
    return this.getSettings(cameraId);
  }

  listZones(cameraId: string): MotionZone[] {
    return (this.db.prepare('SELECT * FROM motion_zones WHERE camera_id=? ORDER BY id ASC').all(cameraId) as any[]).map((row) => this.mapZone(row));
  }

  getZone(cameraId: string, zoneId: number): MotionZone | null {
    const row = this.db.prepare('SELECT * FROM motion_zones WHERE camera_id=? AND id=?').get(cameraId, zoneId) as any;
    return row ? this.mapZone(row) : null;
  }

  createZone(cameraId: string, input: Partial<Omit<MotionZone, 'id' | 'cameraId' | 'updatedAt'>>): MotionZone {
    if (this.listZones(cameraId).length >= 4) throw Object.assign(new Error('A camera can have at most 4 motion zones.'), { code: 'MOTION_ZONE_LIMIT' });
    const normalized = this.normalizeZone(input, { name: `Zone ${this.listZones(cameraId).length + 1}`, enabled: true, x: 0, y: 0, width: 50, height: 50, sensitivity: null });
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO motion_zones(camera_id,name,enabled,x,y,width,height,sensitivity,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(cameraId, normalized.name, normalized.enabled ? 1 : 0, normalized.x, normalized.y, normalized.width, normalized.height, normalized.sensitivity, now);
    return this.getZone(cameraId, Number(result.lastInsertRowid))!;
  }

  updateZone(cameraId: string, zoneId: number, input: Partial<Omit<MotionZone, 'id' | 'cameraId' | 'updatedAt'>>): MotionZone {
    const current = this.getZone(cameraId, zoneId);
    if (!current) throw Object.assign(new Error('Motion zone not found.'), { code: 'NOT_FOUND' });
    const normalized = this.normalizeZone(input, current);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE motion_zones SET name=?,enabled=?,x=?,y=?,width=?,height=?,sensitivity=?,updated_at=?
      WHERE camera_id=? AND id=?
    `).run(normalized.name, normalized.enabled ? 1 : 0, normalized.x, normalized.y, normalized.width, normalized.height, normalized.sensitivity, now, cameraId, zoneId);
    return this.getZone(cameraId, zoneId)!;
  }

  deleteZone(cameraId: string, zoneId: number): boolean {
    const result = this.db.prepare('DELETE FROM motion_zones WHERE camera_id=? AND id=?').run(cameraId, zoneId);
    return Number(result.changes || 0) > 0;
  }

  createDetection(input: { eventId: number; cameraId: string; detectedAt: string; sceneScore: number; settings: MotionSettings; zone?: MotionZone | null }): MotionDetectionRow {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO motion_detections (event_id, camera_id, detected_at, scene_score, sensitivity, pre_seconds, post_seconds, zone_id, zone_name, snapshot_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(event_id) DO NOTHING
    `).run(input.eventId, input.cameraId, input.detectedAt, input.sceneScore, input.zone?.sensitivity ?? input.settings.sensitivity, input.settings.preSeconds, input.settings.postSeconds, input.zone?.id ?? null, input.zone?.name ?? null, createdAt);
    return this.getDetection(input.eventId)!;
  }

  setSnapshotPath(eventId: number, snapshotPath: string | null): MotionDetectionRow | null {
    this.db.prepare('UPDATE motion_detections SET snapshot_path=? WHERE event_id=?').run(snapshotPath, eventId);
    return this.getDetection(eventId);
  }

  getDetection(eventId: number): MotionDetectionRow | null {
    const row = this.db.prepare('SELECT * FROM motion_detections WHERE event_id=?').get(eventId) as any;
    return row ? this.mapDetection(row) : null;
  }

  listRecentDetections(maxAgeSeconds = 3600): MotionDetectionRow[] {
    const cutoff = new Date(Date.now() - Math.max(60, maxAgeSeconds) * 1000).toISOString();
    return (this.db.prepare('SELECT * FROM motion_detections WHERE detected_at>=? ORDER BY detected_at DESC').all(cutoff) as any[]).map((row) => this.mapDetection(row));
  }


  latestRecentDetection(cameraId: string, maxAgeSeconds: number, zoneId: number | null = null): MotionDetectionRow | null {
    const cutoff = new Date(Date.now() - Math.max(1, maxAgeSeconds) * 1000).toISOString();
    const row = zoneId == null
      ? this.db.prepare('SELECT * FROM motion_detections WHERE camera_id=? AND detected_at>=? ORDER BY detected_at DESC LIMIT 1').get(cameraId, cutoff) as any
      : this.db.prepare('SELECT * FROM motion_detections WHERE camera_id=? AND detected_at>=? AND zone_id=? ORDER BY detected_at DESC LIMIT 1').get(cameraId, cutoff, zoneId) as any;
    return row ? this.mapDetection(row) : null;
  }

  listSnapshotPaths(): string[] {
    return (this.db.prepare("SELECT snapshot_path FROM motion_detections WHERE snapshot_path IS NOT NULL AND snapshot_path<>''").all() as any[]).map((row) => String(row.snapshot_path));
  }

  getReview(eventId: number): MotionReview {
    const row = this.db.prepare('SELECT * FROM motion_event_reviews WHERE event_id=?').get(eventId) as any;
    if (!row) return { eventId, status: 'unreviewed', note: '', reviewedAt: null };
    return { eventId, status: this.reviewStatus(row.status), note: String(row.note || ''), reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at) };
  }

  setReview(eventId: number, status: MotionReviewStatus, note = ''): MotionReview {
    const safeStatus = this.reviewStatus(status);
    const safeNote = String(note || '').trim().slice(0, 1000);
    const reviewedAt = safeStatus === 'unreviewed' ? null : new Date().toISOString();
    this.db.prepare(`
      INSERT INTO motion_event_reviews(event_id,status,note,reviewed_at)
      VALUES(?,?,?,?)
      ON CONFLICT(event_id) DO UPDATE SET status=excluded.status,note=excluded.note,reviewed_at=excluded.reviewed_at
    `).run(eventId, safeStatus, safeNote, reviewedAt);
    return this.getReview(eventId);
  }

  linkRecording(eventId: number, recordingId: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO motion_event_recordings (event_id, recording_id, linked_at) VALUES (?, ?, ?)`)
      .run(eventId, recordingId, new Date().toISOString());
  }

  linkedRecordingIds(eventId: number): number[] {
    return (this.db.prepare('SELECT recording_id FROM motion_event_recordings WHERE event_id=? ORDER BY recording_id ASC').all(eventId) as any[])
      .map((row) => Number(row.recording_id));
  }

  close(): void { this.db.close(); }

  private normalizeZone(input: Partial<Omit<MotionZone, 'id' | 'cameraId' | 'updatedAt'>>, fallback: Pick<MotionZone, 'name' | 'enabled' | 'x' | 'y' | 'width' | 'height' | 'sensitivity'>) {
    const int = (value: unknown, old: number, min: number, max: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : old;
    };
    const name = String(input.name ?? fallback.name).trim().slice(0, 50) || fallback.name;
    const x = int(input.x, fallback.x, 0, 95);
    const y = int(input.y, fallback.y, 0, 95);
    const width = Math.min(int(input.width, fallback.width, 5, 100), 100 - x);
    const height = Math.min(int(input.height, fallback.height, 5, 100), 100 - y);
    let sensitivity = fallback.sensitivity;
    if (input.sensitivity === null || input.sensitivity === 0) sensitivity = null;
    else if (input.sensitivity !== undefined) sensitivity = int(input.sensitivity, fallback.sensitivity ?? 85, 1, 100);
    return { name, enabled: input.enabled ?? fallback.enabled, x, y, width, height, sensitivity };
  }

  private reviewStatus(value: unknown): MotionReviewStatus {
    return value === 'confirmed' || value === 'dismissed' ? value : 'unreviewed';
  }

  private mapSettings(row: any): MotionSettings {
    return {
      cameraId: String(row.camera_id),
      enabled: Boolean(row.enabled),
      sensitivity: Number(row.sensitivity || 85),
      cooldownSeconds: Number(row.cooldown_seconds || 20),
      preSeconds: Number(row.pre_seconds || 15),
      postSeconds: Number(row.post_seconds || 45),
      updatedAt: String(row.updated_at),
    };
  }

  private mapZone(row: any): MotionZone {
    return {
      id: Number(row.id), cameraId: String(row.camera_id), name: String(row.name), enabled: Boolean(row.enabled),
      x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height),
      sensitivity: row.sensitivity == null ? null : Number(row.sensitivity), updatedAt: String(row.updated_at),
    };
  }

  private mapDetection(row: any): MotionDetectionRow {
    return {
      event_id: Number(row.event_id), camera_id: String(row.camera_id), detected_at: String(row.detected_at),
      scene_score: Number(row.scene_score || 0), sensitivity: Number(row.sensitivity || 85),
      pre_seconds: Number(row.pre_seconds || 15), post_seconds: Number(row.post_seconds || 45),
      zone_id: row.zone_id == null ? null : Number(row.zone_id), zone_name: row.zone_name == null ? null : String(row.zone_name),
      snapshot_path: row.snapshot_path == null ? null : String(row.snapshot_path), created_at: String(row.created_at),
    };
  }
}
