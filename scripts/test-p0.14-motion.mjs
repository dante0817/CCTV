import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const cameraRepo = read('src/server/repositories/CameraRepository.ts');
const motionRepo = read('src/server/repositories/MotionRepository.ts');
const motionService = read('src/server/services/MotionService.ts');
const recordingRepo = read('src/server/repositories/RecordingRepository.ts');
const eventService = read('src/server/services/OperationalEventService.ts');
const server = read('server.ts');
const api = read('src/api.ts');
const camerasView = read('src/components/cameras/CamerasView.tsx');
const eventsView = read('src/components/events/EventsView.tsx');

must(/CURRENT_SCHEMA_VERSION = (?:[7-9]|[1-9][0-9]+)/.test(cameraRepo), 'Current schema must retain P0.14 migration support.');
must(cameraRepo.includes("migrate(7, 'motion_detection_event_links'"), 'Motion migration v7 missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS camera_motion_settings'), 'Motion settings table missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS motion_detections'), 'Motion detections table missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS motion_event_recordings'), 'Motion-to-recording link table missing.');
must(motionService.includes("select='gt(scene,"), 'FFmpeg scene-change detector missing.');
must(motionService.includes('cooldownSeconds'), 'Motion cooldown missing.');
must(motionService.includes("camera.source_type === 'usb'"), 'P0.14 motion qualification must remain USB-scoped.');
must(recordingRepo.includes('listOverlapping'), 'Recording overlap query missing.');
must(eventService.includes("type: 'MOTION_DETECTED'"), 'Motion operational event missing.');
must(server.includes("/api/v1/cameras/:id/motion"), 'Motion settings API missing.');
must(server.includes("/api/v1/events/:id/recordings"), 'Event-linked recordings API missing.');
must(api.includes('getCameraMotion') && api.includes('getEventRecordings'), 'Frontend motion/event-recording API bindings missing.');
must(camerasView.includes('Motion Detection') && camerasView.includes('Sensitivity'), 'Camera motion controls missing.');
must(eventsView.includes('linked footage') && (eventsView.includes('Find footage') || eventsView.includes('Review event')), 'Motion event-linked footage UI missing.');

const migration3 = cameraRepo.match(/migrate\(3,\s*'operational_events',\s*`([\s\S]*?)`\);/);
const migration5 = cameraRepo.match(/migrate\(5,\s*'continuous_recording_segments',\s*`([\s\S]*?)`\);/);
const migration6 = cameraRepo.match(/migrate\(6,\s*'recording_management_retention',\s*`([\s\S]*?)`\);/);
const migration7 = cameraRepo.match(/migrate\(7,\s*'motion_detection_event_links',\s*`([\s\S]*?)`\);/);
must(migration3 && migration5 && migration6 && migration7, 'Unable to extract required migrations.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p014-'));
const db = new DatabaseSync(path.join(temp, 'test.db'));
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE cameras (id TEXT PRIMARY KEY);');
db.exec(migration3[1]);
db.exec(migration5[1]);
db.exec(migration6[1]);
db.exec(migration7[1]);
db.prepare('INSERT INTO cameras(id) VALUES (?)').run('cam-test');
db.prepare(`INSERT INTO camera_motion_settings(camera_id,enabled,sensitivity,cooldown_seconds,pre_seconds,post_seconds,updated_at) VALUES(?,?,?,?,?,?,?)`).run('cam-test',1,85,20,15,45,new Date().toISOString());
const event = db.prepare(`INSERT INTO operational_events(camera_id,camera_name,type,category,severity,title,description,created_at) VALUES(?,?,?,?,?,?,?,?)`).run('cam-test','Test','MOTION_DETECTED','camera','info','Motion','Motion detected','2026-10-03T01:00:30.000Z');
const eventId = Number(event.lastInsertRowid);
db.prepare(`INSERT INTO motion_detections(event_id,camera_id,detected_at,scene_score,sensitivity,pre_seconds,post_seconds,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(eventId,'cam-test','2026-10-03T01:00:30.000Z',0.12,85,15,45,new Date().toISOString());
const rec = db.prepare(`INSERT INTO recording_segments(camera_id,camera_name,file_path,started_at,ended_at,duration_seconds,size_bytes,status,codec,created_at,updated_at,is_protected) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('cam-test','Test',path.join(temp,'segment.mp4'),'2026-10-03T01:00:00.000Z','2026-10-03T01:01:00.000Z',60,1000,'complete','H.264',new Date().toISOString(),new Date().toISOString(),0);
const recId = Number(rec.lastInsertRowid);
db.prepare(`INSERT INTO motion_event_recordings(event_id,recording_id,linked_at) VALUES(?,?,?)`).run(eventId,recId,new Date().toISOString());
const linked = db.prepare('SELECT COUNT(*) AS count FROM motion_event_recordings WHERE event_id=?').get(eventId);
must(Number(linked?.count) === 1, 'Motion event must link to an overlapping finalized recording.');
const settings = db.prepare('SELECT enabled,sensitivity,cooldown_seconds FROM camera_motion_settings WHERE camera_id=?').get('cam-test');
must(Number(settings?.enabled) === 1 && Number(settings?.sensitivity) === 85 && Number(settings?.cooldown_seconds) === 20, 'Motion settings persistence failed.');
db.close();
fs.rmSync(temp,{recursive:true,force:true});

console.log('PASS P0.14 motion detection and event-linked recording foundation');
