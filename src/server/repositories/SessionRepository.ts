import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredSession {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  remote_address: string | null;
  user_agent: string | null;
}

export interface PublicSession {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  remoteAddress: string | null;
  userAgent: string | null;
  current?: boolean;
}

export class SessionRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }

  create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    remoteAddress?: string | null;
    userAgent?: string | null;
  }): StoredSession {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO auth_sessions (
        id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at, remote_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      input.id,
      input.userId,
      input.tokenHash,
      now,
      now,
      input.expiresAt,
      input.remoteAddress ?? null,
      input.userAgent ?? null,
    );
    return this.getById(input.id)!;
  }

  getById(id: string): StoredSession | null {
    const row = this.db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(id) as any;
    return row ? this.hydrate(row) : null;
  }

  isActive(id: string, userId?: string): boolean {
    const now = new Date().toISOString();
    const row = userId
      ? this.db.prepare('SELECT 1 AS ok FROM auth_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(id, userId, now)
      : this.db.prepare('SELECT 1 AS ok FROM auth_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?').get(id, now);
    return Boolean(row);
  }

  getActiveByTokenHash(tokenHash: string): StoredSession | null {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      SELECT * FROM auth_sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
      LIMIT 1
    `).get(tokenHash, now) as any;
    return row ? this.hydrate(row) : null;
  }

  listActive(userId?: string): StoredSession[] {
    const now = new Date().toISOString();
    const rows = userId
      ? this.db.prepare(`SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`).all(userId, now)
      : this.db.prepare(`SELECT * FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`).all(now);
    return (rows as any[]).map((row) => this.hydrate(row));
  }

  touch(id: string, minIntervalMs = 5 * 60_000): void {
    const row = this.getById(id);
    if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return;
    if (Date.now() - Date.parse(row.last_seen_at) < minIntervalMs) return;
    this.db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  revokeById(id: string): boolean {
    const result = this.db.prepare(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?`).run(new Date().toISOString(), id);
    return Number(result.changes || 0) > 0;
  }

  revokeByTokenHash(tokenHash: string): StoredSession | null {
    const row = this.getActiveByTokenHash(tokenHash);
    if (!row) return null;
    this.revokeById(row.id);
    return row;
  }

  revokeUser(userId: string, exceptSessionId?: string | null): number {
    const now = new Date().toISOString();
    const result = exceptSessionId
      ? this.db.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?`).run(now, userId, exceptSessionId)
      : this.db.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(now, userId);
    return Number(result.changes || 0);
  }

  prune(): void {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    this.db.prepare(`DELETE FROM auth_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?`).run(cutoff, cutoff);
  }

  close(): void { this.db.close(); }

  private hydrate(row: any): StoredSession {
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      token_hash: String(row.token_hash),
      created_at: String(row.created_at),
      last_seen_at: String(row.last_seen_at),
      expires_at: String(row.expires_at),
      revoked_at: row.revoked_at ? String(row.revoked_at) : null,
      remote_address: row.remote_address ? String(row.remote_address) : null,
      user_agent: row.user_agent ? String(row.user_agent) : null,
    };
  }
}
