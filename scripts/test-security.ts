import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CameraRepository } from '../src/server/repositories/CameraRepository';
import { AuthRepository } from '../src/server/repositories/AuthRepository';
import { AuditRepository } from '../src/server/repositories/AuditRepository';
import { SessionRepository } from '../src/server/repositories/SessionRepository';
import { AuthService, isLoopbackAddress } from '../src/server/services/AuthService';
import { hasPermission } from '../src/security/permissions';
import type { Camera } from '../src/types/cctv';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-auth-test-'));
const db = path.join(temp, 'cctv.db');
const cameras = new CameraRepository(db);
const camera = (id: string): Camera => ({
  id, name: id, location: 'Test', address: 'localhost', status: 'online', recording: false, recordingMode: 'disabled',
  resolution: '1280 × 720', fps: 30, bitrate: '2.0 Mbps', codec: 'H.264', model: 'Test', uptime: '0', lastSeen: 'Now',
  lastMotion: 'None', protocol: 'Test', ptz: false, substream: 'None', enabled: true, stream: { path: `path-${id}`, protocol: 'webrtc', whepPath: `/path-${id}/whep` },
});
cameras.save(camera('cam-1'));
cameras.save(camera('cam-2'));

let repo = new AuthRepository(db);
let sessions = new SessionRepository(db);
const audit = new AuditRepository(db);
let auth = new AuthService(repo, sessions);

try {
  assert.equal(auth.setupRequired(), true, 'fresh DB should require first-admin setup');
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);

  const admin = auth.createUser({ username: 'admin.test', password: 'admin123', role: 'Admin', cameraAccess: 'all', recordingAccess: 'all' });
  assert.equal(admin.role, 'Admin');
  assert.equal(admin.cameraAccess, 'all');
  assert.equal(admin.recordingAccess, 'all');
  assert.equal('password_hash' in (admin as any), false, 'public user must never contain password hash');
  assert.equal(auth.setupRequired(), false);
  assert.equal(auth.authenticate('ADMIN.TEST', 'admin123')?.id, admin.id, 'username lookup should be case-insensitive');
  assert.equal(auth.authenticate('admin.test', 'wrong-password'), null, 'wrong password must fail');

  const viewer = auth.createUser({ username: 'viewer.test', password: 'view1234', role: 'Viewer' });
  assert.deepEqual(viewer.cameraAccess, [], 'new Viewer must default to no cameras');
  assert.deepEqual(viewer.recordingAccess, [], 'new Viewer must default to no recordings');
  assert.equal(auth.canAccessCamera(viewer, 'cam-1'), false);
  assert.equal(hasPermission('Viewer', 'camera:view'), true);
  assert.equal(hasPermission('Viewer', 'camera:create'), false);
  assert.equal(hasPermission('Viewer', 'system:configure'), false);
  assert.equal(hasPermission('Admin', 'camera_access:manage'), true);

  const assigned = repo.patch(viewer.id, { cameraAccess: ['cam-1'], recordingAccess: ['cam-1'] })!;
  assert.deepEqual(assigned.cameraAccess, ['cam-1']);
  assert.deepEqual(assigned.recordingAccess, ['cam-1']);
  assert.equal(auth.canAccessCamera(assigned, 'cam-1'), true);
  assert.equal(auth.canAccessCamera(assigned, 'cam-2'), false);
  assert.equal(auth.canAccessRecording(assigned, 'cam-1'), true);
  assert.equal(auth.canAccessRecording(assigned, 'cam-2'), false);
  assert.equal(auth.canAccessCamera(admin, 'cam-2'), true);

  const recImpliesLive = repo.patch(viewer.id, { cameraAccess: [], recordingAccess: ['cam-2'] })!;
  assert.deepEqual(recImpliesLive.cameraAccess, ['cam-2'], 'recording assignment must imply live visibility');
  assert.deepEqual(recImpliesLive.recordingAccess, ['cam-2']);

  const testSession = sessions.create({ id: 'ses-test', userId: viewer.id, tokenHash: 'test-token-hash', expiresAt: new Date(Date.now()+60_000).toISOString() });
  const media = auth.issueMediaToken(recImpliesLive, 'webcam-001', 60, testSession.id);
  assert.equal(auth.verifyMediaToken(media.token, 'webcam-001'), true, 'token should authorize its exact path');
  assert.equal(auth.verifyMediaToken(media.token, 'webcam-002'), false, 'token must not authorize another camera path');
  assert.equal(auth.verifyMediaToken(`${media.token}x`, 'webcam-001'), false, 'tampered token must fail');

  const cameraMedia = auth.issueMediaToken(recImpliesLive, 'path-cam-2', 60, testSession.id);
  const currentBeforeRevoke = auth.mediaTokenUser(cameraMedia.token, 'path-cam-2');
  assert.ok(currentBeforeRevoke, 'issued media token should resolve the current active user');
  assert.equal(auth.canAccessCamera(currentBeforeRevoke!, 'cam-2'), true, 'current ACL should authorize the camera before revocation');
  repo.patch(viewer.id, { cameraAccess: [], recordingAccess: [] });
  const currentAfterRevoke = auth.mediaTokenUser(cameraMedia.token, 'path-cam-2');
  assert.ok(currentAfterRevoke, 'token signature can remain valid while current ACL is re-read');
  assert.equal(auth.canAccessCamera(currentAfterRevoke!, 'cam-2'), false, 'revoked camera ACL must fail live revalidation');
  repo.patch(viewer.id, { status: 'Inactive' });
  assert.equal(auth.mediaTokenUser(cameraMedia.token, 'path-cam-2'), null, 'inactive user must invalidate an outstanding media token');
  repo.patch(viewer.id, { status: 'Active', cameraAccess: ['cam-2'], recordingAccess: ['cam-2'] });

  audit.log({ userId: admin.id, username: admin.username, action: 'test.access_changed', resourceType: 'camera_access', resourceId: viewer.id, details: { camera: 'cam-2' } });
  const auditRows = audit.list(10);
  assert.equal(auditRows[0]?.action, 'test.access_changed');
  assert.equal(auditRows[0]?.details?.camera, 'cam-2');

  // Simulate a P0.9 Operator record with legacy JSON and verify one-time migration.
  repo.close();
  sessions.close();
  const raw = new DatabaseSync(db);
  raw.prepare("UPDATE users SET role='Operator', camera_access_json=? WHERE id=?").run('["cam-1"]', viewer.id);
  raw.prepare('DELETE FROM user_camera_access WHERE user_id=?').run(viewer.id);
  raw.close();
  repo = new AuthRepository(db);
  sessions = new SessionRepository(db);
  auth = new AuthService(repo, sessions);
  const migrated = repo.get(viewer.id)!;
  assert.equal(migrated.role, 'Viewer', 'legacy Operator must migrate to Viewer');
  assert.deepEqual(migrated.cameraAccess, ['cam-1'], 'legacy camera access should be retained as explicit Viewer live access');
  assert.deepEqual(migrated.recordingAccess, [], 'legacy access must not silently grant recording access');

  console.log('P0.12 role/access/security regression checks passed.');
} finally {
  try { repo.close(); } catch {}
  try { sessions.close(); } catch {}
  try { audit.close(); } catch {}
  try { cameras.close(); } catch {}
  fs.rmSync(temp, { recursive: true, force: true });
}
