import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CameraRepository } from '../src/server/repositories/CameraRepository';
import { OperationalEventRepository } from '../src/server/repositories/OperationalEventRepository';
import { OperationalEventService } from '../src/server/services/OperationalEventService';
import type { Camera } from '../src/types/cctv';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p0112-events-'));
const dbPath = path.join(tempDir, 'cctv.db');
const cameraRepo = new CameraRepository(dbPath);
assert.ok(cameraRepo.schemaVersion() >= 3, 'P0.11.2 operational-events migration v3 must remain present in later schemas.');

const eventRepo = new OperationalEventRepository(dbPath);
const events = new OperationalEventService(eventRepo, cameraRepo);
const camera: Camera = {
  id: 'cam-test-1', name: 'Test Camera', location: 'Lab', address: 'localhost', status: 'starting', recording: false,
  recordingMode: 'disabled', resolution: '1280 × 720', fps: 30, bitrate: '2.5 Mbps', codec: 'H.264', model: 'Test', uptime: '0s',
  lastSeen: 'Never', lastMotion: 'None', protocol: 'test', ptz: false, substream: 'None', enabled: true, source_type: 'usb', last_error: null,
};
cameraRepo.save(camera);

events.systemStarted('0.11.2');
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'starting', previousReason: 'FFMPEG_STARTED', nextState: 'online', reason: 'STREAM_READY', occurredAt: new Date().toISOString(), hadBeenOnline: false, lastOfflineReason: null });
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'online', previousReason: 'STREAM_READY', nextState: 'offline', reason: 'FFMPEG_EXITED', occurredAt: new Date().toISOString(), hadBeenOnline: true, lastOfflineReason: 'FFMPEG_EXITED' });
// Repeated observation in the same state must not create another event.
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'offline', previousReason: 'FFMPEG_EXITED', nextState: 'offline', reason: 'FFMPEG_EXITED', occurredAt: new Date().toISOString(), hadBeenOnline: true, lastOfflineReason: 'FFMPEG_EXITED' });
// A failed automatic restart can pass through STARTING -> OFFLINE repeatedly; it is still the same outage incident.
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'starting', previousReason: 'FFMPEG_STARTED', nextState: 'offline', reason: 'FFMPEG_EXITED', occurredAt: new Date().toISOString(), hadBeenOnline: true, lastOfflineReason: 'FFMPEG_EXITED' });
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'starting', previousReason: 'MEDIA_PATH_CONNECTING', nextState: 'online', reason: 'STREAM_READY', occurredAt: new Date().toISOString(), hadBeenOnline: true, lastOfflineReason: 'FFMPEG_EXITED' });

let rows = events.list({ limit: 20 });
assert.deepEqual(rows.map((row) => row.eventType).sort(), ['CAMERA_OFFLINE', 'CAMERA_ONLINE', 'CAMERA_RECOVERED', 'SYSTEM_STARTED'].sort());
assert.equal(rows.filter((row) => row.eventType === 'CAMERA_OFFLINE').length, 1, 'Repeated OFFLINE observations must not flood the event table.');

const beforeIntentionalRestart = rows.length;
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'online', previousReason: 'STREAM_READY', nextState: 'offline', reason: 'WORKER_STOPPED', occurredAt: new Date().toISOString(), hadBeenOnline: true, lastOfflineReason: 'WORKER_STOPPED' });
events.cameraTransition({ cameraId: camera.id, cameraName: camera.name, previousState: 'starting', previousReason: 'FFMPEG_STARTED', nextState: 'online', reason: 'STREAM_READY', occurredAt: new Date().toISOString(), hadBeenOnline: true, lastOfflineReason: 'WORKER_STOPPED' });
rows = events.list({ limit: 20 });
assert.equal(rows.length, beforeIntentionalRestart, 'Intentional manual restart must not masquerade as an outage/recovery incident.');

events.observeMediaHealth(true);
events.observeMediaHealth(false, 'test outage');
events.observeMediaHealth(false, 'still down');
events.observeMediaHealth(true);
rows = events.list({ limit: 20 });
assert.equal(rows.filter((row) => row.eventType === 'MEDIAMTX_OFFLINE').length, 1, 'MediaMTX outage must be transition-driven.');
assert.equal(rows.filter((row) => row.eventType === 'MEDIAMTX_RECOVERED').length, 1, 'MediaMTX recovery must be transition-driven.');

const offline = rows.find((row) => row.eventType === 'CAMERA_OFFLINE');
assert.ok(offline, 'Offline event must exist.');
const acknowledged = events.acknowledge(Number(offline!.id));
assert.ok(acknowledged?.acknowledgedAt, 'Acknowledgement timestamp must persist.');

events.close();
const reopenedRepo = new OperationalEventRepository(dbPath);
const reopenedEvents = new OperationalEventService(reopenedRepo, cameraRepo);
const persisted = reopenedEvents.list({ limit: 50 });
assert.ok(persisted.some((row) => row.eventType === 'SYSTEM_STARTED'), 'Operational events must survive repository/application restart.');
assert.ok(persisted.find((row) => row.id === offline!.id)?.acknowledgedAt, 'Event acknowledgement must survive repository/application restart.');

const source = fs.readFileSync(path.join(process.cwd(), 'src/server/services/CameraProcessManager.ts'), 'utf8');
assert.match(source, /stateChanged && this\.onTransition/, 'Camera events must originate from real runtime state transitions only.');
const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
assert.match(server, /\/api\/v1\/events/, 'Operational Events API must exist.');
assert.match(server, /event\.acknowledged/, 'Event acknowledgement must remain auditable without mixing datasets.');

try { reopenedEvents.close(); } catch {}
try { cameraRepo.close(); } catch {}
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('P0.11.2 operational events checks passed.');
