import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface AuditEntry {
  id: number;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditListOptions {
  limit?: number;
  actionPrefix?: string;
  resourceType?: string;
  username?: string;
  query?: string;
}

const SECRET_KEY = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|credential)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitizeValue(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value
      .replace(/rtsp:\/\/[^\s@]+@/gi, 'rtsp://***@')
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
      .slice(0, 4000);
  }
  return value;
}

export class AuditRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        username TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_resource_type ON audit_log(resource_type);
    `);
  }

  log(input: {
    userId?: string | null;
    username?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    details?: Record<string, unknown> | null;
  }): void {
    const safeDetails = input.details ? sanitizeValue(input.details) as Record<string, unknown> : null;
    this.db.prepare(`
      INSERT INTO audit_log (user_id, username, action, resource_type, resource_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId ?? null,
      input.username ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      safeDetails ? JSON.stringify(safeDetails) : null,
      new Date().toISOString(),
    );
    this.db.prepare('DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 5000)').run();
  }

  list(options: number | AuditListOptions = 200): AuditEntry[] {
    const opts: AuditListOptions = typeof options === 'number' ? { limit: options } : options;
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(opts.limit || 200)));
    const where: string[] = [];
    const values: Array<string | number> = [];
    if (opts.actionPrefix) { where.push('action LIKE ?'); values.push(`${opts.actionPrefix}%`); }
    if (opts.resourceType) { where.push('resource_type = ?'); values.push(opts.resourceType); }
    if (opts.username) { where.push('username = ? COLLATE NOCASE'); values.push(opts.username); }
    if (opts.query) {
      where.push(`(COALESCE(username,'') LIKE ? OR action LIKE ? OR resource_type LIKE ? OR COALESCE(resource_id,'') LIKE ? OR COALESCE(details_json,'') LIKE ?)`);
      const q = `%${opts.query.slice(0, 200)}%`;
      values.push(q, q, q, q, q);
    }
    const rows = this.db.prepare(`
      SELECT id, user_id, username, action, resource_type, resource_id, details_json, created_at
      FROM audit_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `).all(...values, safeLimit) as any[];
    return rows.map((row) => ({
      id: Number(row.id),
      user_id: row.user_id ? String(row.user_id) : null,
      username: row.username ? String(row.username) : null,
      action: String(row.action),
      resource_type: String(row.resource_type),
      resource_id: row.resource_id ? String(row.resource_id) : null,
      details: this.parseDetails(row.details_json),
      created_at: String(row.created_at),
    }));
  }

  close(): void { this.db.close(); }

  private parseDetails(raw: unknown): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
}
