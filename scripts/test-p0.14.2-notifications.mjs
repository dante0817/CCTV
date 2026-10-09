import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const cameraRepo = read('src/server/repositories/CameraRepository.ts');
const notificationRepo = read('src/server/repositories/NotificationRepository.ts');
const notificationService = read('src/server/services/NotificationService.ts');
const eventService = read('src/server/services/OperationalEventService.ts');
const server = read('server.ts');
const api = read('src/api.ts');
const app = read('src/App.tsx');
const view = read('src/components/notifications/NotificationsView.tsx');
const permissions = read('src/security/permissions.ts');

must(cameraRepo.includes("migrate(9, 'notification_alert_rules'"), 'P0.14.2 migration v9 must remain present in later schemas.');
must(cameraRepo.includes("migrate(9, 'notification_alert_rules'"), 'Notification migration v9 missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS notification_rules'), 'Notification rules table missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS notifications'), 'Notification inbox table missing.');
must(notificationRepo.includes('UNIQUE(rule_id, event_id)') || cameraRepo.includes('UNIQUE(rule_id, event_id)'), 'Duplicate event/rule suppression missing.');
must(notificationService.includes('cooldown_seconds') && notificationService.includes('severityRank'), 'Notification cooldown/severity matching missing.');
must(eventService.includes('onRecorded') && eventService.includes('this.listeners'), 'Operational-event subscription hook missing.');
must(server.includes("/api/v1/notification-rules") && server.includes("/api/v1/notifications"), 'Notification APIs missing.');
must(api.includes('getNotifications') && api.includes('createNotificationRule'), 'Frontend notification API bindings missing.');
must(app.includes("new Notification(item.title") && app.includes("activeTab === 'notifications'"), 'Desktop/in-app notification integration missing.');
must(view.includes('Notifications & Alert Rules') && view.includes('Cooldown seconds'), 'Notification management UI missing.');
must(permissions.includes("'notification:view'") && permissions.includes("'notification:manage'"), 'Notification permissions missing.');

const migrations = {};
for (const version of [3,7,8,9]) {
  const re = new RegExp("migrate\\(" + version + ",\\s*'[^']+',\\s*`([\\s\\S]*?)`\\);");
  const match = cameraRepo.match(re);
  must(match, `Unable to extract migration ${version}.`);
  migrations[version] = match[1];
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p0142-'));
const db = new DatabaseSync(path.join(temp, 'test.db'));
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE cameras (id TEXT PRIMARY KEY);');
for (const version of [3,7,8,9]) db.exec(migrations[version]);
db.prepare('INSERT INTO cameras(id) VALUES (?)').run('cam-test');
const zone = db.prepare(`INSERT INTO motion_zones(camera_id,name,enabled,x,y,width,height,sensitivity,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('cam-test','Door',1,10,20,40,50,90,new Date().toISOString());
const zoneId = Number(zone.lastInsertRowid);
const rule = db.prepare(`INSERT INTO notification_rules(name,enabled,event_type,minimum_severity,camera_id,zone_id,cooldown_seconds,desktop_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run('Door motion',1,'MOTION_DETECTED','info','cam-test',zoneId,20,1,new Date().toISOString(),new Date().toISOString());
const ruleId = Number(rule.lastInsertRowid);
const event = db.prepare(`INSERT INTO operational_events(camera_id,camera_name,type,category,severity,title,description,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('cam-test','Test','MOTION_DETECTED','camera','info','Door motion','Motion in Door',JSON.stringify({zoneId,zoneName:'Door'}),new Date().toISOString());
const eventId = Number(event.lastInsertRowid);
db.prepare(`INSERT INTO notifications(rule_id,event_id,event_type,camera_id,camera_name,zone_name,severity,title,message,desktop_enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(ruleId,eventId,'MOTION_DETECTED','cam-test','Test','Door','info','Door motion','Motion in Door',1,new Date().toISOString());
let duplicateBlocked = false;
try { db.prepare(`INSERT INTO notifications(rule_id,event_id,event_type,severity,title,message,desktop_enabled,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(ruleId,eventId,'MOTION_DETECTED','info','Duplicate','Duplicate',1,new Date().toISOString()); } catch { duplicateBlocked = true; }
must(duplicateBlocked, 'Duplicate rule/event notification must be blocked.');
db.prepare('UPDATE notifications SET read_at=? WHERE rule_id=? AND event_id=?').run(new Date().toISOString(),ruleId,eventId);
const inbox = db.prepare('SELECT read_at,zone_name FROM notifications WHERE rule_id=? AND event_id=?').get(ruleId,eventId);
must(Boolean(inbox?.read_at) && inbox?.zone_name === 'Door', 'Notification read/zone persistence failed.');
db.prepare('DELETE FROM motion_zones WHERE id=?').run(zoneId);
const ruleAfterZoneDelete = db.prepare('SELECT zone_id FROM notification_rules WHERE id=?').get(ruleId);
must(ruleAfterZoneDelete?.zone_id == null, 'Deleting a motion zone must clear the alert-rule zone FK.');
db.close();
fs.rmSync(temp,{recursive:true,force:true});

console.log('PASS P0.14.2 notification rules, inbox, cooldown, and browser alert foundation');
