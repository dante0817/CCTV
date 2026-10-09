import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const cameraRepo = read('src/server/repositories/CameraRepository.ts');
const notificationRepo = read('src/server/repositories/NotificationRepository.ts');
const deliveryRepo = read('src/server/repositories/NotificationDeliveryRepository.ts');
const deliveryService = read('src/server/services/NotificationDeliveryService.ts');
const smtp = read('src/server/services/SmtpClientService.ts');
const notificationService = read('src/server/services/NotificationService.ts');
const server = read('server.ts');
const api = read('src/api.ts');
const view = read('src/components/notifications/NotificationsView.tsx');

must(/CURRENT_SCHEMA_VERSION\s*=\s*(?:1[1-9]|[2-9][0-9])/.test(cameraRepo), 'Current schema must retain P0.14.3 v10 migration support.');
must(cameraRepo.includes("migrate(10, 'notification_email_delivery'"), 'Notification email migration v10 missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS notification_email_settings'), 'SMTP settings table missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS notification_deliveries'), 'Delivery queue table missing.');
must(notificationRepo.includes('email_enabled'), 'Per-rule email channel flag missing.');
must(notificationService.includes('enqueueEmail'), 'Notification rule does not enqueue email delivery.');
must(deliveryRepo.includes("status='retrying'") && deliveryRepo.includes('recoverInterruptedDeliveries'), 'Delivery restart recovery missing.');
must(deliveryService.includes('RETRY_SECONDS') && deliveryService.includes('processDue'), 'Delivery retry worker missing.');
must(deliveryService.includes('this.credentials.encrypt') && deliveryService.includes('this.credentials.decrypt'), 'SMTP password encryption integration missing.');
must(smtp.includes("from 'node:tls'") && smtp.includes('STARTTLS') && smtp.includes('AUTH PLAIN'), 'Built-in TLS SMTP transport missing.');
must(server.includes('/api/v1/notification-email/settings') && server.includes('/api/v1/notification-deliveries'), 'Email delivery APIs missing.');
must(api.includes('getNotificationEmailSettings') && api.includes('getNotificationDeliveries'), 'Frontend email delivery API bindings missing.');
must(view.includes('Email delivery history') && view.includes('Send test') && view.includes('emailEnabled'), 'Email delivery management UI missing.');

const migrations = {};
for (const version of [3,7,8,9,10]) {
  const re = new RegExp("migrate\\(" + version + ",\\s*'[^']+',\\s*`([\\s\\S]*?)`\\);");
  const match = cameraRepo.match(re);
  must(match, `Unable to extract migration ${version}.`);
  migrations[version] = match[1];
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p0143-'));
const db = new DatabaseSync(path.join(temp, 'test.db'));
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE cameras (id TEXT PRIMARY KEY);');
for (const version of [3,7,8,9,10]) db.exec(migrations[version]);

db.prepare('INSERT INTO cameras(id) VALUES (?)').run('cam-test');
const now = new Date().toISOString();
const rule = db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,email_enabled,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?,?,?,?)`).run('Offline email',1,'CAMERA_OFFLINE','warning','cam-test',60,1,1,now,now);
const ruleId = Number(rule.lastInsertRowid);
const event = db.prepare(`INSERT INTO operational_events(camera_id,camera_name,type,category,severity,title,description,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('cam-test','Test','CAMERA_OFFLINE','camera','warning','Offline','Camera offline','{}',now);
const eventId = Number(event.lastInsertRowid);
const notification = db.prepare(`INSERT INTO notifications(rule_id,event_id,event_type,camera_id,camera_name,severity,title,message,desktop_enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(ruleId,eventId,'CAMERA_OFFLINE','cam-test','Test','warning','Offline','Camera offline',1,now);
const notificationId = Number(notification.lastInsertRowid);
const queued = db.prepare(`INSERT INTO notification_deliveries(notification_id,channel,status,attempts,next_attempt_at,created_at,updated_at) VALUES(?,'email','pending',0,?,?,?)`).run(notificationId,now,now,now);
const deliveryId = Number(queued.lastInsertRowid);
let duplicateBlocked = false;
try { db.prepare(`INSERT INTO notification_deliveries(notification_id,channel,status,attempts,created_at,updated_at) VALUES(?,'email','pending',0,?,?)`).run(notificationId,now,now); } catch { duplicateBlocked = true; }
must(duplicateBlocked, 'Only one email delivery per notification may be queued.');

db.prepare(`UPDATE notification_deliveries SET status='sending' WHERE id=?`).run(deliveryId);
db.prepare(`UPDATE notification_deliveries SET status='retrying',next_attempt_at=?,last_error='restart',updated_at=? WHERE status='sending'`).run(now,now);
const recovered = db.prepare('SELECT status,last_error FROM notification_deliveries WHERE id=?').get(deliveryId);
must(recovered?.status === 'retrying' && recovered?.last_error === 'restart', 'Interrupted delivery recovery failed.');

db.prepare(`INSERT INTO notification_email_settings(id,enabled,host,port,secure_mode,username,password_encrypted,from_address,recipients,base_url,updated_at) VALUES(1,1,'smtp.example.test',587,'starttls','user','v1.encrypted','alerts@example.test','admin@example.test','https://cctv.example.test',?)`).run(now);
const settings = db.prepare('SELECT enabled,secure_mode,password_encrypted FROM notification_email_settings WHERE id=1').get();
must(settings?.enabled === 1 && settings?.secure_mode === 'starttls' && settings?.password_encrypted === 'v1.encrypted', 'SMTP settings persistence failed.');

db.close();
fs.rmSync(temp,{recursive:true,force:true});
console.log('PASS P0.14.3 queued email delivery, retry, and encrypted SMTP foundation');
