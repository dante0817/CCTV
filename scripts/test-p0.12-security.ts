import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CameraRepository } from '../src/server/repositories/CameraRepository';
import { AuthRepository } from '../src/server/repositories/AuthRepository';
import { SessionRepository } from '../src/server/repositories/SessionRepository';
import { AuditRepository } from '../src/server/repositories/AuditRepository';
import { AuthService } from '../src/server/services/AuthService';
import type { Camera } from '../src/types/cctv';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-p012-test-'));
const dbPath = path.join(temp, 'cctv.db');
const cameras = new CameraRepository(dbPath);
const camera: Camera = {
  id: 'cam-security', name: 'Security Test', location: 'Lab', address: 'localhost', status: 'online', recording: false,
  recordingMode: 'disabled', resolution: '1280 × 720', fps: 30, bitrate: '2 Mbps', codec: 'H.264', model: 'Test', uptime: '0',
  lastSeen: 'Now', lastMotion: 'None', protocol: 'Test', ptz: false, substream: 'None', enabled: true,
  stream: { path: 'path-security', protocol: 'webrtc', whepPath: '/path-security/whep' },
};
cameras.save(camera);

let authRepo = new AuthRepository(dbPath);
let sessions = new SessionRepository(dbPath);
const audit = new AuditRepository(dbPath);
let auth = new AuthService(authRepo, sessions);

function fakeReq(cookie = ''): any {
  return {
    headers: { cookie, 'user-agent': 'P0.12 Security Test/1.0' },
    socket: { remoteAddress: '127.0.0.1' },
    protocol: 'http',
  };
}

function fakeRes(): any {
  const headers = new Map<string, string>();
  return { headers, setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); } };
}

try {
  assert.ok(cameras.schemaVersion() >= 4, 'P0.12 security migration v4 must remain present in later schemas');
  assert.equal(auth.validatePassword('abcd'), 'Password must contain at least 5 characters.');
  assert.equal(auth.validatePassword('123456789'), 'Password must contain at most 8 characters.');
  assert.equal(auth.validatePassword('abcde'), null);
  assert.equal(auth.validatePassword('12345678'), null);

  const admin = auth.createUser({ username: 'security.admin', password: 'admin123', role: 'Admin', aiEnabled: true });
  const viewer = auth.createUser({ username: 'security.viewer', password: 'view1234', role: 'Viewer' });
  assert.equal(viewer.aiEnabled, false, 'new Viewer AI access must default off');
  assert.equal(auth.hasPermission(viewer, 'ai:use'), false, 'Viewer role alone must not grant AI');
  const aiViewer = authRepo.patch(viewer.id, { aiEnabled: true })!;
  assert.equal(auth.hasPermission(aiViewer, 'ai:use'), true, 'explicit AI grant should enable AI for Viewer');

  const res = fakeRes();
  const req = fakeReq();
  const created = auth.createSession(admin, res, req);
  const cookieHeader = String(res.headers.get('set-cookie') || '');
  const cookie = cookieHeader.split(';')[0];
  assert.ok(cookie.startsWith('cctv_session='), 'session cookie should be issued');
  const token = decodeURIComponent(cookie.split('=')[1] || '');
  assert.ok(token.length > 20, 'browser should receive a random opaque session token');

  const raw = new DatabaseSync(dbPath);
  const persisted = raw.prepare('SELECT token_hash, revoked_at FROM auth_sessions WHERE id = ?').get(created.id) as any;
  raw.close();
  assert.ok(persisted?.token_hash, 'session hash should persist');
  assert.notEqual(persisted.token_hash, token, 'raw browser token must never be stored in SQLite');
  assert.equal(persisted.token_hash, crypto.createHash('sha256').update(token).digest('hex'));

  const requestWithCookie = fakeReq(cookie);
  assert.equal(auth.userFromRequest(requestWithCookie)?.id, admin.id, 'fresh session must authenticate');

  // Close/reopen to prove sessions survive server restart.
  sessions.close();
  authRepo.close();
  authRepo = new AuthRepository(dbPath);
  sessions = new SessionRepository(dbPath);
  auth = new AuthService(authRepo, sessions);
  assert.equal(auth.userFromRequest(requestWithCookie)?.id, admin.id, 'persistent session must survive service restart');

  const current = auth.currentSession(requestWithCookie)!;
  const media = auth.issueMediaToken(authRepo.toPublic(authRepo.get(admin.id)!), 'path-security', 60, current.id);
  assert.ok(auth.mediaTokenUser(media.token, 'path-security'), 'session-bound media token should validate while session is active');
  auth.revokeSession(current.id, authRepo.toPublic(authRepo.get(admin.id)!));
  assert.equal(auth.userFromRequest(requestWithCookie), null, 'revoked session must stop API authentication');
  assert.equal(auth.mediaTokenUser(media.token, 'path-security'), null, 'revoking a session must invalidate its media token for new reads');

  const res2 = fakeRes();
  const session2 = auth.createSession(authRepo.toPublic(authRepo.get(admin.id)!), res2, req);
  const userBefore = authRepo.get(admin.id)!;
  const media2 = auth.issueMediaToken(authRepo.toPublic(userBefore), 'path-security', 60, session2.id);
  authRepo.bumpSecurityVersion(admin.id);
  assert.equal(auth.mediaTokenUser(media2.token, 'path-security'), null, 'security-version advance must invalidate older media tokens');

  audit.log({
    userId: admin.id,
    username: admin.username,
    action: 'security.redaction_test',
    resourceType: 'session',
    resourceId: session2.id,
    details: { password: 'never-store-this', token: 'secret-token', nested: { authorization: 'Bearer abc123', safe: 'kept' } },
  });
  const row = audit.list({ limit: 5, actionPrefix: 'security.' })[0];
  assert.equal(row.details?.password, '[redacted]');
  assert.equal(row.details?.token, '[redacted]');
  assert.equal((row.details?.nested as any)?.authorization, '[redacted]');
  assert.equal((row.details?.nested as any)?.safe, 'kept');

  const allSessions = auth.listAllSessions();
  assert.ok(allSessions.every((session) => !('token_hash' in (session as any))), 'public session payload must not expose token hash');

  console.log('P0.12 persistent-session, AI-grant, media-revocation, and audit-redaction checks passed.');
} finally {
  try { sessions.close(); } catch {}
  try { authRepo.close(); } catch {}
  try { audit.close(); } catch {}
  try { cameras.close(); } catch {}
  fs.rmSync(temp, { recursive: true, force: true });
}
