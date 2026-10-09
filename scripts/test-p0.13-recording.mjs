import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const cameraRepo = read('src/server/repositories/CameraRepository.ts');
const recordingService = read('src/server/services/RecordingService.ts');
const server = read('server.ts');
const permissions = read('src/security/permissions.ts');
const recordingsView = read('src/components/recordings/RecordingsView.tsx');

must(/CURRENT_SCHEMA_VERSION\s*=\s*(?:[7-9]|[1-9][0-9]+)/.test(cameraRepo), 'Current schema must be v7 or newer while retaining the P0.13 v5 migration.');
must(cameraRepo.includes("migrate(5, 'continuous_recording_segments'"), 'Recording migration v5 missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS recording_segments'), 'recording_segments table missing.');
must(recordingService.includes("'-c:v', 'copy'"), 'Recorder must consume the normalized MediaMTX H.264 stream without re-encoding.');
must(recordingService.includes('this.media.rtspBase'), 'Recorder must read from MediaMTX, not reopen the physical camera.');
must(!recordingService.includes('directShowInputArgs'), 'Recorder must not reopen DirectShow USB capture.');
must(recordingService.includes("credentials.internalSecret('mediamtx-recorder')"), 'Internal recorder MediaMTX credential missing.');
must(server.includes("protocol === 'rtsp'") && server.includes("'_cctv_recorder'"), 'Loopback RTSP recorder authorization missing.');
must(permissions.includes("'recording:manage'"), 'recording:manage permission missing.');
must(server.includes("auth.requirePermission('recording:manage')"), 'Recording management routes are not protected.');
must(server.includes("auth.requirePermission('recording:view')"), 'Recording playback routes are not protected.');
must(server.includes('recordingAllowed(req, row.camera_id)'), 'Per-camera recording ACL check missing.');
must(recordingService.includes("path.relative(root, file)"), 'Recording file path containment check missing.');
must(recordingService.includes('startupExcludedPaths'), 'Crash-leftover recording exclusion is missing.');
must(recordingService.includes('hasRecordingFiles(cameraId'), 'Camera recording-file safety check is missing.');
must(server.includes('CAMERA_HAS_RECORDINGS') && server.includes('hasRecordingFiles(camera.id)'), 'Camera deletion must be blocked when unindexed recording files exist.');
must(server.includes('suffixLength') && server.includes('Accept-Ranges'), 'Authenticated playback must support byte ranges, including suffix ranges.');
must(recordingsView.includes('<video') && recordingsView.includes('getRecordings('), 'Recordings UI is not wired to real playback data.');
must(!recordingsView.includes('Simulated recorded blocks'), 'Old simulated recording timeline must not remain.');

// Execute the migration SQL in a real node:sqlite database to catch SQL errors.
const match = cameraRepo.match(/migrate\(5,\s*'continuous_recording_segments',\s*`([\s\S]*?)`\);/);
must(match, 'Unable to extract migration v5 SQL.');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p013-'));
const dbPath = path.join(tempDir, 'test.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE cameras (id TEXT PRIMARY KEY);');
db.exec(match[1]);
db.prepare('INSERT INTO cameras(id) VALUES (?)').run('cam-test');
db.prepare(`INSERT INTO recording_segments(camera_id,camera_name,file_path,started_at,ended_at,duration_seconds,size_bytes,status,codec,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
  'cam-test', 'Test Camera', path.join(tempDir, 'segment.mp4'), '2026-10-03T00:00:00.000Z', '2026-10-03T00:01:00.000Z', 60, 1234, 'complete', 'H.264', '2026-10-03T00:01:00.000Z', '2026-10-03T00:01:00.000Z'
);
const row = db.prepare('SELECT camera_id, duration_seconds, size_bytes FROM recording_segments').get();
must(row?.camera_id === 'cam-test' && Number(row?.duration_seconds) === 60 && Number(row?.size_bytes) === 1234, 'Recording migration persistence check failed.');
db.close();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('PASS P0.13 continuous recording foundation');
