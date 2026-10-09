import type { NotificationRepository, NotificationRow } from '../repositories/NotificationRepository';
import { NotificationDeliveryRepository, type NotificationDeliveryRow, type SmtpSecureMode } from '../repositories/NotificationDeliveryRepository';
import type { CredentialService } from './CredentialService';
import { SmtpClientService } from './SmtpClientService';
import { logLine } from './LoggingService';

export interface ClientSmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secureMode: SmtpSecureMode;
  username: string;
  passwordConfigured: boolean;
  fromAddress: string;
  recipients: string[];
  baseUrl: string;
  updatedAt: string;
}

export interface ClientDelivery {
  id: number;
  notificationId: number;
  channel: 'email';
  status: NotificationDeliveryRow['status'];
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  cameraName: string | null;
}

const RETRY_SECONDS = [60, 300, 900, 3600];

function parseRecipients(raw: string): string[] {
  return [...new Set(raw.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

function isEmailLike(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

export class NotificationDeliveryService {
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private smtp = new SmtpClientService();

  constructor(
    private repo: NotificationDeliveryRepository,
    private notifications: NotificationRepository,
    private credentials: CredentialService,
  ) {}

  start(): void {
    if (this.timer) return;
    const recovered = this.repo.recoverInterruptedDeliveries();
    if (recovered > 0) logLine('notification-email', 'WARN', `Recovered ${recovered} interrupted email delivery row(s) after restart.`);
    this.timer = setInterval(() => { void this.processDue(); }, 15000);
    this.timer.unref?.();
    void this.processDue();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close(): void { this.stop(); this.repo.close(); }

  settings(): ClientSmtpSettings {
    const row = this.repo.getSmtpSettings();
    return {
      enabled: row.enabled, host: row.host, port: row.port, secureMode: row.secure_mode, username: row.username,
      passwordConfigured: Boolean(row.password_encrypted), fromAddress: row.from_address, recipients: parseRecipients(row.recipients),
      baseUrl: row.base_url, updatedAt: row.updated_at,
    };
  }

  saveSettings(input: Partial<{
    enabled: boolean; host: string; port: number; secureMode: SmtpSecureMode; username: string; password: string;
    clearPassword: boolean; fromAddress: string; recipients: string[] | string; baseUrl: string;
  }>): ClientSmtpSettings {
    const current = this.repo.getSmtpSettings();
    const host = String(input.host ?? current.host).trim().slice(0, 255);
    const portRaw = Number(input.port ?? current.port);
    const port = Number.isFinite(portRaw) ? Math.max(1, Math.min(65535, Math.trunc(portRaw))) : 587;
    const secureMode: SmtpSecureMode = input.secureMode === 'none' || input.secureMode === 'tls' ? input.secureMode : (input.secureMode === 'starttls' ? 'starttls' : current.secure_mode);
    const username = String(input.username ?? current.username).trim().slice(0, 255);
    let passwordEncrypted = current.password_encrypted;
    if (input.clearPassword) passwordEncrypted = '';
    else if (input.password !== undefined && String(input.password).length > 0) passwordEncrypted = this.credentials.encrypt(String(input.password));
    const fromAddress = String(input.fromAddress ?? current.from_address).trim().slice(0, 320);
    const recipientInput = Array.isArray(input.recipients) ? input.recipients.join(',') : String(input.recipients ?? current.recipients);
    const recipients = parseRecipients(recipientInput);
    const invalidRecipient = recipients.find((value) => !isEmailLike(value));
    if (invalidRecipient) throw new Error(`Invalid email recipient: ${invalidRecipient}`);
    if (fromAddress && !isEmailLike(fromAddress.replace(/^.*<([^<>]+)>.*$/, '$1'))) throw new Error('Invalid SMTP From address.');
    let baseUrl = String(input.baseUrl ?? current.base_url).trim().slice(0, 500);
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error('CCTV link must start with http:// or https://.');
    baseUrl = baseUrl.replace(/\/+$/, '');
    const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
    if (enabled && (!host || !fromAddress || recipients.length === 0)) throw new Error('SMTP host, From address, and at least one recipient are required when email delivery is enabled.');
    this.repo.saveSmtpSettings({ enabled, host, port, secure_mode: secureMode, username, password_encrypted: passwordEncrypted, from_address: fromAddress, recipients: recipients.join(','), base_url: baseUrl });
    if (enabled) void this.processDue();
    return this.settings();
  }

  list(limit = 200): ClientDelivery[] { return this.repo.listDeliveries(limit).map((row) => this.toClient(row)); }

  retry(id: number): ClientDelivery | null {
    const row = this.repo.resetForRetry(id);
    if (row) void this.processDue();
    return row ? this.toClient(row) : null;
  }

  async sendTest(): Promise<void> {
    const settings = this.repo.getSmtpSettings();
    const to = parseRecipients(settings.recipients);
    await this.sendUsingSettings(settings, to, '[CCTV Monitor] Test email', [
      'CCTV Monitor SMTP configuration test.', '', `Time: ${new Date().toLocaleString()}`, '',
      'If you received this message, external email delivery is configured correctly.',
    ].join('\n'));
  }

  async processDue(): Promise<void> {
    if (this.processing) return;
    const settings = this.repo.getSmtpSettings();
    if (!settings.enabled) return;
    this.processing = true;
    try {
      for (const due of this.repo.dueDeliveries(10)) {
        const claimed = this.repo.markSending(due.id);
        if (!claimed || claimed.status !== 'sending') continue;
        const notification = this.notifications.getNotification(claimed.notification_id);
        if (!notification) {
          this.repo.markRetry(claimed.id, 'Notification no longer exists.', new Date().toISOString(), true);
          continue;
        }
        try {
          const recipients = parseRecipients(settings.recipients);
          await this.sendUsingSettings(settings, recipients, `[CCTV] ${notification.title}`, this.messageFor(notification, settings.base_url));
          this.repo.markSent(claimed.id);
          logLine('notification-email', 'INFO', `Email delivery ${claimed.id} sent for notification ${notification.id}.`);
        } catch (error: any) {
          const attempt = claimed.attempts + 1;
          const terminal = attempt >= 5;
          const delay = RETRY_SECONDS[Math.min(attempt - 1, RETRY_SECONDS.length - 1)] || 3600;
          const next = new Date(Date.now() + delay * 1000).toISOString();
          this.repo.markRetry(claimed.id, error?.message || String(error), next, terminal);
          logLine('notification-email', terminal ? 'ERROR' : 'WARN', `Email delivery ${claimed.id} ${terminal ? 'failed' : 'will retry'}: ${error?.message || error}`);
        }
      }
    } finally { this.processing = false; }
  }

  private async sendUsingSettings(settings: ReturnType<NotificationDeliveryRepository['getSmtpSettings']>, recipients: string[], subject: string, text: string): Promise<void> {
    if (!settings.host.trim()) throw new Error('SMTP host is not configured.');
    if (!settings.from_address.trim()) throw new Error('SMTP From address is not configured.');
    if (!recipients.length) throw new Error('SMTP recipient list is empty.');
    const password = settings.password_encrypted ? this.credentials.decrypt(settings.password_encrypted) : '';
    await this.smtp.send({ host: settings.host, port: settings.port, secureMode: settings.secure_mode, username: settings.username, password,
      from: settings.from_address, to: recipients, subject, text, timeoutMs: 15000 });
  }

  private messageFor(notification: NotificationRow, baseUrl: string): string {
    const lines = [
      notification.title,
      '',
      notification.message,
      '',
      `Severity: ${notification.severity.toUpperCase()}`,
      `Event: ${notification.event_type}`,
      `Time: ${new Date(notification.created_at).toLocaleString()}`,
    ];
    if (notification.camera_name) lines.push(`Camera: ${notification.camera_name}`);
    if (notification.zone_name) lines.push(`Zone: ${notification.zone_name}`);
    if (baseUrl) lines.push('', `Open CCTV Monitor: ${baseUrl}`);
    lines.push('', 'This message was generated by CCTV Monitor.');
    return lines.join('\n');
  }

  private toClient(row: NotificationDeliveryRow): ClientDelivery {
    const notification = this.notifications.getNotification(row.notification_id);
    return { id: row.id, notificationId: row.notification_id, channel: row.channel, status: row.status, attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at, lastAttemptAt: row.last_attempt_at, sentAt: row.sent_at, lastError: row.last_error,
      createdAt: row.created_at, updatedAt: row.updated_at, title: notification?.title ?? null, cameraName: notification?.camera_name ?? null };
  }
}
