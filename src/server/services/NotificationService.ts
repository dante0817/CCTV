import type { OperationalEventRow, OperationalEventSeverity } from '../repositories/OperationalEventRepository';
import { NotificationRepository, type NotificationRuleRow, type NotificationRow } from '../repositories/NotificationRepository';
import type { NotificationDeliveryRepository } from '../repositories/NotificationDeliveryRepository';

const severityRank: Record<OperationalEventSeverity, number> = { info: 1, warning: 2, critical: 3 };

export interface ClientNotificationRule {
  id: number; name: string; enabled: boolean; eventType: string; minimumSeverity: OperationalEventSeverity;
  cameraId: string | null; zoneId: number | null; cooldownSeconds: number; desktopEnabled: boolean; emailEnabled: boolean; updatedAt: string;
}
export interface ClientNotification {
  id: number; ruleId: number; eventId: number; eventType: string; cameraId: string | null; cameraName: string | null;
  zoneName: string | null; severity: OperationalEventSeverity; title: string; message: string; desktopEnabled: boolean;
  createdAt: string; readAt: string | null;
}

export class NotificationService {
  constructor(private repo: NotificationRepository, private deliveryRepo?: NotificationDeliveryRepository) {}

  handleOperationalEvent(event: OperationalEventRow): void {
    const zoneId = Number(event.metadata?.zoneId || 0) || null;
    for (const rule of this.repo.listRules()) {
      if (!this.matches(rule, event, zoneId)) continue;
      const last = this.repo.lastNotificationAt(rule.id, event.camera_id);
      if (last && rule.cooldown_seconds > 0 && Date.now() - new Date(last).getTime() < rule.cooldown_seconds * 1000) continue;
      const notification = this.repo.createNotification({
        ruleId: rule.id, eventId: event.id, eventType: event.type, cameraId: event.camera_id, cameraName: event.camera_name,
        zoneName: typeof event.metadata?.zoneName === 'string' ? event.metadata.zoneName : null, severity: event.severity,
        title: event.title, message: event.description, desktopEnabled: rule.desktop_enabled,
      });
      if (notification && rule.email_enabled) this.deliveryRepo?.enqueueEmail(notification.id);
    }
  }

  list(limit = 200, unreadOnly = false): ClientNotification[] { return this.repo.listNotifications(limit, unreadOnly).map((row) => this.toClient(row)); }
  unreadCount(): number { return this.repo.unreadCount(); }
  markRead(id: number): ClientNotification | null { const row = this.repo.markRead(id); return row ? this.toClient(row) : null; }
  markAllRead(): number { return this.repo.markAllRead(); }
  rules(): ClientNotificationRule[] { return this.repo.listRules().map((row) => this.ruleClient(row)); }
  createRule(input: Parameters<NotificationRepository['createRule']>[0]): ClientNotificationRule { return this.ruleClient(this.repo.createRule(input)); }
  updateRule(id: number, input: Parameters<NotificationRepository['updateRule']>[1]): ClientNotificationRule | null { const row = this.repo.updateRule(id, input); return row ? this.ruleClient(row) : null; }
  deleteRule(id: number): boolean { return this.repo.deleteRule(id); }
  close(): void { this.repo.close(); }

  private matches(rule: NotificationRuleRow, event: OperationalEventRow, zoneId: number | null): boolean {
    if (!rule.enabled) return false;
    if (rule.event_type !== '*' && rule.event_type !== event.type) return false;
    if (severityRank[event.severity] < severityRank[rule.minimum_severity]) return false;
    if (rule.camera_id && rule.camera_id !== event.camera_id) return false;
    if (rule.zone_id && rule.zone_id !== zoneId) return false;
    return true;
  }

  private ruleClient(row: NotificationRuleRow): ClientNotificationRule {
    return { id: row.id, name: row.name, enabled: row.enabled, eventType: row.event_type, minimumSeverity: row.minimum_severity,
      cameraId: row.camera_id, zoneId: row.zone_id, cooldownSeconds: row.cooldown_seconds, desktopEnabled: row.desktop_enabled, emailEnabled: row.email_enabled, updatedAt: row.updated_at };
  }
  private toClient(row: NotificationRow): ClientNotification {
    return { id: row.id, ruleId: row.rule_id, eventId: row.event_id, eventType: row.event_type, cameraId: row.camera_id,
      cameraName: row.camera_name, zoneName: row.zone_name, severity: row.severity, title: row.title, message: row.message,
      desktopEnabled: row.desktop_enabled, createdAt: row.created_at, readAt: row.read_at };
  }
}
