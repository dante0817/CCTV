import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const cameraRepo = read('src/server/repositories/CameraRepository.ts');
const recordingRepo = read('src/server/repositories/RecordingRepository.ts');
const recordingService = read('src/server/services/RecordingService.ts');
const server = read('server.ts');
const api = read('src/api.ts');
const view = read('src/components/recordings/RecordingsView.tsx');
const storage = read('src/server/services/StorageService.ts');

must(/CURRENT_SCHEMA_VERSION\s*=\s*(?:[7-9]|[1-9][0-9]+)/.test(cameraRepo), 'Schema version must be v7 or newer while retaining migration v6.');
must(cameraRepo.includes("migrate(6, 'recording_management_retention'"), 'Recording management migration v6 missing.');
must(cameraRepo.includes('is_protected INTEGER NOT NULL DEFAULT 0'), 'Recording protection column missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS recording_retention_policy'), 'Retention policy table missing.');
must(cameraRepo.includes('CREATE TABLE IF NOT EXISTS recording_quarantine'), 'Recording quarantine table missing.');
must(recordingRepo.includes('listRetentionCandidates'), 'Safe retention candidate query missing.');
must(recordingRepo.includes("status='complete' AND is_protected=0"), 'Retention candidates must be complete and unprotected.');
must(recordingService.includes('safeRecordingFile'), 'Safe path containment helper missing.');
must(recordingService.includes("row.is_protected"), 'Protected deletion guard missing.');
must(recordingService.includes('runRetention'), 'Retention engine missing.');
must(recordingService.includes('looksLikeMp4'), 'MP4 health/signature check missing.');
must(recordingService.includes('startupExcludedPaths'), 'Crash-leftover quarantine protection missing.');
must(server.includes("auth.requirePermission('recording:delete')"), 'Recording deletion must require recording:delete.');
must(server.includes("/api/v1/recordings/:id/protection"), 'Protection API missing.');
must(server.includes("/api/v1/recordings/delete-bulk"), 'Bulk-delete API missing.');
must(server.includes("/api/v1/recordings/retention/run"), 'Retention-run API missing.');
must(server.includes("/api/v1/recordings/reconcile"), 'Reconciliation API missing.');
must(api.includes('setRecordingProtected') && api.includes('deleteRecordingsBulk') && api.includes('updateRecordingPolicy'), 'Frontend recording-management API bindings missing.');
must(view.includes('Safe Retention Policy') && view.includes('Protected only') && view.includes('Delete selected unlocked'), 'Recording-management UI missing.');
must(storage.includes('retentionImplemented: true'), 'Storage service must report retention as implemented.');

const migration5 = cameraRepo.match(/migrate\(5,\s*'continuous_recording_segments',\s*`([\s\S]*?)`\);/);
const migration6 = cameraRepo.match(/migrate\(6,\s*'recording_management_retention',\s*`([\s\S]*?)`\);/);
must(migration5 && migration6, 'Unable to extract recording migrations v5/v6.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p0131-'));
const db = new DatabaseSync(path.join(temp, 'test.db'));
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE cameras (id TEXT PRIMARY KEY);');
db.exec(migration5[1]);
db.exec(migration6[1]);
db.prepare('INSERT INTO cameras(id) VALUES (?)').run('cam-test');
db.prepare(`INSERT INTO recording_segments(camera_id,camera_name,file_path,started_at,ended_at,duration_seconds,size_bytes,status,codec,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
  'cam-test', 'Test Camera', path.join(temp, 'segment.mp4'), '2026-10-03T00:00:00.000Z', '2026-10-03T00:01:00.000Z', 60, 2048, 'complete', 'H.264', '2026-10-03T00:01:00.000Z', '2026-10-03T00:01:00.000Z'
);
const inserted = db.prepare('SELECT is_protected FROM recording_segments').get();
must(Number(inserted?.is_protected) === 0, 'Migrated recordings must default to unprotected.');
db.prepare('UPDATE recording_segments SET is_protected=1').run();
const candidateCount = db.prepare("SELECT COUNT(*) AS count FROM recording_segments WHERE status='complete' AND is_protected=0").get();
must(Number(candidateCount?.count) === 0, 'Protected recordings must be excluded from retention candidates.');
const policy = db.prepare('SELECT enabled,max_age_days,max_storage_bytes,min_free_bytes FROM recording_retention_policy WHERE id=1').get();
must(Number(policy?.enabled) === 0 && Number(policy?.max_age_days) === 14, 'Retention must be opt-in with safe defaults.');
db.close();
fs.rmSync(temp, { recursive: true, force: true });

console.log('PASS P0.13.1 recording management and safe-retention foundation');
