import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type OperationalEventSeverity = 'info' | 'warning' | 'critical';
export type OperationalEventCategory = 'camera' | 'system' | 'storage';

export interface OperationalEventRow {
  id: number;
  camera_id: string | null;
  camera_name: string | null;
  type: string;
  category: OperationalEventCategory;
  severity: OperationalEventSeverity;
  title: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface OperationalEventFilter {
  limit?: number;
  category?: OperationalEventCategory | 'all';
  severity?: OperationalEventSeverity | 'all';
  cameraId?: string | null;
  acknowledged?: boolean | null;
}

export class OperationalEventRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }

  create(input: {
    cameraId?: string | null;
    cameraName?: string | null;
    type: string;
    category: OperationalEventCategory;
    severity: OperationalEventSeverity;
    title: string;
    description: string;
    metadata?: Record<string, unknown> | null;
  }): OperationalEventRow {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO operational_events (
        camera_id, camera_name, type, category, severity, title, description, metadata_json, created_at, acknowledged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.cameraId ?? null,
      input.cameraName ?? null,
      input.type,
      input.category,
      input.severity,
      input.title,
      input.description,
      input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt,
    );
    return this.get(Number(result.lastInsertRowid))!;
  }

  get(id: number): OperationalEventRow | null {
    const row = this.db.prepare(`
      SELECT id, camera_id, camera_name, type, category, severity, title, description, metadata_json, created_at, acknowledged_at
      FROM operational_events
      WHERE id = ?
    `).get(id) as any;
    return row ? this.hydrate(row) : null;
  }

  list(filter: OperationalEventFilter = {}): OperationalEventRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.category && filter.category !== 'all') { clauses.push('category = ?'); params.push(filter.category); }
    if (filter.severity && filter.severity !== 'all') { clauses.push('severity = ?'); params.push(filter.severity); }
    if (filter.cameraId) { clauses.push('camera_id = ?'); params.push(filter.cameraId); }
    if (filter.acknowledged === true) clauses.push('acknowledged_at IS NOT NULL');
    if (filter.acknowledged === false) clauses.push('acknowledged_at IS NULL');
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(filter.limit || 200)));
    params.push(safeLimit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT id, camera_id, camera_name, type, category, severity, title, description, metadata_json, created_at, acknowledged_at
      FROM operational_events
      ${where}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params) as any[];
    return rows.map((row) => this.hydrate(row));
  }

  acknowledge(id: number): OperationalEventRow | null {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE operational_events
      SET acknowledged_at = COALESCE(acknowledged_at, ?)
      WHERE id = ?
    `).run(now, id);
    return Number(result.changes || 0) > 0 ? this.get(id) : null;
  }

  prune(maxRows = 10000): void {
    const safeMax = Math.max(1000, Math.min(100000, Math.trunc(maxRows)));
    this.db.prepare(`
      DELETE FROM operational_events
      WHERE id NOT IN (SELECT id FROM operational_events ORDER BY id DESC LIMIT ?)
    `).run(safeMax);
  }

  close(): void { this.db.close(); }

  private hydrate(row: any): OperationalEventRow {
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata_json) {
      try { metadata = JSON.parse(String(row.metadata_json)); } catch { metadata = null; }
    }
    return {
      id: Number(row.id),
      camera_id: row.camera_id == null ? null : String(row.camera_id),
      camera_name: row.camera_name == null ? null : String(row.camera_name),
      type: String(row.type),
      category: row.category as OperationalEventCategory,
      severity: row.severity as OperationalEventSeverity,
      title: String(row.title),
      description: String(row.description),
      metadata,
      created_at: String(row.created_at),
      acknowledged_at: row.acknowledged_at == null ? null : String(row.acknowledged_at),
    };
  }
}
