import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStoreZip } from '../src/server/services/ZipService';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const media = read('tools/mediamtx/mediamtx.yml');
assert.match(media, /hlsVariant:\s*lowLatency/, 'Known-good LL-HLS variant must remain frozen in P0.10.');
assert.match(media, /hlsPartDuration:\s*500ms/, 'Known-good 500 ms HLS part target must remain frozen in P0.10.');
assert.match(media, /hlsAddress:\s*127\.0\.0\.1:8888/, 'HLS must stay loopback-only behind the authenticated app proxy.');
assert.match(media, /apiAddress:\s*127\.0\.0\.1:9997/, 'MediaMTX Control API must stay loopback-only.');
assert.match(media, /rtspAddress:\s*127\.0\.0\.1:8554/, 'USB RTSP publish surface must stay loopback-only.');

const manager = read('src/server/services/CameraProcessManager.ts');
assert.match(manager, /\[2000, 5000, 15000, 30000, 60000\]/, 'Recovery backoff must be bounded and progressive.');
assert.match(manager, /restartTimers\.has\(cameraId\)/, 'Duplicate recovery timers must be prevented.');
assert.match(manager, /reconcileEnabled/, 'Reliability supervisor must be able to reconcile enabled cameras.');

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '0.2.0-p0.16.1-pw8');
assert.ok(pkg.scripts['build:frontend']);
assert.ok(pkg.scripts['build:server']);
assert.ok(pkg.scripts['start:prod']);

const zip = createStoreZip([{ name: 'support.json', data: '{"ok":true}' }, { name: 'logs/server.log', data: 'test' }]);
assert.equal(zip.readUInt32LE(0), 0x04034b50, 'Support bundle must begin with a ZIP local-file signature.');
assert.ok(zip.includes(Buffer.from('support.json')));

const authRepo = read('src/server/repositories/AuthRepository.ts');
assert.match(authRepo, /export type UserRole = 'Admin' \| 'Viewer'/, 'P0.10 must expose only Admin and Viewer roles.');
assert.match(authRepo, /CREATE TABLE IF NOT EXISTS user_camera_access/, 'Per-camera live/recording ACL table must exist.');
const permissions = read('src/security/permissions.ts');
assert.match(permissions, /camera_access:manage/, 'Central permission policy must include camera access management.');
const server = read('server.ts');
assert.match(server, /cameraForClient/, 'Viewer camera responses must be sanitized.');
assert.match(server, /api\/v1\/audit/, 'Admin audit API must exist.');
assert.match(server, /cameras\/rtsp\/test/, 'RTSP connection test API must exist.');
assert.match(server, /auth\.mediaTokenUser\(token, streamPath, 'read'\)/, 'Media authorization must validate the current token user.');
assert.match(server, /auth\.canAccessCamera\(tokenUser, camera\.id\)/, 'Media authorization must revalidate the current camera ACL.');
const statusService = read('src/server/services/SystemStatusService.ts');
assert.match(statusService, /Short-lived token \+ live ACL revalidation/, 'System status must advertise live ACL revalidation.');
const cameraRepo = read('src/server/repositories/CameraRepository.ts');
assert.match(cameraRepo, /CREATE TABLE IF NOT EXISTS schema_migrations/, 'Versioned schema migrations must exist.');
assert.match(cameraRepo, /CREATE TABLE IF NOT EXISTS camera_rtsp_config/, 'RTSP credentials/config must be separate from camera payloads.');
console.log('P0.14 reliability and access-control invariants passed.');
