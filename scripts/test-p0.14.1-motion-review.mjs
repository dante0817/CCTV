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
const eventService = read('src/server/services/OperationalEventService.ts');
const server = read('server.ts');
const api = read('src/api.ts');
const camerasView = read('src/components/cameras/CamerasView.tsx');
const eventsView = read('src/components/events/EventsView.tsx');

must(/CURRENT_SCHEMA_VERSION = (?:[89]|[1-9][0-9]+)/.test(cameraRepo), 'Current schema must retain P0.14.1 migration support.');
must(cameraRepo.includes("migrate(8, 'motion_snapshots_zones_review'"), 'P0.14.1 migration v8 missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS motion_zones'), 'Motion zones table missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS motion_event_reviews'), 'Motion review table missing.');
must(cameraRepo.includes('ADD COLUMN snapshot_path TEXT'), 'Motion snapshot column missing.');
must(motionRepo.includes('A camera can have at most 4 motion zones'), 'Motion zone limit missing.');
must(motionService.includes('captureSnapshot'), 'Motion snapshot capture missing.');
must(motionService.includes('drawbox='), 'Zone-highlight snapshot overlay missing.');
must(motionService.includes('desiredTargets'), 'Zone-aware analyzer selection missing.');
must(eventService.includes('zoneName'), 'Zone-aware motion event metadata missing.');
must(server.includes("/api/v1/cameras/:id/motion/zones"), 'Motion zone API missing.');
must(server.includes("/api/v1/events/:id/snapshot"), 'Authenticated snapshot API missing.');
must(server.includes("/api/v1/events/:id/motion-review"), 'Motion review API missing.');
must(api.includes('createMotionZone') && api.includes('getMotionEventContext') && api.includes('updateMotionEventReview'), 'Frontend P0.14.1 API bindings missing.');
must(camerasView.includes('Motion Zones') && camerasView.includes('+ Add Zone'), 'Motion zone UI missing.');
must(eventsView.includes('Motion review & linked footage') && eventsView.includes('Dismiss / false alarm'), 'Motion event review UI missing.');

const migrations = {};
for (const version of [3,5,6,7,8]) {
  const re = new RegExp("migrate\\(" + version + ",\\s*'[^']+',\\s*`([\\s\\S]*?)`\\);");
  const match = cameraRepo.match(re);
  must(match, `Unable to extract migration ${version}.`);
  migrations[version] = match[1];
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p0141-'));
const db = new DatabaseSync(path.join(temp, 'test.db'));
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE cameras (id TEXT PRIMARY KEY);');
for (const version of [3,5,6,7,8]) db.exec(migrations[version]);
db.prepare('INSERT INTO cameras(id) VALUES (?)').run('cam-test');
const zone = db.prepare(`INSERT INTO motion_zones(camera_id,name,enabled,x,y,width,height,sensitivity,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('cam-test','Door',1,10,20,40,50,90,new Date().toISOString());
const zoneId = Number(zone.lastInsertRowid);
const event = db.prepare(`INSERT INTO operational_events(camera_id,camera_name,type,category,severity,title,description,created_at) VALUES(?,?,?,?,?,?,?,?)`).run('cam-test','Test','MOTION_DETECTED','camera','info','Motion','Motion in Door','2026-10-03T01:00:30.000Z');
const eventId = Number(event.lastInsertRowid);
db.prepare(`INSERT INTO motion_detections(event_id,camera_id,detected_at,scene_score,sensitivity,pre_seconds,post_seconds,zone_id,zone_name,snapshot_path,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId,'cam-test','2026-10-03T01:00:30.000Z',0.12,90,15,45,zoneId,'Door','cam-test/1.jpg',new Date().toISOString());
db.prepare(`INSERT INTO motion_event_reviews(event_id,status,note,reviewed_at) VALUES(?,?,?,?)`).run(eventId,'confirmed','Expected test motion',new Date().toISOString());
const detection = db.prepare('SELECT zone_name,snapshot_path FROM motion_detections WHERE event_id=?').get(eventId);
const review = db.prepare('SELECT status,note FROM motion_event_reviews WHERE event_id=?').get(eventId);
must(detection?.zone_name === 'Door' && detection?.snapshot_path === 'cam-test/1.jpg', 'Zone/snapshot persistence failed.');
must(review?.status === 'confirmed' && review?.note === 'Expected test motion', 'Motion review persistence failed.');
db.prepare('DELETE FROM motion_zones WHERE id=?').run(zoneId);
const preserved = db.prepare('SELECT zone_id,zone_name FROM motion_detections WHERE event_id=?').get(eventId);
must(preserved?.zone_id == null && preserved?.zone_name === 'Door', 'Deleting a zone must preserve historical zone name while clearing live FK.');
db.close();
fs.rmSync(temp,{recursive:true,force:true});

console.log('PASS P0.14.1 motion snapshots, zones, and event review foundation');
