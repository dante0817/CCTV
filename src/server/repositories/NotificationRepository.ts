import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { OperationalEventSeverity } from './OperationalEventRepository';

export interface NotificationRuleRow {
  id: number;
  name: string;
  enabled: boolean;
  event_type: string;
  minimum_severity: OperationalEventSeverity;
  camera_id: string | null;
  zone_id: number | null;
  cooldown_seconds: number;
  desktop_enabled: boolean;
  email_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: number;
  rule_id: number;
  event_id: number;
  event_type: string;
  camera_id: string | null;
  camera_name: string | null;
  zone_name: string | null;
  severity: OperationalEventSeverity;
  title: string;
  message: string;
  desktop_enabled: boolean;
  created_at: string;
  read_at: string | null;
}

export class NotificationRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.seedDefaults();
  }

  listRules(): NotificationRuleRow[] {
    return (this.db.prepare('SELECT * FROM notification_rules ORDER BY id ASC').all() as any[]).map((row) => this.mapRule(row));
  }

  getRule(id: number): NotificationRuleRow | null {
    const row = this.db.prepare('SELECT * FROM notification_rules WHERE id=?').get(id) as any;
    return row ? this.mapRule(row) : null;
  }

  createRule(input: {
    name: string; enabled?: boolean; eventType?: string; minimumSeverity?: OperationalEventSeverity;
    cameraId?: string | null; zoneId?: number | null; cooldownSeconds?: number; desktopEnabled?: boolean; emailEnabled?: boolean;
  }): NotificationRuleRow {
    const now = new Date().toISOString();
    const normalized = this.normalizeRule(input);
    const result = this.db.prepare(`
      INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(normalized.name, normalized.enabled ? 1 : 0, normalized.eventType, normalized.minimumSeverity, normalized.cameraId,
      normalized.zoneId, normalized.cooldownSeconds, normalized.desktopEnabled ? 1 : 0, normalized.emailEnabled ? 1 : 0, now, now);
    return this.getRule(Number(result.lastInsertRowid))!;
  }

  updateRule(id: number, input: Partial<{
    name: string; enabled: boolean; eventType: string; minimumSeverity: OperationalEventSeverity;
    cameraId: string | null; zoneId: number | null; cooldownSeconds: number; desktopEnabled: boolean; emailEnabled: boolean;
  }>): NotificationRuleRow | null {
    const current = this.getRule(id);
    if (!current) return null;
    const normalized = this.normalizeRule({
      name: input.name ?? current.name,
      enabled: input.enabled ?? current.enabled,
      eventType: input.eventType ?? current.event_type,
      minimumSeverity: input.minimumSeverity ?? current.minimum_severity,
      cameraId: input.cameraId === undefined ? current.camera_id : input.cameraId,
      zoneId: input.zoneId === undefined ? current.zone_id : input.zoneId,
      cooldownSeconds: input.cooldownSeconds ?? current.cooldown_seconds,
      desktopEnabled: input.desktopEnabled ?? current.desktop_enabled,
      emailEnabled: input.emailEnabled ?? current.email_enabled,
    });
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE notification_rules SET name=?,enabled=?,event_type=?,minimum_severity=?,camera_id=?,zone_id=?,cooldown_seconds=?,desktop_enabled=?,email_enabled=?,updated_at=? WHERE id=?`)
      .run(normalized.name, normalized.enabled ? 1 : 0, normalized.eventType, normalized.minimumSeverity, normalized.cameraId,
        normalized.zoneId, normalized.cooldownSeconds, normalized.desktopEnabled ? 1 : 0, normalized.emailEnabled ? 1 : 0, now, id);
    return this.getRule(id);
  }

  deleteRule(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM notification_rules WHERE id=?').run(id).changes || 0) > 0;
  }

  createNotification(input: {
    ruleId: number; eventId: number; eventType: string; cameraId?: string | null; cameraName?: string | null;
    zoneName?: string | null; severity: OperationalEventSeverity; title: string; message: string; desktopEnabled: boolean;
  }): NotificationRow | null {
    const now = new Date().toISOString();
    try {
      const result = this.db.prepare(`
        INSERT INTO notifications(rule_id,event_id,event_type,camera_id,camera_name,zone_name,severity,title,message,desktop_enabled,created_at,read_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)
      `).run(input.ruleId, input.eventId, input.eventType, input.cameraId ?? null, input.cameraName ?? null, input.zoneName ?? null,
        input.severity, input.title, input.message, input.desktopEnabled ? 1 : 0, now);
      return this.getNotification(Number(result.lastInsertRowid));
    } catch (error: any) {
      if (String(error?.message || '').toLowerCase().includes('unique')) return null;
      throw error;
    }
  }

  getNotification(id: number): NotificationRow | null {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id=?').get(id) as any;
    return row ? this.mapNotification(row) : null;
  }

  listNotifications(limit = 200, unreadOnly = false): NotificationRow[] {
    const safe = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const sql = unreadOnly
      ? 'SELECT * FROM notifications WHERE read_at IS NULL ORDER BY id DESC LIMIT ?'
      : 'SELECT * FROM notifications ORDER BY id DESC LIMIT ?';
    return (this.db.prepare(sql).all(safe) as any[]).map((row) => this.mapNotification(row));
  }

  unreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL').get() as any;
    return Number(row?.count || 0);
  }

  markRead(id: number): NotificationRow | null {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=?').run(now, id);
    return this.getNotification(id);
  }

  markAllRead(): number {
    const now = new Date().toISOString();
    return Number(this.db.prepare('UPDATE notifications SET read_at=? WHERE read_at IS NULL').run(now).changes || 0);
  }

  lastNotificationAt(ruleId: number, cameraId: string | null): string | null {
    const row = cameraId
      ? this.db.prepare('SELECT created_at FROM notifications WHERE rule_id=? AND camera_id=? ORDER BY id DESC LIMIT 1').get(ruleId, cameraId) as any
      : this.db.prepare('SELECT created_at FROM notifications WHERE rule_id=? AND camera_id IS NULL ORDER BY id DESC LIMIT 1').get(ruleId) as any;
    return row?.created_at ? String(row.created_at) : null;
  }

  close(): void { this.db.close(); }

  private normalizeRule(input: any) {
    const severity: OperationalEventSeverity = input.minimumSeverity === 'info' || input.minimumSeverity === 'critical' ? input.minimumSeverity : 'warning';
    const cooldown = Number(input.cooldownSeconds);
    const zoneId = input.zoneId == null || input.zoneId === '' ? null : Number(input.zoneId);
    return {
      name: String(input.name || 'Alert rule').trim().slice(0, 80) || 'Alert rule',
      enabled: input.enabled !== false,
      eventType: String(input.eventType || '*').trim().slice(0, 64) || '*',
      minimumSeverity: severity,
      cameraId: input.cameraId ? String(input.cameraId) : null,
      zoneId: zoneId !== null && Number.isInteger(zoneId) && zoneId > 0 ? zoneId : null,
      cooldownSeconds: Number.isFinite(cooldown) ? Math.max(0, Math.min(3600, Math.round(cooldown))) : 60,
      desktopEnabled: input.desktopEnabled !== false,
      emailEnabled: input.emailEnabled === true,
    };
  }

  private mapRule(row: any): NotificationRuleRow {
    return {
      id: Number(row.id), name: String(row.name), enabled: Boolean(row.enabled), event_type: String(row.event_type),
      minimum_severity: row.minimum_severity as OperationalEventSeverity, camera_id: row.camera_id == null ? null : String(row.camera_id),
      zone_id: row.zone_id == null ? null : Number(row.zone_id), cooldown_seconds: Number(row.cooldown_seconds || 0),
      desktop_enabled: Boolean(row.desktop_enabled), email_enabled: Boolean(row.email_enabled), created_at: String(row.created_at), updated_at: String(row.updated_at),
    };
  }

  private mapNotification(row: any): NotificationRow {
    return {
      id: Number(row.id), rule_id: Number(row.rule_id), event_id: Number(row.event_id), event_type: String(row.event_type),
      camera_id: row.camera_id == null ? null : String(row.camera_id), camera_name: row.camera_name == null ? null : String(row.camera_name),
      zone_name: row.zone_name == null ? null : String(row.zone_name), severity: row.severity as OperationalEventSeverity,
      title: String(row.title), message: String(row.message), desktop_enabled: Boolean(row.desktop_enabled), created_at: String(row.created_at),
      read_at: row.read_at == null ? null : String(row.read_at),
    };
  }

  private seedDefaults(): void {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM notification_rules').get() as any;
    if (Number(row?.count || 0) > 0) return;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?)`)
      .run('Critical system alerts', 1, '*', 'critical', 60, 1, 0, now, now);
    this.db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?)`)
      .run('Camera offline alerts', 1, 'CAMERA_OFFLINE', 'warning', 60, 1, 0, now, now);
    this.db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?)`)
      .run('Motion alerts', 0, 'MOTION_DETECTED', 'info', 20, 1, 0, now, now);
    this.db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?)`)
      .run('Person detected alerts', 0, 'PERSON_DETECTED', 'info', 30, 1, 0, now, now);
    this.db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at) VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?)`)
      .run('Vehicle detected alerts', 0, 'VEHICLE_DETECTED', 'info', 30, 1, 0, now, now);
  }
}
