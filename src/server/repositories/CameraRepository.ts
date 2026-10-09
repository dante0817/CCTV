import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { Camera, CameraStatus, RtspTransport, RtspVideoMode, RtspVendorProfile } from '../../types/cctv';

export interface StoredRtspConfig {
  camera_id: string;
  host: string;
  port: number;
  stream_path: string;
  username: string;
  password_encrypted: string;
  transport: RtspTransport;
  video_mode: RtspVideoMode;
  encoder: string;
  bitrate_kbps: number;
  vendor_profile: RtspVendorProfile;
  created_at: string;
  updated_at: string;
}

export interface SaveRtspConfigInput {
  host: string;
  port: number;
  stream_path: string;
  username: string;
  password_encrypted: string;
  transport: RtspTransport;
  video_mode: RtspVideoMode;
  encoder: string;
  bitrate_kbps: number;
  vendor_profile: RtspVendorProfile;
}

const CURRENT_SCHEMA_VERSION = 12;

export class CameraRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    this.applyMigrations();
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version?: number | null } | undefined;
    return Number(row?.version || 0);
  }

  list(): Camera[] {
    const rows = this.db.prepare('SELECT * FROM cameras ORDER BY created_at ASC').all() as any[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): Camera | null {
    const row = this.db.prepare('SELECT * FROM cameras WHERE id = ?').get(id) as any;
    return row ? this.hydrate(row) : null;
  }

  save(camera: Camera): Camera {
    const now = new Date().toISOString();
    const existing = this.get(camera.id);
    const created = camera.created_at || existing?.created_at || now;
    const next: Camera = { ...camera, created_at: created, updated_at: now };
    this.db.prepare(`
      INSERT INTO cameras (id, payload_json, enabled, status, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json=excluded.payload_json,
        enabled=excluded.enabled,
        status=excluded.status,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `).run(next.id, JSON.stringify(next), next.enabled ? 1 : 0, next.status, next.last_error || null, created, now);
    return next;
  }

  patch(id: string, patch: Partial<Camera>): Camera | null {
    const current = this.get(id);
    if (!current) return null;
    return this.save({ ...current, ...patch });
  }

  setStatus(id: string, status: CameraStatus, lastError: string | null = null): Camera | null {
    return this.patch(id, { status, last_error: lastError, lastSeen: status === 'online' ? new Date().toLocaleTimeString() : this.get(id)?.lastSeen || 'Never' });
  }

  saveRtspConfig(cameraId: string, input: SaveRtspConfigInput): StoredRtspConfig {
    const now = new Date().toISOString();
    const existing = this.getRtspConfig(cameraId);
    const created = existing?.created_at || now;
    this.db.prepare(`
      INSERT INTO camera_rtsp_config (
        camera_id, host, port, stream_path, username, password_encrypted, transport,
        video_mode, encoder, bitrate_kbps, vendor_profile, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(camera_id) DO UPDATE SET
        host=excluded.host,
        port=excluded.port,
        stream_path=excluded.stream_path,
        username=excluded.username,
        password_encrypted=excluded.password_encrypted,
        transport=excluded.transport,
        video_mode=excluded.video_mode,
        encoder=excluded.encoder,
        bitrate_kbps=excluded.bitrate_kbps,
        vendor_profile=excluded.vendor_profile,
        updated_at=excluded.updated_at
    `).run(
      cameraId,
      input.host,
      input.port,
      input.stream_path,
      input.username,
      input.password_encrypted,
      input.transport,
      input.video_mode,
      input.encoder,
      input.bitrate_kbps,
      input.vendor_profile,
      created,
      now,
    );
    return this.getRtspConfig(cameraId)!;
  }

  getRtspConfig(cameraId: string): StoredRtspConfig | null {
    const row = this.db.prepare('SELECT * FROM camera_rtsp_config WHERE camera_id = ?').get(cameraId) as any;
    if (!row) return null;
    return {
      camera_id: String(row.camera_id),
      host: String(row.host),
      port: Number(row.port),
      stream_path: String(row.stream_path),
      username: String(row.username || ''),
      password_encrypted: String(row.password_encrypted || ''),
      transport: row.transport === 'udp' ? 'udp' : 'tcp',
      video_mode: row.video_mode === 'copy' ? 'copy' : 'transcode',
      encoder: String(row.encoder || 'auto'),
      bitrate_kbps: Number(row.bitrate_kbps || 2500),
      vendor_profile: row.vendor_profile === 'tenda-cp3-pro' ? 'tenda-cp3-pro' : 'generic',
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
  }

  close() { this.db.close(); }

  private hydrate(row: any): Camera {
    const payload = JSON.parse(row.payload_json) as Camera;
    return {
      ...payload,
      enabled: Boolean(row.enabled),
      status: row.status,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private applyMigrations(): void {
    const applied = new Set((this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => Number(row.version)));
    const migrate = (version: number, name: string, sql: string) => {
      if (applied.has(version)) return;
      this.db.exec('BEGIN');
      try {
        this.db.exec(sql);
        this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, name, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };

    migrate(1, 'rtsp_camera_configuration', `
      CREATE TABLE IF NOT EXISTS camera_rtsp_config (
        camera_id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 554,
        stream_path TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        password_encrypted TEXT NOT NULL DEFAULT '',
        transport TEXT NOT NULL DEFAULT 'tcp',
        video_mode TEXT NOT NULL DEFAULT 'transcode',
        encoder TEXT NOT NULL DEFAULT 'auto',
        bitrate_kbps INTEGER NOT NULL DEFAULT 2500,
        vendor_profile TEXT NOT NULL DEFAULT 'generic',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
    `);

    migrate(2, 'camera_runtime_indexes', `
      CREATE INDEX IF NOT EXISTS idx_cameras_status ON cameras(status);
      CREATE INDEX IF NOT EXISTS idx_cameras_enabled ON cameras(enabled);
    `);

    migrate(3, 'operational_events', `
      CREATE TABLE IF NOT EXISTS operational_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT,
        camera_name TEXT,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        acknowledged_at TEXT,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operational_events_created_at ON operational_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operational_events_camera_id ON operational_events(camera_id);
      CREATE INDEX IF NOT EXISTS idx_operational_events_type ON operational_events(type);
      CREATE INDEX IF NOT EXISTS idx_operational_events_category ON operational_events(category);
      CREATE INDEX IF NOT EXISTS idx_operational_events_severity ON operational_events(severity);
      CREATE INDEX IF NOT EXISTS idx_operational_events_acknowledged ON operational_events(acknowledged_at);
    `);

    migrate(5, 'continuous_recording_segments', `
      CREATE TABLE IF NOT EXISTS recording_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT NOT NULL,
        camera_name TEXT,
        file_path TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_seconds REAL NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'complete',
        codec TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_recording_segments_camera_started ON recording_segments(camera_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recording_segments_started ON recording_segments(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recording_segments_status ON recording_segments(status);
    `);


    migrate(6, 'recording_management_retention', `
      ALTER TABLE recording_segments ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_recording_segments_protected_started ON recording_segments(is_protected, started_at ASC);
      CREATE TABLE IF NOT EXISTS recording_retention_policy (
        id INTEGER PRIMARY KEY CHECK(id=1),
        enabled INTEGER NOT NULL DEFAULT 0,
        max_age_days INTEGER NOT NULL DEFAULT 14,
        max_storage_bytes INTEGER NOT NULL DEFAULT 0,
        min_free_bytes INTEGER NOT NULL DEFAULT 5368709120,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO recording_retention_policy (id,enabled,max_age_days,max_storage_bytes,min_free_bytes,updated_at)
        VALUES (1,0,14,0,5368709120,'1970-01-01T00:00:00.000Z');
      CREATE TABLE IF NOT EXISTS recording_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        detected_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_recording_quarantine_camera ON recording_quarantine(camera_id, detected_at DESC);
    `);

    migrate(7, 'motion_detection_event_links', `
      CREATE TABLE IF NOT EXISTS camera_motion_settings (
        camera_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        sensitivity INTEGER NOT NULL DEFAULT 85,
        cooldown_seconds INTEGER NOT NULL DEFAULT 20,
        pre_seconds INTEGER NOT NULL DEFAULT 15,
        post_seconds INTEGER NOT NULL DEFAULT 45,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS motion_detections (
        event_id INTEGER PRIMARY KEY,
        camera_id TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        scene_score REAL NOT NULL DEFAULT 0,
        sensitivity INTEGER NOT NULL DEFAULT 85,
        pre_seconds INTEGER NOT NULL DEFAULT 15,
        post_seconds INTEGER NOT NULL DEFAULT 45,
        created_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_motion_detections_camera_time ON motion_detections(camera_id, detected_at DESC);
      CREATE TABLE IF NOT EXISTS motion_event_recordings (
        event_id INTEGER NOT NULL,
        recording_id INTEGER NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (event_id, recording_id),
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE,
        FOREIGN KEY (recording_id) REFERENCES recording_segments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_motion_event_recordings_recording ON motion_event_recordings(recording_id);
    `);


    migrate(8, 'motion_snapshots_zones_review', `
      CREATE TABLE IF NOT EXISTS motion_zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        x INTEGER NOT NULL DEFAULT 0,
        y INTEGER NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 50,
        height INTEGER NOT NULL DEFAULT 50,
        sensitivity INTEGER,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_motion_zones_camera ON motion_zones(camera_id, id);
      ALTER TABLE motion_detections ADD COLUMN zone_id INTEGER REFERENCES motion_zones(id) ON DELETE SET NULL;
      ALTER TABLE motion_detections ADD COLUMN zone_name TEXT;
      ALTER TABLE motion_detections ADD COLUMN snapshot_path TEXT;
      CREATE TABLE IF NOT EXISTS motion_event_reviews (
        event_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','confirmed','dismissed')),
        note TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE
      );
    `);


    migrate(9, 'notification_alert_rules', `
      CREATE TABLE IF NOT EXISTS notification_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        event_type TEXT NOT NULL DEFAULT '*',
        minimum_severity TEXT NOT NULL DEFAULT 'warning' CHECK(minimum_severity IN ('info','warning','critical')),
        camera_id TEXT,
        zone_id INTEGER,
        cooldown_seconds INTEGER NOT NULL DEFAULT 60,
        desktop_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE,
        FOREIGN KEY (zone_id) REFERENCES motion_zones(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_rules_enabled ON notification_rules(enabled, event_type);
      CREATE INDEX IF NOT EXISTS idx_notification_rules_camera ON notification_rules(camera_id);
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        camera_id TEXT,
        camera_name TEXT,
        zone_name TEXT,
        severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        desktop_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        read_at TEXT,
        FOREIGN KEY (rule_id) REFERENCES notification_rules(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL,
        UNIQUE(rule_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_rule_camera ON notifications(rule_id, camera_id, created_at DESC);
    `);



    migrate(10, 'notification_email_delivery', `
      ALTER TABLE notification_rules ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS notification_email_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        host TEXT NOT NULL DEFAULT '',
        port INTEGER NOT NULL DEFAULT 587,
        secure_mode TEXT NOT NULL DEFAULT 'starttls' CHECK(secure_mode IN ('none','starttls','tls')),
        username TEXT NOT NULL DEFAULT '',
        password_encrypted TEXT NOT NULL DEFAULT '',
        from_address TEXT NOT NULL DEFAULT '',
        recipients TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id INTEGER NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('email')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','retrying','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        sent_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        UNIQUE(notification_id, channel)
      );
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(status, next_attempt_at, id);
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created ON notification_deliveries(created_at DESC);
    `);


    migrate(11, 'ai_person_vehicle_detection', `
      CREATE TABLE IF NOT EXISTS camera_ai_settings (
        camera_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        confidence_percent INTEGER NOT NULL DEFAULT 55,
        sample_interval_seconds INTEGER NOT NULL DEFAULT 5,
        cooldown_seconds INTEGER NOT NULL DEFAULT 30,
        detect_person INTEGER NOT NULL DEFAULT 1,
        detect_vehicle INTEGER NOT NULL DEFAULT 1,
        pre_seconds INTEGER NOT NULL DEFAULT 15,
        post_seconds INTEGER NOT NULL DEFAULT 45,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_detections (
        event_id INTEGER PRIMARY KEY,
        camera_id TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        object_type TEXT NOT NULL CHECK(object_type IN ('person','vehicle')),
        confidence REAL NOT NULL,
        object_count INTEGER NOT NULL DEFAULT 1,
        classes_json TEXT NOT NULL DEFAULT '[]',
        boxes_json TEXT NOT NULL DEFAULT '[]',
        snapshot_path TEXT,
        pre_seconds INTEGER NOT NULL DEFAULT 15,
        post_seconds INTEGER NOT NULL DEFAULT 45,
        model_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_detections_camera_time ON ai_detections(camera_id, detected_at DESC);
      CREATE TABLE IF NOT EXISTS ai_event_recordings (
        event_id INTEGER NOT NULL,
        recording_id INTEGER NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (event_id, recording_id),
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE,
        FOREIGN KEY (recording_id) REFERENCES recording_segments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_event_recordings_recording ON ai_event_recordings(recording_id);
    `);


    migrate(12, 'ai_tuning_review_performance', `
      ALTER TABLE camera_ai_settings ADD COLUMN performance_profile TEXT NOT NULL DEFAULT 'balanced' CHECK(performance_profile IN ('low_cpu','balanced','high_accuracy','custom'));
      ALTER TABLE camera_ai_settings ADD COLUMN person_confidence_percent INTEGER NOT NULL DEFAULT 55;
      ALTER TABLE camera_ai_settings ADD COLUMN vehicle_confidence_percent INTEGER NOT NULL DEFAULT 55;
      ALTER TABLE camera_ai_settings ADD COLUMN trigger_mode TEXT NOT NULL DEFAULT 'continuous' CHECK(trigger_mode IN ('continuous','motion'));
      ALTER TABLE camera_ai_settings ADD COLUMN motion_gate_seconds INTEGER NOT NULL DEFAULT 30;
      ALTER TABLE camera_ai_settings ADD COLUMN motion_zone_id INTEGER;
      CREATE TABLE IF NOT EXISTS ai_event_reviews (
        event_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','confirmed_person','confirmed_vehicle','false_detection')),
        note TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        reviewed_by TEXT,
        FOREIGN KEY (event_id) REFERENCES operational_events(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_reviews_status ON ai_event_reviews(status, reviewed_at DESC);
      CREATE TRIGGER IF NOT EXISTS trg_motion_zone_delete_ai_settings
      AFTER DELETE ON motion_zones
      BEGIN
        UPDATE camera_ai_settings SET motion_zone_id=NULL WHERE camera_id=OLD.camera_id AND motion_zone_id=OLD.id;
      END;
    `);

    if (this.schemaVersion() > CURRENT_SCHEMA_VERSION) throw new Error(`Database schema version ${this.schemaVersion()} is newer than this application supports (${CURRENT_SCHEMA_VERSION}).`);
  }
}
