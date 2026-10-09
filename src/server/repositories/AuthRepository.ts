import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type UserRole = 'Admin' | 'Viewer';
export type CameraAccess = 'all' | string[];

export interface StoredUser {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  status: 'Active' | 'Inactive';
  cameraAccess: CameraAccess;
  recordingAccess: CameraAccess;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  security_version: number;
  password_changed_at: string | null;
  aiEnabled: boolean;
}

export interface PublicUser extends Omit<StoredUser, 'password_hash'> {}

interface AccessRow {
  camera_id: string;
  can_view_live: number;
  can_view_recordings: number;
}

export class AuthRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active',
        camera_access_json TEXT NOT NULL DEFAULT '[]',
        last_login TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_camera_access (
        user_id TEXT NOT NULL,
        camera_id TEXT NOT NULL,
        can_view_live INTEGER NOT NULL DEFAULT 1,
        can_view_recordings INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, camera_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_camera_access_camera ON user_camera_access(camera_id);
    `);
    this.applySecurityMigration();
    this.migrateLegacyRolesAndAccess();
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return Number(row.count || 0);
  }

  list(): PublicUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[];
    return rows.map((row) => this.public(this.hydrate(row)));
  }

  get(id: string): StoredUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? this.hydrate(row) : null;
  }

  getByUsername(username: string): StoredUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as any;
    return row ? this.hydrate(row) : null;
  }

  create(input: {
    id: string;
    username: string;
    password_hash: string;
    role: UserRole;
    status?: 'Active' | 'Inactive';
    cameraAccess?: CameraAccess;
    recordingAccess?: CameraAccess;
    aiEnabled?: boolean;
  }): PublicUser {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO users (id, username, password_hash, role, status, camera_access_json, ai_enabled, security_version, password_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      input.id,
      input.username.trim(),
      input.password_hash,
      input.role,
      input.status || 'Active',
      input.role === 'Admin' ? '"all"' : '[]',
      (input.aiEnabled ?? (input.role === 'Admin')) ? 1 : 0,
      now,
      now,
      now,
    );

    if (input.role === 'Viewer') {
      this.setCameraPermissions(input.id, input.cameraAccess ?? [], input.recordingAccess ?? []);
    }
    return this.public(this.get(input.id)!);
  }

  patch(
    id: string,
    patch: Partial<Pick<StoredUser, 'username' | 'password_hash' | 'role' | 'status' | 'cameraAccess' | 'recordingAccess' | 'last_login' | 'password_changed_at' | 'aiEnabled'>>,
  ): PublicUser | null {
    const current = this.get(id);
    if (!current) return null;

    const nextRole = patch.role ?? current.role;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE users SET username=?, password_hash=?, role=?, status=?, last_login=?, password_changed_at=?, ai_enabled=?, updated_at=? WHERE id=?
    `).run(
      (patch.username ?? current.username).trim(),
      patch.password_hash ?? current.password_hash,
      nextRole,
      patch.status ?? current.status,
      patch.last_login !== undefined ? patch.last_login : current.last_login,
      patch.password_changed_at !== undefined ? patch.password_changed_at : current.password_changed_at,
      patch.aiEnabled !== undefined ? (patch.aiEnabled ? 1 : 0) : (current.aiEnabled ? 1 : 0),
      now,
      id,
    );

    if (nextRole === 'Admin') {
      this.db.prepare('DELETE FROM user_camera_access WHERE user_id = ?').run(id);
      this.db.prepare('UPDATE users SET camera_access_json = ? WHERE id = ?').run('"all"', id);
    } else {
      const roleWasAdmin = current.role === 'Admin';
      if (roleWasAdmin || patch.cameraAccess !== undefined || patch.recordingAccess !== undefined) {
        const live = patch.cameraAccess !== undefined ? patch.cameraAccess : (roleWasAdmin ? [] : current.cameraAccess);
        const recordings = patch.recordingAccess !== undefined ? patch.recordingAccess : (roleWasAdmin ? [] : current.recordingAccess);
        this.setCameraPermissions(id, live, recordings);
      }
    }

    return this.public(this.get(id)!);
  }

  setCameraPermissions(userId: string, liveAccess: CameraAccess, recordingAccess: CameraAccess): PublicUser | null {
    const userRow = this.db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role?: string } | undefined;
    if (!userRow) return null;
    if (userRow.role === 'Admin') {
      this.db.prepare('DELETE FROM user_camera_access WHERE user_id = ?').run(userId);
      this.db.prepare('UPDATE users SET camera_access_json = ?, updated_at = ? WHERE id = ?').run('"all"', new Date().toISOString(), userId);
      return this.public(this.get(userId)!);
    }

    const liveIds = new Set(this.resolveCameraIds(liveAccess));
    const recordingIds = new Set(this.resolveCameraIds(recordingAccess));
    // Viewing a recording for a camera should never create a hidden camera reference in the UI.
    for (const cameraId of recordingIds) liveIds.add(cameraId);

    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM user_camera_access WHERE user_id = ?').run(userId);
      const insert = this.db.prepare(`
        INSERT INTO user_camera_access (user_id, camera_id, can_view_live, can_view_recordings, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const cameraId of liveIds) {
        insert.run(userId, cameraId, 1, recordingIds.has(cameraId) ? 1 : 0, now, now);
      }
      this.db.prepare('UPDATE users SET camera_access_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...liveIds]), now, userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.public(this.get(userId)!);
  }

  removeCameraAccess(cameraId: string): void {
    this.db.prepare('DELETE FROM user_camera_access WHERE camera_id = ?').run(cameraId);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  bumpSecurityVersion(id: string): number {
    this.db.prepare('UPDATE users SET security_version = security_version + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.get(id)?.security_version || 0;
  }

  touchLogin(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET last_login=?, updated_at=? WHERE id=?').run(now, now, id);
  }

  close(): void { this.db.close(); }

  toPublic(user: StoredUser): PublicUser { return this.public(user); }

  private resolveCameraIds(access: CameraAccess): string[] {
    const validRows = this.db.prepare('SELECT id FROM cameras ORDER BY created_at ASC').all() as Array<{ id: string }>;
    const valid = new Set(validRows.map((row) => String(row.id)));
    if (access === 'all') return [...valid];
    return [...new Set((Array.isArray(access) ? access : []).map(String).map((id) => id.trim()).filter((id) => valid.has(id)))];
  }

  private accessForUser(userId: string): { cameraAccess: string[]; recordingAccess: string[] } {
    const rows: AccessRow[] = this.db.prepare(`
      SELECT camera_id, can_view_live, can_view_recordings
      FROM user_camera_access
      WHERE user_id = ?
      ORDER BY camera_id ASC
    `).all(userId).map((row) => ({
      camera_id: String(row.camera_id),
      can_view_live: Number(row.can_view_live),
      can_view_recordings: Number(row.can_view_recordings),
    }));
    return {
      cameraAccess: rows.filter((row) => Boolean(row.can_view_live)).map((row) => String(row.camera_id)),
      recordingAccess: rows.filter((row) => Boolean(row.can_view_recordings)).map((row) => String(row.camera_id)),
    };
  }

  private hydrate(row: any): StoredUser {
    const role: UserRole = row.role === 'Admin' ? 'Admin' : 'Viewer';
    const access = role === 'Admin' ? { cameraAccess: 'all' as const, recordingAccess: 'all' as const } : this.accessForUser(String(row.id));
    return {
      id: String(row.id),
      username: String(row.username),
      password_hash: String(row.password_hash),
      role,
      status: row.status === 'Inactive' ? 'Inactive' : 'Active',
      cameraAccess: access.cameraAccess,
      recordingAccess: access.recordingAccess,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      last_login: row.last_login ? String(row.last_login) : null,
      security_version: Number(row.security_version || 1),
      password_changed_at: row.password_changed_at ? String(row.password_changed_at) : null,
      aiEnabled: Boolean(row.ai_enabled),
    };
  }

  private public(user: StoredUser): PublicUser {
    const { password_hash: _password, ...safe } = user;
    return safe;
  }

  private applySecurityMigration(): void {
    const applied = new Set((this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => Number(row.version)));
    if (applied.has(4)) return;
    this.db.exec('BEGIN');
    try {
      this.db.exec(`
        ALTER TABLE users ADD COLUMN security_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN password_changed_at TEXT;
        ALTER TABLE users ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
        UPDATE users SET ai_enabled = 1;
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          remote_address TEXT,
          user_agent TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(revoked_at, expires_at);
      `);
      this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(4, 'persistent_sessions_security_version_ai_grant', new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateLegacyRolesAndAccess(): void {
    // P0.8/P0.9 supported Operator. P0.10 intentionally has only Admin and Viewer.
    this.db.prepare("UPDATE users SET role='Viewer', updated_at=? WHERE role='Operator'").run(new Date().toISOString());

    const viewers = this.db.prepare("SELECT id, camera_access_json FROM users WHERE role != 'Admin'").all() as Array<{ id: string; camera_access_json: string }>;
    const countRows = this.db.prepare('SELECT COUNT(*) AS count FROM user_camera_access WHERE user_id = ?');
    for (const viewer of viewers) {
      const count = Number((countRows.get(viewer.id) as { count: number }).count || 0);
      if (count > 0) continue;

      let legacy: CameraAccess = [];
      try {
        const parsed = JSON.parse(viewer.camera_access_json || '[]');
        if (parsed === 'all' || Array.isArray(parsed)) legacy = parsed;
      } catch {}

      // [] means either a new P0.10 account or a completed migration with no access.
      if (Array.isArray(legacy) && legacy.length === 0) continue;
      const liveIds = this.resolveCameraIds(legacy);
      this.setCameraPermissions(viewer.id, liveIds, []);
    }
  }
}
