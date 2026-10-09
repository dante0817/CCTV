import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type SmtpSecureMode = 'none' | 'starttls' | 'tls';
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'retrying' | 'failed';

export interface SmtpSettingsRow {
  enabled: boolean;
  host: string;
  port: number;
  secure_mode: SmtpSecureMode;
  username: string;
  password_encrypted: string;
  from_address: string;
  recipients: string;
  base_url: string;
  updated_at: string;
}

export interface NotificationDeliveryRow {
  id: number;
  notification_id: number;
  channel: 'email';
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class NotificationDeliveryRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }

  getSmtpSettings(): SmtpSettingsRow {
    const row = this.db.prepare('SELECT * FROM notification_email_settings WHERE id=1').get() as any;
    if (row) return this.mapSettings(row);
    return {
      enabled: false, host: '', port: 587, secure_mode: 'starttls', username: '', password_encrypted: '',
      from_address: '', recipients: '', base_url: '', updated_at: '',
    };
  }

  saveSmtpSettings(input: Omit<SmtpSettingsRow, 'updated_at'>): SmtpSettingsRow {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO notification_email_settings(id,enabled,host,port,secure_mode,username,password_encrypted,from_address,recipients,base_url,updated_at)
      VALUES(1,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        enabled=excluded.enabled,host=excluded.host,port=excluded.port,secure_mode=excluded.secure_mode,
        username=excluded.username,password_encrypted=excluded.password_encrypted,from_address=excluded.from_address,
        recipients=excluded.recipients,base_url=excluded.base_url,updated_at=excluded.updated_at
    `).run(input.enabled ? 1 : 0, input.host, input.port, input.secure_mode, input.username, input.password_encrypted,
      input.from_address, input.recipients, input.base_url, now);
    return this.getSmtpSettings();
  }

  enqueueEmail(notificationId: number): NotificationDeliveryRow | null {
    const now = new Date().toISOString();
    try {
      const result = this.db.prepare(`
        INSERT INTO notification_deliveries(notification_id,channel,status,attempts,next_attempt_at,last_attempt_at,sent_at,last_error,created_at,updated_at)
        VALUES(?,'email','pending',0,?,NULL,NULL,NULL,?,?)
      `).run(notificationId, now, now, now);
      return this.getDelivery(Number(result.lastInsertRowid));
    } catch (error: any) {
      if (String(error?.message || '').toLowerCase().includes('unique')) return null;
      throw error;
    }
  }

  getDelivery(id: number): NotificationDeliveryRow | null {
    const row = this.db.prepare('SELECT * FROM notification_deliveries WHERE id=?').get(id) as any;
    return row ? this.mapDelivery(row) : null;
  }

  listDeliveries(limit = 200): NotificationDeliveryRow[] {
    const safe = Math.max(1, Math.min(1000, Math.trunc(limit)));
    return (this.db.prepare('SELECT * FROM notification_deliveries ORDER BY id DESC LIMIT ?').all(safe) as any[]).map((row) => this.mapDelivery(row));
  }

  recoverInterruptedDeliveries(): number {
    const now = new Date().toISOString();
    return Number(this.db.prepare(`
      UPDATE notification_deliveries
      SET status='retrying',next_attempt_at=?,last_error=COALESCE(last_error,'Delivery interrupted by process restart.'),updated_at=?
      WHERE status='sending'
    `).run(now, now).changes || 0);
  }

  dueDeliveries(limit = 10): NotificationDeliveryRow[] {
    const now = new Date().toISOString();
    const safe = Math.max(1, Math.min(50, Math.trunc(limit)));
    return (this.db.prepare(`
      SELECT * FROM notification_deliveries
      WHERE status IN ('pending','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY id ASC LIMIT ?
    `).all(now, safe) as any[]).map((row) => this.mapDelivery(row));
  }

  markSending(id: number): NotificationDeliveryRow | null {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE notification_deliveries SET status='sending',last_attempt_at=?,updated_at=? WHERE id=? AND status IN ('pending','retrying')`).run(now, now, id);
    return this.getDelivery(id);
  }

  markSent(id: number): NotificationDeliveryRow | null {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE notification_deliveries SET status='sent',attempts=attempts+1,sent_at=?,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?`).run(now, now, id);
    return this.getDelivery(id);
  }

  markRetry(id: number, error: string, nextAttemptAt: string, terminal = false): NotificationDeliveryRow | null {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE notification_deliveries SET status=?,attempts=attempts+1,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?`)
      .run(terminal ? 'failed' : 'retrying', terminal ? null : nextAttemptAt, error.slice(0, 1000), now, id);
    return this.getDelivery(id);
  }

  resetForRetry(id: number): NotificationDeliveryRow | null {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE notification_deliveries SET status='pending',attempts=0,next_attempt_at=?,last_attempt_at=NULL,sent_at=NULL,last_error=NULL,updated_at=? WHERE id=?`).run(now, now, id);
    return this.getDelivery(id);
  }

  close(): void { this.db.close(); }

  private mapSettings(row: any): SmtpSettingsRow {
    const mode: SmtpSecureMode = row.secure_mode === 'tls' || row.secure_mode === 'none' ? row.secure_mode : 'starttls';
    return {
      enabled: Boolean(row.enabled), host: String(row.host || ''), port: Number(row.port || 587), secure_mode: mode,
      username: String(row.username || ''), password_encrypted: String(row.password_encrypted || ''),
      from_address: String(row.from_address || ''), recipients: String(row.recipients || ''), base_url: String(row.base_url || ''),
      updated_at: String(row.updated_at || ''),
    };
  }

  private mapDelivery(row: any): NotificationDeliveryRow {
    return {
      id: Number(row.id), notification_id: Number(row.notification_id), channel: 'email', status: row.status as DeliveryStatus,
      attempts: Number(row.attempts || 0), next_attempt_at: row.next_attempt_at == null ? null : String(row.next_attempt_at),
      last_attempt_at: row.last_attempt_at == null ? null : String(row.last_attempt_at), sent_at: row.sent_at == null ? null : String(row.sent_at),
      last_error: row.last_error == null ? null : String(row.last_error), created_at: String(row.created_at), updated_at: String(row.updated_at),
    };
  }
}
