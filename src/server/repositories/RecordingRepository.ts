import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type RecordingSegmentStatus = 'complete' | 'missing' | 'corrupt';

export interface RecordingSegmentRow {
  id: number;
  camera_id: string;
  camera_name: string | null;
  file_path: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  size_bytes: number;
  status: RecordingSegmentStatus;
  codec: string | null;
  is_protected: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecordingFilter {
  cameraId?: string | null;
  date?: string | null;
  limit?: number;
  protectedOnly?: boolean;
  status?: RecordingSegmentStatus | null;
}

export interface RecordingRetentionPolicy {
  enabled: boolean;
  maxAgeDays: number;
  maxStorageBytes: number;
  minFreeBytes: number;
  updatedAt: string;
}

export interface RecordingQuarantineRow {
  id: number;
  camera_id: string;
  file_path: string;
  reason: string;
  size_bytes: number;
  detected_at: string;
}

export interface RecordingHealthSummary {
  complete: number;
  missing: number;
  corrupt: number;
  protected: number;
  quarantined: number;
  indexedBytes: number;
}

export class RecordingRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }

  upsert(input: {
    cameraId: string;
    cameraName?: string | null;
    filePath: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    sizeBytes: number;
    status?: RecordingSegmentStatus;
    codec?: string | null;
  }): RecordingSegmentRow {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO recording_segments (
        camera_id, camera_name, file_path, started_at, ended_at, duration_seconds,
        size_bytes, status, codec, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        camera_id=excluded.camera_id,
        camera_name=excluded.camera_name,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        duration_seconds=excluded.duration_seconds,
        size_bytes=excluded.size_bytes,
        status=excluded.status,
        codec=excluded.codec,
        updated_at=excluded.updated_at
    `).run(
      input.cameraId,
      input.cameraName ?? null,
      input.filePath,
      input.startedAt,
      input.endedAt,
      Math.max(0, input.durationSeconds),
      Math.max(0, Math.round(input.sizeBytes)),
      input.status || 'complete',
      input.codec ?? null,
      now,
      now,
    );
    return this.getByPath(input.filePath)!;
  }

  get(id: number): RecordingSegmentRow | null {
    const row = this.db.prepare('SELECT * FROM recording_segments WHERE id = ?').get(id) as any;
    return row ? this.map(row) : null;
  }

  getByPath(filePath: string): RecordingSegmentRow | null {
    const row = this.db.prepare('SELECT * FROM recording_segments WHERE file_path = ?').get(filePath) as any;
    return row ? this.map(row) : null;
  }

  list(filter: RecordingFilter = {}): RecordingSegmentRow[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (filter.cameraId) { clauses.push('camera_id = ?'); values.push(filter.cameraId); }
    if (filter.date) { clauses.push('substr(started_at, 1, 10) = ?'); values.push(filter.date); }
    if (filter.protectedOnly) clauses.push('is_protected = 1');
    if (filter.status) { clauses.push('status = ?'); values.push(filter.status); }
    const limit = Math.max(1, Math.min(5000, Number(filter.limit || 250)));
    const sql = `SELECT * FROM recording_segments${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ?`;
    values.push(limit);
    return (this.db.prepare(sql).all(...values) as any[]).map((row) => this.map(row));
  }

  listAll(): RecordingSegmentRow[] {
    return (this.db.prepare('SELECT * FROM recording_segments ORDER BY started_at DESC, id DESC').all() as any[]).map((row) => this.map(row));
  }

  listRetentionCandidates(): RecordingSegmentRow[] {
    return (this.db.prepare("SELECT * FROM recording_segments WHERE status='complete' AND is_protected=0 ORDER BY started_at ASC, id ASC").all() as any[]).map((row) => this.map(row));
  }

  listOverlapping(cameraId: string, startIso: string, endIso: string): RecordingSegmentRow[] {
    return (this.db.prepare(`
      SELECT * FROM recording_segments
      WHERE camera_id=? AND status='complete' AND started_at<=? AND ended_at>=?
      ORDER BY started_at ASC, id ASC
    `).all(cameraId, endIso, startIso) as any[]).map((row) => this.map(row));
  }

  setProtected(id: number, value: boolean): RecordingSegmentRow | null {
    this.db.prepare('UPDATE recording_segments SET is_protected=?, updated_at=? WHERE id=?').run(value ? 1 : 0, new Date().toISOString(), id);
    return this.get(id);
  }

  markStatus(id: number, status: RecordingSegmentStatus): RecordingSegmentRow | null {
    this.db.prepare('UPDATE recording_segments SET status=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), id);
    return this.get(id);
  }

  markMissing(id: number): RecordingSegmentRow | null { return this.markStatus(id, 'missing'); }

  deleteRow(id: number): void { this.db.prepare('DELETE FROM recording_segments WHERE id=?').run(id); }

  summary(cameraIds?: string[] | null): { count: number; bytes: number } {
    if (cameraIds && cameraIds.length === 0) return { count: 0, bytes: 0 };
    if (cameraIds && cameraIds.length > 0) {
      const placeholders = cameraIds.map(() => '?').join(',');
      const row = this.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM recording_segments WHERE status='complete' AND camera_id IN (${placeholders})`).get(...cameraIds) as { count?: number | bigint; bytes?: number | bigint } | undefined;
      return { count: Number(row?.count || 0), bytes: Number(row?.bytes || 0) };
    }
    const row = this.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM recording_segments WHERE status='complete'").get() as { count?: number | bigint; bytes?: number | bigint } | undefined;
    return { count: Number(row?.count || 0), bytes: Number(row?.bytes || 0) };
  }

  health(): RecordingHealthSummary {
    const row = this.db.prepare(`SELECT
      SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN status='missing' THEN 1 ELSE 0 END) AS missing,
      SUM(CASE WHEN status='corrupt' THEN 1 ELSE 0 END) AS corrupt,
      SUM(CASE WHEN is_protected=1 THEN 1 ELSE 0 END) AS protected,
      COALESCE(SUM(CASE WHEN status='complete' THEN size_bytes ELSE 0 END),0) AS indexedBytes
      FROM recording_segments`).get() as any;
    const quarantine = this.db.prepare('SELECT COUNT(*) AS count FROM recording_quarantine').get() as { count?: number | bigint } | undefined;
    return {
      complete: Number(row?.complete || 0), missing: Number(row?.missing || 0), corrupt: Number(row?.corrupt || 0),
      protected: Number(row?.protected || 0), quarantined: Number(quarantine?.count || 0), indexedBytes: Number(row?.indexedBytes || 0),
    };
  }

  getPolicy(): RecordingRetentionPolicy {
    const row = this.db.prepare('SELECT * FROM recording_retention_policy WHERE id=1').get() as any;
    return {
      enabled: Boolean(row?.enabled),
      maxAgeDays: Math.max(0, Number(row?.max_age_days ?? 14)),
      maxStorageBytes: Math.max(0, Number(row?.max_storage_bytes ?? 0)),
      minFreeBytes: Math.max(0, Number(row?.min_free_bytes ?? 5368709120)),
      updatedAt: String(row?.updated_at || new Date(0).toISOString()),
    };
  }

  updatePolicy(input: Partial<Omit<RecordingRetentionPolicy, 'updatedAt'>>): RecordingRetentionPolicy {
    const current = this.getPolicy();
    const finiteOr = (value: number | undefined, fallback: number): number => value == null || !Number.isFinite(value) ? fallback : value;
    const next = {
      enabled: input.enabled ?? current.enabled,
      maxAgeDays: Math.max(0, Math.min(3650, Math.round(finiteOr(input.maxAgeDays, current.maxAgeDays)))),
      maxStorageBytes: Math.max(0, Math.round(finiteOr(input.maxStorageBytes, current.maxStorageBytes))),
      minFreeBytes: Math.max(0, Math.round(finiteOr(input.minFreeBytes, current.minFreeBytes))),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`INSERT INTO recording_retention_policy (id,enabled,max_age_days,max_storage_bytes,min_free_bytes,updated_at)
      VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,max_age_days=excluded.max_age_days,max_storage_bytes=excluded.max_storage_bytes,min_free_bytes=excluded.min_free_bytes,updated_at=excluded.updated_at`)
      .run(next.enabled ? 1 : 0, next.maxAgeDays, next.maxStorageBytes, next.minFreeBytes, next.updatedAt);
    return this.getPolicy();
  }

  addQuarantine(input: { cameraId: string; filePath: string; reason: string; sizeBytes?: number }): void {
    this.db.prepare(`INSERT INTO recording_quarantine (camera_id,file_path,reason,size_bytes,detected_at) VALUES (?,?,?,?,?)
      ON CONFLICT(file_path) DO UPDATE SET camera_id=excluded.camera_id,reason=excluded.reason,size_bytes=excluded.size_bytes`)
      .run(input.cameraId, input.filePath, input.reason, Math.max(0, Math.round(input.sizeBytes || 0)), new Date().toISOString());
  }

  removeQuarantine(filePath: string): void { this.db.prepare('DELETE FROM recording_quarantine WHERE file_path=?').run(filePath); }

  listQuarantine(limit = 250): RecordingQuarantineRow[] {
    return (this.db.prepare('SELECT * FROM recording_quarantine ORDER BY detected_at DESC LIMIT ?').all(Math.max(1, Math.min(5000, limit))) as any[]).map((row) => ({
      id: Number(row.id), camera_id: String(row.camera_id), file_path: String(row.file_path), reason: String(row.reason), size_bytes: Number(row.size_bytes || 0), detected_at: String(row.detected_at),
    }));
  }

  totalBytes(): number { return this.summary().bytes; }
  count(): number { const row = this.db.prepare('SELECT COUNT(*) AS count FROM recording_segments').get() as { count?: number | bigint } | undefined; return Number(row?.count || 0); }
  close(): void { this.db.close(); }

  private map(row: any): RecordingSegmentRow {
    return {
      id: Number(row.id), camera_id: String(row.camera_id), camera_name: row.camera_name == null ? null : String(row.camera_name), file_path: String(row.file_path),
      started_at: String(row.started_at), ended_at: String(row.ended_at), duration_seconds: Number(row.duration_seconds || 0), size_bytes: Number(row.size_bytes || 0),
      status: row.status === 'missing' ? 'missing' : row.status === 'corrupt' ? 'corrupt' : 'complete', codec: row.codec == null ? null : String(row.codec),
      is_protected: Boolean(row.is_protected), created_at: String(row.created_at), updated_at: String(row.updated_at),
    };
  }
}
