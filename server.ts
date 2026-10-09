import express from 'express';
import http from 'http';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import dotenv from 'dotenv';
import { enumerateDevices, enumerateFormats, findFfmpegPath } from './src/server/dshowEnumerator';
import { getEncoderCapabilities, probeUsbCapture } from './src/server/services/FfmpegService';
import { CameraRepository } from './src/server/repositories/CameraRepository';
import { AuthRepository, type CameraAccess, type PublicUser, type UserRole } from './src/server/repositories/AuthRepository';
import { AuditRepository } from './src/server/repositories/AuditRepository';
import { SessionRepository } from './src/server/repositories/SessionRepository';
import { OperationalEventRepository, type OperationalEventCategory, type OperationalEventSeverity } from './src/server/repositories/OperationalEventRepository';
import { RecordingRepository, type RecordingSegmentRow } from './src/server/repositories/RecordingRepository';
import { MotionRepository, type MotionReviewStatus } from './src/server/repositories/MotionRepository';
import { NotificationRepository } from './src/server/repositories/NotificationRepository';
import { NotificationDeliveryRepository } from './src/server/repositories/NotificationDeliveryRepository';
import { AiRepository } from './src/server/repositories/AiRepository';
import { MediaMtxService } from './src/server/services/MediaMtxService';
import { CameraProcessManager } from './src/server/services/CameraProcessManager';
import { CredentialService } from './src/server/services/CredentialService';
import { normalizeRtspPath, probeRtspSource } from './src/server/services/RtspService';
import { AuthService, clientAddress, isLoopbackAddress, type AuthenticatedRequest } from './src/server/services/AuthService';
import { getRemoteAccessStatus } from './src/server/services/RemoteAccessService';
import { configureLogging, patchConsoleLogging, redactedEnvSnapshot, tailLog, logLine } from './src/server/services/LoggingService';
import { createStoreZip } from './src/server/services/ZipService';
import { StorageService } from './src/server/services/StorageService';
import { SystemStatusService } from './src/server/services/SystemStatusService';
import { OperationalEventService } from './src/server/services/OperationalEventService';
import { RecordingService } from './src/server/services/RecordingService';
import { MotionService } from './src/server/services/MotionService';
import { NotificationService } from './src/server/services/NotificationService';
import { NotificationDeliveryService } from './src/server/services/NotificationDeliveryService';
import { AiDetectionService } from './src/server/services/AiDetectionService';
import type { Camera, RtspTransport, RtspVideoMode, RtspVendorProfile } from './src/types/cctv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = process.env.CCTV_ROOT_DIR
  ? path.resolve(process.env.CCTV_ROOT_DIR)
  : (process.env.NODE_ENV === 'production' && path.basename(__dirname) === 'dist-server' ? path.dirname(__dirname) : __dirname);
configureLogging(appRoot);
patchConsoleLogging();
const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const demoMode = process.env.CCTV_DEMO_MODE === 'true';
const dbPath = process.env.CCTV_DB_PATH || path.join(appRoot, 'data', 'cctv.db');
const startedAt = Date.now();
const APP_VERSION = '0.16.1';

const repo = new CameraRepository(dbPath);
const authRepo = new AuthRepository(dbPath);
const sessionRepo = new SessionRepository(dbPath);
const auditRepo = new AuditRepository(dbPath);
const operationalEventRepo = new OperationalEventRepository(dbPath);
const recordingRepo = new RecordingRepository(dbPath);
const motionRepo = new MotionRepository(dbPath);
const notificationRepo = new NotificationRepository(dbPath);
const notificationDeliveryRepo = new NotificationDeliveryRepository(dbPath);
const aiRepo = new AiRepository(dbPath);
const credentials = new CredentialService(appRoot);
const notificationDeliveryService = new NotificationDeliveryService(notificationDeliveryRepo, notificationRepo, credentials);
const snapshotRoot = process.env.CCTV_SNAPSHOTS_DIR ? path.resolve(process.env.CCTV_SNAPSHOTS_DIR) : path.join(path.dirname(dbPath), 'snapshots');
const operationalEvents = new OperationalEventService(operationalEventRepo, repo);
const notificationService = new NotificationService(notificationRepo, notificationDeliveryRepo);
operationalEvents.onRecorded((event) => notificationService.handleOperationalEvent(event));
const auth = new AuthService(authRepo, sessionRepo);
const mediaMtx = new MediaMtxService(appRoot);
const cameraProcesses = new CameraProcessManager(repo, mediaMtx, credentials, (transition) => operationalEvents.cameraTransition(transition));
const storageService = new StorageService(dbPath, appRoot);
const recordingService = new RecordingService(repo, recordingRepo, cameraProcesses, mediaMtx, storageService, credentials, (kind, cameraId, message) => {
  if (kind === 'started') operationalEvents.recordingStarted(cameraId);
  else if (kind === 'stopped') operationalEvents.recordingStopped(cameraId);
  else operationalEvents.recordingError(cameraId, message);
});
const motionService = new MotionService(repo, motionRepo, recordingRepo, cameraProcesses, mediaMtx, credentials, operationalEvents, snapshotRoot);
const aiModelPath = process.env.CCTV_AI_MODEL_PATH ? path.resolve(process.env.CCTV_AI_MODEL_PATH) : path.join(appRoot, 'tools', 'ai', 'tiny-yolov3-11.onnx');
const aiService = new AiDetectionService(repo, aiRepo, motionRepo, recordingRepo, cameraProcesses, mediaMtx, credentials, operationalEvents, aiModelPath, snapshotRoot);
const systemStatusService = new SystemStatusService(repo, cameraProcesses, mediaMtx, storageService, recordingService, { version: APP_VERSION, port: PORT, rootDir: appRoot, dbPath, startedAt, demoMode });

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

function sendError(res: express.Response, error: any, status = 500) {
  const code = error?.code || 'INTERNAL_ERROR';
  const message = error?.message || String(error);
  res.status(status).json({ ok: false, code, message, details: error?.details, stage: error?.stage });
}

function hostForUrl(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

function cameraAllowed(req: AuthenticatedRequest, cameraId: string): boolean {
  return Boolean(req.cctvUser && auth.canAccessCamera(req.cctvUser, cameraId));
}

function normalizeCameraAccess(input: unknown): CameraAccess {
  const validCameraIds = repo.list().map((camera) => camera.id);
  const valid = new Set(validCameraIds);
  if (input === 'all') return [...validCameraIds];
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String).map((id) => id.trim()).filter((id) => id && valid.has(id)))];
}

function recordingAllowed(req: AuthenticatedRequest, cameraId: string): boolean {
  return Boolean(req.cctvUser && auth.canAccessRecording(req.cctvUser, cameraId));
}

function cameraForClient(user: PublicUser, camera: Camera): Camera {
  if (user.role === 'Admin') return { ...camera, stream_available: Boolean(camera.stream?.path) };
  return {
    ...camera,
    address: 'Protected',
    protocol: 'Protected stream',
    substream: 'Protected',
    usb_source: undefined,
    rtsp_source: undefined,
    stream: undefined,
    stream_available: Boolean(camera.stream?.path),
    last_error: null,
  };
}

function audit(req: AuthenticatedRequest | express.Request, action: string, resourceType: string, resourceId?: string | null, details?: Record<string, unknown> | null) {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.cctvUser || auth.userFromRequest(req);
  const context = {
    ...(details || {}),
    remoteAddress: clientAddress(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    sessionId: authReq.cctvSessionId || auth.currentSession(req)?.id || null,
  };
  auditRepo.log({ userId: user?.id || null, username: user?.username || null, action, resourceType, resourceId: resourceId || null, details: context });
}

// ---- Public liveness and first-admin authentication bootstrap ----
const livenessPayload = () => ({ status: 'ok', service: 'cctv-monitor', version: APP_VERSION });
app.get('/api/health', (_req, res) => res.json(livenessPayload()));
app.get('/api/v1/health', (_req, res) => res.json({ ...livenessPayload(), ok: true, mode: process.env.NODE_ENV === 'production' ? 'production' : 'development', port: PORT }));

app.get('/api/v1/auth/status', (req, res) => {
  res.json({
    setupRequired: auth.setupRequired(),
    setupAllowed: isLoopbackAddress(req.socket.remoteAddress),
  });
});

app.post('/api/v1/auth/setup', (req, res) => {
  if (!auth.setupRequired()) return sendError(res, Object.assign(new Error('Initial administrator already exists.'), { code: 'SETUP_COMPLETE' }), 409);
  if (!isLoopbackAddress(req.socket.remoteAddress)) return sendError(res, Object.assign(new Error('First-admin setup must be completed from the CCTV server itself using localhost.'), { code: 'LOCAL_SETUP_REQUIRED' }), 403);
  try {
    const user = auth.createUser({ username: String(req.body?.username || 'admin'), password: String(req.body?.password || ''), role: 'Admin', cameraAccess: 'all', recordingAccess: 'all', aiEnabled: true });
    const session = auth.createSession(user, res, req);
    auditRepo.log({ userId: user.id, username: user.username, action: 'auth.setup_admin', resourceType: 'user', resourceId: user.id, details: { remoteAddress: clientAddress(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null, sessionId: session.id } });
    res.status(201).json({ user });
  } catch (error: any) {
    sendError(res, error, error?.code === 'USERNAME_EXISTS' ? 409 : 400);
  }
});

const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX_FAILURES = 8;
const loginFailuresByIp = new Map<string, { count: number; resetAt: number }>();
const loginFailuresByPrincipal = new Map<string, { count: number; resetAt: number }>();
function failureBucket(map: Map<string, { count: number; resetAt: number }>, key: string, now: number) {
  const current = map.get(key);
  if (current && current.resetAt > now) return current;
  const next = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  map.set(key, next);
  return next;
}

app.post('/api/v1/auth/login', (req, res) => {
  if (auth.setupRequired()) return sendError(res, Object.assign(new Error('Complete first-admin setup on the CCTV server first.'), { code: 'SETUP_REQUIRED' }), 409);
  const ip = clientAddress(req);
  const attemptedUsername = String(req.body?.username || '').trim();
  const principalKey = `${ip}|${attemptedUsername.toLowerCase() || '<blank>'}`;
  const now = Date.now();
  const ipAttempt = failureBucket(loginFailuresByIp, ip, now);
  const principalAttempt = failureBucket(loginFailuresByPrincipal, principalKey, now);
  if (ipAttempt.count >= LOGIN_MAX_FAILURES || principalAttempt.count >= LOGIN_MAX_FAILURES) {
    auditRepo.log({ username: attemptedUsername || null, action: 'auth.login_rate_limited', resourceType: 'session', details: { remoteAddress: ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null } });
    return sendError(res, Object.assign(new Error('Too many failed sign-in attempts. Try again in a few minutes.'), { code: 'LOGIN_RATE_LIMIT' }), 429);
  }
  const user = auth.authenticate(attemptedUsername, String(req.body?.password || ''));
  if (!user) {
    ipAttempt.count += 1;
    principalAttempt.count += 1;
    auditRepo.log({ username: attemptedUsername || null, action: 'auth.login_failed', resourceType: 'session', details: { remoteAddress: ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null } });
    return sendError(res, Object.assign(new Error('Invalid username or password.'), { code: 'INVALID_LOGIN' }), 401);
  }
  loginFailuresByIp.delete(ip);
  loginFailuresByPrincipal.delete(principalKey);
  const session = auth.createSession(user, res, req);
  auditRepo.log({ userId: user.id, username: user.username, action: 'auth.login', resourceType: 'session', resourceId: session.id, details: { remoteAddress: ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null, expiresAt: session.expiresAt } });
  res.json({ user });
});

app.post('/api/v1/auth/logout', (req, res) => {
  const user = auth.userFromRequest(req);
  const current = auth.currentSession(req);
  if (user) auditRepo.log({ userId: user.id, username: user.username, action: 'auth.logout', resourceType: 'session', resourceId: current?.id || null, details: { remoteAddress: clientAddress(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null } });
  auth.clearSession(req, res);
  res.status(204).end();
});

// ---- MediaMTX external HTTP authentication ----
// MediaMTX calls this endpoint for publish/read actions. Local publishers are allowed;
// browser reads require a short-lived path-scoped token issued by the authenticated app.
app.post('/internal/mediamtx/auth', (req, res) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return res.status(403).end();
  const body = req.body || {};
  const action = String(body.action || '');
  const protocol = String(body.protocol || '');
  const clientIp = String(body.ip || '').replace(/^::ffff:/, '');
  const streamPath = String(body.path || '');
  const token = String(body.token || '');

  if (action === 'publish' && isLoopbackAddress(clientIp)) return res.status(204).end();
  if (['api', 'metrics', 'pprof'].includes(action) && isLoopbackAddress(clientIp)) return res.status(204).end();
  if (action === 'read' && protocol === 'rtsp' && isLoopbackAddress(clientIp) && String(body.user || '') === '_cctv_recorder' && String(body.password || '') === credentials.internalSecret('mediamtx-recorder')) return res.status(204).end();
  if (action === 'read' && ['webrtc', 'hls'].includes(protocol)) {
    const tokenUser = auth.mediaTokenUser(token, streamPath, 'read');
    const camera = repo.list().find((item) => item.stream?.path === streamPath);
    if (tokenUser && camera && auth.canAccessCamera(tokenUser, camera.id)) return res.status(204).end();
  }
  return res.status(403).end();
});

// Legacy non-versioned device/camera endpoints must not bypass app authorization.
app.use(['/usb', '/cameras'], auth.requireAuth, auth.requirePermission('camera:create'));
// Everything below /api/v1 now requires a signed-in CCTV user, except the public routes above.
app.use('/api/v1', auth.requireAuth);

// ---- Current user / user administration ----
app.get('/api/v1/auth/me', (req: AuthenticatedRequest, res) => res.json({ user: req.cctvUser }));

app.get('/api/v1/auth/sessions', (req: AuthenticatedRequest, res) => {
  res.json(auth.listSessionsForUser(req.cctvUser!.id, req.cctvSessionId || null));
});

app.post('/api/v1/auth/sessions/revoke-others', (req: AuthenticatedRequest, res) => {
  const count = auth.revokeUserSessions(req.cctvUser!.id, req.cctvSessionId || null);
  audit(req, 'session.revoke_others', 'session', req.cctvSessionId || null, { revokedCount: count });
  res.json({ revoked: count });
});

app.delete('/api/v1/auth/sessions/:id', (req: AuthenticatedRequest, res) => {
  const target = auth.listSessionsForUser(req.cctvUser!.id, req.cctvSessionId || null).find((session) => session.id === req.params.id);
  if (!target) return sendError(res, Object.assign(new Error('Session not found.'), { code: 'NOT_FOUND' }), 404);
  const current = target.id === req.cctvSessionId;
  auth.revokeSession(target.id, req.cctvUser!);
  audit(req, current ? 'session.current_revoked' : 'session.revoked', 'session', target.id);
  if (current) auth.clearSession(req, res);
  res.json({ revoked: true, current });
});

app.patch('/api/v1/auth/me/password', (req: AuthenticatedRequest, res) => {
  const current = authRepo.get(req.cctvUser!.id);
  if (!current || !auth.verifyPassword(String(req.body?.currentPassword || ''), current.password_hash)) {
    audit(req, 'account.password_change_failed', 'user', req.cctvUser?.id || null);
    return sendError(res, Object.assign(new Error('Current password is incorrect.'), { code: 'CURRENT_PASSWORD_INVALID' }), 403);
  }
  const nextPassword = String(req.body?.newPassword || '');
  const passwordError = auth.validatePassword(nextPassword);
  if (passwordError) return sendError(res, Object.assign(new Error(passwordError), { code: 'INVALID_PASSWORD' }), 400);
  authRepo.patch(current.id, { password_hash: auth.hashPassword(nextPassword), password_changed_at: new Date().toISOString() });
  authRepo.bumpSecurityVersion(current.id);
  auth.revokeUserSessions(current.id);
  const updatedStored = authRepo.get(current.id)!;
  const updated = authRepo.toPublic(updatedStored);
  const session = auth.createSession(updated, res, req);
  auditRepo.log({ userId: updated.id, username: updated.username, action: 'account.password_changed', resourceType: 'user', resourceId: updated.id, details: { remoteAddress: clientAddress(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null, sessionId: session.id } });
  res.json({ user: updated });
});

app.get('/api/v1/sessions', auth.requirePermission('session:manage'), (req: AuthenticatedRequest, res) => {
  res.json(auth.listAllSessions(req.cctvSessionId || null));
});

app.delete('/api/v1/sessions/:id', auth.requirePermission('session:manage'), (req: AuthenticatedRequest, res) => {
  const all = auth.listAllSessions(req.cctvSessionId || null);
  const target = all.find((session) => session.id === req.params.id);
  if (!target) return sendError(res, Object.assign(new Error('Session not found.'), { code: 'NOT_FOUND' }), 404);
  if (target.current) return sendError(res, Object.assign(new Error('Use Sign out to end your current administrator session.'), { code: 'CURRENT_SESSION' }), 400);
  const acting = req.cctvUser!;
  auth.revokeSession(target.id, acting);
  audit(req, 'session.admin_revoked', 'session', target.id, { targetUserId: target.userId, targetUsername: target.username });
  res.status(204).end();
});

app.post('/api/v1/users/:id/sessions/revoke-all', auth.requirePermission('session:manage'), (req: AuthenticatedRequest, res) => {
  if (req.params.id === req.cctvUser!.id) return sendError(res, Object.assign(new Error('Use My Account to manage your own sessions.'), { code: 'SELF_SESSION_MANAGEMENT' }), 400);
  const target = authRepo.get(req.params.id);
  if (!target) return sendError(res, Object.assign(new Error('User not found.'), { code: 'NOT_FOUND' }), 404);
  const count = auth.revokeUserSessions(target.id);
  authRepo.bumpSecurityVersion(target.id);
  audit(req, 'session.admin_revoke_all', 'user', target.id, { username: target.username, revokedCount: count });
  res.json({ revoked: count });
});

app.get('/api/v1/users', auth.requirePermission('user:view'), (_req, res) => res.json(authRepo.list()));
app.post('/api/v1/users', auth.requirePermission('user:create'), (req: AuthenticatedRequest, res) => {
  try {
    const role = String(req.body?.role || 'Viewer') as UserRole;
    if (!['Admin', 'Viewer'].includes(role)) return sendError(res, Object.assign(new Error('Invalid role.'), { code: 'INVALID_ROLE' }), 400);
    const user = auth.createUser({
      username: String(req.body?.username || ''),
      password: String(req.body?.password || ''),
      role,
      cameraAccess: role === 'Admin' ? 'all' : normalizeCameraAccess(req.body?.cameraAccess),
      recordingAccess: role === 'Admin' ? 'all' : normalizeCameraAccess(req.body?.recordingAccess),
      aiEnabled: req.body?.aiEnabled !== undefined ? Boolean(req.body.aiEnabled) : role === 'Admin',
    });
    audit(req, 'user.created', 'user', user.id, { username: user.username, role: user.role, aiEnabled: user.aiEnabled });
    res.status(201).json(user);
  } catch (error: any) { sendError(res, error, error?.code === 'USERNAME_EXISTS' ? 409 : 400); }
});

app.patch('/api/v1/users/:id', auth.requirePermission('user:update'), (req: AuthenticatedRequest, res) => {
  const existing = authRepo.get(req.params.id);
  if (!existing) return sendError(res, Object.assign(new Error('User not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const patch: any = {};
    if (req.body?.username !== undefined) {
      const username = String(req.body.username).trim();
      if (!/^[A-Za-z0-9._-]{3,48}$/.test(username)) return sendError(res, Object.assign(new Error('Username must be 3–48 characters using letters, numbers, dot, underscore, or hyphen.'), { code: 'INVALID_USERNAME' }), 400);
      const owner = authRepo.getByUsername(username);
      if (owner && owner.id !== existing.id) return sendError(res, Object.assign(new Error('Username already exists.'), { code: 'USERNAME_EXISTS' }), 409);
      patch.username = username;
    }
    const nextRole = req.body?.role !== undefined ? String(req.body.role) as UserRole : existing.role;
    if (!['Admin', 'Viewer'].includes(nextRole)) return sendError(res, Object.assign(new Error('Invalid role.'), { code: 'INVALID_ROLE' }), 400);
    if (req.body?.role !== undefined) patch.role = nextRole;
    if (nextRole === 'Admin') {
      patch.cameraAccess = 'all';
      patch.recordingAccess = 'all';
    } else {
      if (req.body?.cameraAccess !== undefined) patch.cameraAccess = normalizeCameraAccess(req.body.cameraAccess);
      if (req.body?.recordingAccess !== undefined) patch.recordingAccess = normalizeCameraAccess(req.body.recordingAccess);
    }
    if (req.body?.status !== undefined) patch.status = req.body.status === 'Inactive' ? 'Inactive' : 'Active';
    if (req.body?.aiEnabled !== undefined) patch.aiEnabled = Boolean(req.body.aiEnabled);
    if (req.body?.password) {
      if (existing.id === req.cctvUser?.id) return sendError(res, Object.assign(new Error('Change your own password from My Account.'), { code: 'USE_ACCOUNT_PASSWORD_CHANGE' }), 400);
      const err = auth.validatePassword(String(req.body.password));
      if (err) return sendError(res, Object.assign(new Error(err), { code: 'INVALID_PASSWORD' }), 400);
      patch.password_hash = auth.hashPassword(String(req.body.password));
      patch.password_changed_at = new Date().toISOString();
    }
    if (existing.id === req.cctvUser?.id && patch.status === 'Inactive') return sendError(res, Object.assign(new Error('You cannot deactivate your current account.'), { code: 'SELF_DEACTIVATE' }), 400);
    if (existing.role === 'Admin' && (nextRole !== 'Admin' || patch.status === 'Inactive')) {
      const activeAdmins = authRepo.list().filter((u) => u.role === 'Admin' && u.status === 'Active');
      if (activeAdmins.length <= 1) return sendError(res, Object.assign(new Error('At least one active administrator is required.'), { code: 'LAST_ADMIN' }), 400);
    }

    const accessChanged = patch.cameraAccess !== undefined || patch.recordingAccess !== undefined;
    const roleChanged = nextRole !== existing.role;
    const statusChanged = patch.status !== undefined && patch.status !== existing.status;
    const passwordChanged = Boolean(patch.password_hash);
    const aiChanged = patch.aiEnabled !== undefined && Boolean(patch.aiEnabled) !== existing.aiEnabled;

    authRepo.patch(existing.id, patch);
    if (accessChanged || roleChanged || statusChanged || passwordChanged || aiChanged) authRepo.bumpSecurityVersion(existing.id);
    if (roleChanged || statusChanged || passwordChanged) auth.revokeUserSessions(existing.id);
    const updatedStored = authRepo.get(existing.id)!;
    const updated = authRepo.toPublic(updatedStored);

    let action = 'user.updated';
    let resourceType = 'user';
    if (passwordChanged) action = 'user.password_reset';
    else if (roleChanged) action = 'user.role_changed';
    else if (statusChanged) action = updated.status === 'Inactive' ? 'user.disabled' : 'user.enabled';
    else if (accessChanged) { action = 'camera_access.changed'; resourceType = 'camera_access'; }
    else if (aiChanged) action = 'user.ai_access_changed';

    audit(req, action, resourceType, existing.id, {
      username: updated.username,
      previousRole: existing.role,
      role: updated.role,
      previousStatus: existing.status,
      status: updated.status,
      aiEnabled: updated.aiEnabled,
      cameraAccess: accessChanged ? updated.cameraAccess : undefined,
      recordingAccess: accessChanged ? updated.recordingAccess : undefined,
      securityVersion: updated.security_version,
    });
    res.json(updated);
  } catch (error: any) {
    sendError(res, error, String(error?.message || '').toLowerCase().includes('unique') ? 409 : 400);
  }
});

app.delete('/api/v1/users/:id', auth.requirePermission('user:update'), (req: AuthenticatedRequest, res) => {
  const existing = authRepo.get(req.params.id);
  if (!existing) return sendError(res, Object.assign(new Error('User not found.'), { code: 'NOT_FOUND' }), 404);
  if (existing.id === req.cctvUser?.id) return sendError(res, Object.assign(new Error('You cannot delete your current account.'), { code: 'SELF_DELETE' }), 400);
  if (existing.role === 'Admin' && authRepo.list().filter((u) => u.role === 'Admin' && u.status === 'Active').length <= 1) return sendError(res, Object.assign(new Error('At least one active administrator is required.'), { code: 'LAST_ADMIN' }), 400);
  auth.revokeUserSessions(existing.id);
  authRepo.delete(existing.id);
  audit(req, 'user.deleted', 'user', existing.id, { username: existing.username, role: existing.role });
  res.status(204).end();
});

// ---- Runtime stream configuration and secure HLS fallback proxy ----
app.get('/api/v1/runtime/stream-config', auth.requirePermission('camera:view'), async (req, res) => {
  const webrtc = new URL(mediaMtx.webrtcBase);
  const host = hostForUrl(req.hostname);
  const remote = await getRemoteAccessStatus();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secureOrigin = req.protocol === 'https' || forwardedProto === 'https';
  res.json({
    host: req.hostname,
    webrtcBase: `http://${host}:${webrtc.port || '8889'}`,
    hlsProxyBase: '/api/v1/media/hls',
    // Direct HTTP LAN/Tailscale access can use low-latency WebRTC. When a
    // reverse proxy such as Tailscale Serve terminates HTTPS, browsers must
    // not call the plain-HTTP :8889 signaling endpoint as mixed content.
    // In that case use the authenticated same-origin HLS proxy immediately.
    preferredProtocol: secureOrigin ? 'hls' : 'webrtc',
    fallbackProtocol: 'hls',
    remote,
    secureOriginReady: secureOrigin,
  });
});

app.post('/api/v1/cameras/:id/stream-token', auth.requirePermission('camera:view'), (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera?.stream?.path) return sendError(res, Object.assign(new Error('Camera stream is not configured.'), { code: 'STREAM_NOT_CONFIGURED' }), 404);
  if (!cameraAllowed(req, camera.id)) return sendError(res, Object.assign(new Error('You do not have access to this camera.'), { code: 'CAMERA_FORBIDDEN' }), 403);
  const issued = auth.issueMediaToken(req.cctvUser!, camera.stream.path, undefined, req.cctvSessionId || null);
  res.json({ ...issued, path: camera.stream.path });
});

app.get('/api/v1/media/hls/:cameraId/*', auth.requirePermission('camera:view'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.cameraId);
  if (!camera?.stream?.path) return sendError(res, Object.assign(new Error('Camera stream is not configured.'), { code: 'STREAM_NOT_CONFIGURED' }), 404);
  if (!cameraAllowed(req, camera.id)) return sendError(res, Object.assign(new Error('You do not have access to this camera.'), { code: 'CAMERA_FORBIDDEN' }), 403);
  const tail = String(req.params[0] || 'index.m3u8').replace(/^\/+/, '');
  if (!/^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(tail) || tail.split('/').some((part) => part === '.' || part === '..')) {
    return sendError(res, Object.assign(new Error('Invalid media path.'), { code: 'BAD_MEDIA_PATH' }), 400);
  }
  const token = auth.issueMediaToken(req.cctvUser!, camera.stream.path, 120, req.cctvSessionId || null).token;
  const source = `${mediaMtx.hlsBase}/${encodeURIComponent(camera.stream.path)}/${tail}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (req.headers.range) headers.Range = req.headers.range;
  try {
    const upstream = await fetch(source, { headers });
    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (error: any) {
    if (!res.headersSent) sendError(res, Object.assign(new Error(error?.message || 'HLS proxy failed.'), { code: 'HLS_PROXY_FAILED' }), 502);
    else res.end();
  }
});

// ---- USB / DirectShow ----
const requireCameraRecord = (permission: 'camera:update' | 'camera:delete' | 'camera:restart') => [
  auth.requirePermission(permission),
  (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const camera = repo.get(req.params.id);
    if (!camera) return sendError(res, Object.assign(new Error('Camera not found'), { code: 'NOT_FOUND' }), 404);
    next();
  },
] as const;
const cameraCreateOnly = auth.requirePermission('camera:create');
app.get(['/usb/devices', '/api/usb/devices', '/api/v1/usb/devices'], cameraCreateOnly, async (_req, res) => {
  try { res.json(await enumerateDevices()); }
  catch (error) { sendError(res, error, 503); }
});
app.get(['/usb/formats', '/api/usb/formats', '/api/v1/usb/formats'], cameraCreateOnly, async (req, res) => {
  const deviceId = String(req.query.device_id || '');
  if (!deviceId) return sendError(res, Object.assign(new Error('device_id is required'), { code: 'BAD_REQUEST' }), 400);
  try { res.json(await enumerateFormats(deviceId)); }
  catch (error) { sendError(res, error, 503); }
});
app.get(['/usb/encoders', '/api/usb/encoders', '/api/v1/usb/encoders'], cameraCreateOnly, async (_req, res) => {
  try { res.json(await getEncoderCapabilities()); }
  catch (error) { sendError(res, error, 500); }
});
app.post(['/usb/probe', '/api/usb/probe', '/api/v1/usb/probe'], cameraCreateOnly, async (req, res) => {
  const { device_id, width = 1280, height = 720, fps = 30, pixel_format = 'mjpeg' } = req.body || {};
  if (!device_id) return sendError(res, Object.assign(new Error('device_id is required'), { code: 'BAD_REQUEST' }), 400);
  const result = await probeUsbCapture({ device_id, width: Number(width), height: Number(height), fps: Number(fps), pixel_format });
  res.status(result.ok ? 200 : 422).json(result);
});

// ---- RTSP / network camera source validation ----
function parseRtspInput(body: any) {
  const vendorProfile: RtspVendorProfile = body?.vendor_profile === 'tenda-cp3-pro' ? 'tenda-cp3-pro' : 'generic';
  const host = String(body?.host || '').trim();
  const portDefault = 554;
  const pathDefault = vendorProfile === 'tenda-cp3-pro' ? '/ch=1&subtype=0' : '/';
  const port = Number(body?.port || portDefault);
  const streamPath = normalizeRtspPath(String(body?.path || pathDefault));
  const transport: RtspTransport = body?.transport === 'udp' ? 'udp' : 'tcp';
  const videoMode: RtspVideoMode = body?.video_mode === 'copy' ? 'copy' : 'transcode';
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  const encoder = String(body?.encoder || 'auto');
  const bitrateKbps = Math.max(256, Math.min(20000, Number(body?.bitrate_kbps || 2500)));
  if (!host || host.length > 255 || /[\/@?#\s]/.test(host)) throw Object.assign(new Error('A valid RTSP camera host/IP address is required (host only, without rtsp://, path, or credentials).'), { code: 'RTSP_HOST_REQUIRED' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('RTSP port must be between 1 and 65535.'), { code: 'RTSP_PORT_INVALID' });
  if (streamPath.length > 512) throw Object.assign(new Error('RTSP path is too long.'), { code: 'RTSP_PATH_INVALID' });
  return { vendorProfile, host, port, streamPath, transport, videoMode, username, password, encoder, bitrateKbps };
}

app.post('/api/v1/cameras/rtsp/test', cameraCreateOnly, async (req: AuthenticatedRequest, res) => {
  try {
    const input = parseRtspInput(req.body);
    const ffmpeg = await findFfmpegPath();
    const result = await probeRtspSource(ffmpeg, { host: input.host, port: input.port, path: input.streamPath, username: input.username, password: input.password, transport: input.transport });
    audit(req, result.ok ? 'camera.rtsp_test_succeeded' : 'camera.rtsp_test_failed', 'camera_source', null, { host: input.host, port: input.port, path: input.streamPath, vendorProfile: input.vendorProfile, code: result.code || null });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error: any) { sendError(res, error, 400); }
});

// ---- Camera registry and lifecycle ----
app.get('/api/v1/cameras', auth.requirePermission('camera:view'), (req: AuthenticatedRequest, res) => {
  const cameras = repo.list().filter((camera) => cameraAllowed(req, camera.id)).map((camera) => cameraForClient(req.cctvUser!, camera));
  res.json(cameras);
});
app.get('/api/v1/cameras/:id', auth.requirePermission('camera:view'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found'), { code: 'NOT_FOUND' }), 404);
  if (!cameraAllowed(req, camera.id)) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  const clientCamera = cameraForClient(req.cctvUser!, camera);
  if (req.cctvUser!.role !== 'Admin') return res.json(clientCamera);
  const media = camera.stream?.path ? await mediaMtx.pathInfo(camera.stream.path) : null;
  res.json({ ...clientCamera, runtime: cameraProcesses.runtime(camera.id), media: media ? { ready: Boolean(media.ready), readers: Array.isArray(media.readers) ? media.readers.length : 0 } : null });
});
app.patch('/api/v1/cameras/:id', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found'), { code: 'NOT_FOUND' }), 404);
  const patch: Partial<Camera> = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 100) return sendError(res, Object.assign(new Error('Camera name must be 1–100 characters.'), { code: 'CAMERA_NAME_INVALID' }), 400);
    patch.name = name;
  }
  if (req.body?.location !== undefined) patch.location = String(req.body.location).trim().slice(0, 120);
  const updated = repo.patch(camera.id, patch);
  audit(req, 'camera.updated', 'camera', camera.id, { name: updated?.name, location: updated?.location });
  res.json(updated);
});

async function probeStoredUsbCamera(camera: Camera) {
  if (camera.source_type !== 'usb' || !camera.usb_source) return { ok: true, ffmpeg_available: true, device_opened: true, message: 'Capture probe is not required for this camera type.' };
  return probeUsbCapture({ device_id: camera.usb_source.device_id, width: camera.usb_source.width, height: camera.usb_source.height, fps: camera.usb_source.fps, pixel_format: camera.usb_source.pixel_format });
}

async function startCameraWithProbe(cameraId: string): Promise<Camera> {
  const camera = repo.get(cameraId);
  if (!camera) throw Object.assign(new Error('Camera not found'), { code: 'NOT_FOUND' });
  repo.patch(camera.id, { enabled: true, status: 'starting', last_error: null });
  if (camera.source_type === 'usb') {
    const probe = await probeStoredUsbCamera(camera);
    if (!probe.ok) {
      repo.patch(camera.id, { enabled: false, status: 'error', last_error: probe.message });
      throw Object.assign(new Error(probe.message), { code: probe.code || 'CAPTURE_FAILED', details: probe.details, stage: 'capture' });
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  try { return await cameraProcesses.start(camera.id); }
  catch (error: any) {
    repo.patch(camera.id, { enabled: false, status: 'error', last_error: error?.message || String(error) });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: error?.code || 'STREAM_START_FAILED', details: error?.details, stage: error?.stage || 'stream' });
  }
}

const saveUsbCameraHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  const { name = 'USB Webcam', location = 'DirectShow Server Zone', device_id, device_name = 'USB DirectShow Camera', width = 1280, height = 720, fps = 30, pixel_format = null, encoder = 'auto', bitrate_kbps = 2500, start_immediately = true } = req.body || {};
  if (!device_id) return sendError(res, Object.assign(new Error('device_id is required'), { code: 'BAD_REQUEST' }), 400);
  const id = `cam-usb-${Date.now()}`;
  const streamPath = `cam-${id}`;
  const camera: Camera = {
    id, name: String(name).trim() || String(device_name), location: String(location).trim() || 'DirectShow Server Zone', address: 'localhost (USB)', status: 'configured', recording: false,
    recordingMode: 'disabled', resolution: `${width} × ${height}`, fps: Number(fps), bitrate: `${(Number(bitrate_kbps) / 1000).toFixed(1)} Mbps`, codec: 'H.264 (not started)', model: String(device_name), uptime: 'Not started', lastSeen: 'Never', lastMotion: 'None', protocol: 'DirectShow → FFmpeg → MediaMTX → WebRTC/HLS', ptz: false, substream: 'Not configured', enabled: false, source_type: 'usb', last_error: null,
    stream: { path: streamPath, protocol: 'webrtc', whepPath: `/${streamPath}/whep` },
    usb_source: { device_id: String(device_id), device_name: String(device_name), width: Number(width), height: Number(height), fps: Number(fps), pixel_format, encoder: String(encoder), encoder_active: null, bitrate_kbps: Number(bitrate_kbps), last_capture_error: null },
  };
  repo.save(camera);
  audit(req, 'camera.created', 'camera', id, { name: camera.name, sourceType: camera.source_type });
  if (!Boolean(start_immediately)) return res.status(201).json(repo.get(id));
  try {
    const started = await startCameraWithProbe(id);
    audit(req, 'camera.started', 'camera', id);
    return res.status(201).json(started);
  }
  catch (error: any) {
    try { await cameraProcesses.stop(id, false); } catch {}
    repo.delete(id);
    audit(req, 'camera.create_failed', 'camera', id, { message: error?.message || String(error), stage: error?.stage || 'stream' });
    return sendError(res, error, error?.stage === 'capture' ? 422 : 503);
  }
};

const saveRtspCameraHandler = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const input = parseRtspInput(req.body);
    const { name = input.vendorProfile === 'tenda-cp3-pro' ? 'Tenda CP3 Pro' : 'RTSP Camera', location = 'Network Camera', fps = 20, detected_codec = null, detected_width = null, detected_height = null, start_immediately = true } = req.body || {};
    const detectedWidth = Number(detected_width);
    const detectedHeight = Number(detected_height);
    const detectedResolution = Number.isFinite(detectedWidth) && Number.isFinite(detectedHeight) && detectedWidth > 0 && detectedHeight > 0 ? `${Math.round(detectedWidth)} × ${Math.round(detectedHeight)}` : 'Detected after connection';
    const detectedCodec = String(detected_codec || '').trim();
    const id = `cam-rtsp-${Date.now()}`;
    const streamPath = `cam-${id}`;
    const passwordEncrypted = credentials.encrypt(input.password);
    const camera: Camera = {
      id,
      name: String(name).trim() || (input.vendorProfile === 'tenda-cp3-pro' ? 'Tenda CP3 Pro' : 'RTSP Camera'),
      location: String(location).trim() || 'Network Camera',
      address: `${input.host}:${input.port}`,
      status: 'configured',
      recording: false,
      recordingMode: 'disabled',
      resolution: detectedResolution,
      fps: Math.max(1, Math.min(60, Number(fps || 20))),
      bitrate: `${(input.bitrateKbps / 1000).toFixed(1)} Mbps`,
      codec: input.videoMode === 'copy' ? (detectedCodec ? `${detectedCodec.toUpperCase()} (stream copy)` : 'Source codec (stream copy)') : 'H.264 (transcode)',
      model: input.vendorProfile === 'tenda-cp3-pro' ? 'Tenda CP3 Pro' : 'Generic RTSP Camera',
      uptime: 'Not started',
      lastSeen: 'Never',
      lastMotion: 'Not implemented',
      protocol: 'RTSP → FFmpeg → MediaMTX → WebRTC/HLS',
      ptz: input.vendorProfile === 'tenda-cp3-pro',
      substream: 'Not configured',
      enabled: false,
      source_type: 'rtsp',
      last_error: null,
      stream: { path: streamPath, protocol: 'webrtc', whepPath: `/${streamPath}/whep` },
      rtsp_source: {
        host: input.host, port: input.port, path: input.streamPath, username: input.username, transport: input.transport,
        video_mode: input.videoMode, encoder: input.encoder, encoder_active: null, bitrate_kbps: input.bitrateKbps,
        vendor_profile: input.vendorProfile, credential_configured: Boolean(input.username || input.password),
      },
    };
    repo.save(camera);
    repo.saveRtspConfig(id, {
      host: input.host, port: input.port, stream_path: input.streamPath, username: input.username, password_encrypted: passwordEncrypted,
      transport: input.transport, video_mode: input.videoMode, encoder: input.encoder, bitrate_kbps: input.bitrateKbps, vendor_profile: input.vendorProfile,
    });
    audit(req, 'camera.created', 'camera', id, { name: camera.name, sourceType: camera.source_type, vendorProfile: input.vendorProfile, host: input.host, port: input.port, path: input.streamPath });
    if (!Boolean(start_immediately)) return res.status(201).json(repo.get(id));
    try {
      const started = await startCameraWithProbe(id);
      audit(req, 'camera.started', 'camera', id);
      return res.status(201).json(started);
    } catch (error: any) {
      try { await cameraProcesses.stop(id, false); } catch {}
      repo.delete(id);
      audit(req, 'camera.create_failed', 'camera', id, { message: String(error?.message || error).replace(/rtsp:\/\/[^\s@]+@/gi, 'rtsp://***@'), stage: error?.stage || 'stream' });
      return sendError(res, error, error?.stage === 'capture' ? 422 : 503);
    }
  } catch (error: any) {
    return sendError(res, error, 400);
  }
};

app.post(['/cameras/usb', '/api/cameras/usb', '/api/v1/cameras/usb'], cameraCreateOnly, saveUsbCameraHandler);
app.post('/api/v1/cameras/rtsp', cameraCreateOnly, saveRtspCameraHandler);
app.post('/api/v1/cameras/:id/start', ...requireCameraRecord('camera:restart'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id)!;
  try {
    const started = await startCameraWithProbe(camera.id);
    audit(req, 'camera.started', 'camera', camera.id);
    res.json(started);
  } catch (error: any) { sendError(res, error, error?.stage === 'capture' ? 422 : 503); }
});
app.post('/api/v1/cameras/:id/stop', ...requireCameraRecord('camera:restart'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id)!;
  try {
    const stopped = await cameraProcesses.stop(camera.id, true);
    audit(req, 'camera.stopped', 'camera', camera.id);
    res.json(stopped);
  } catch (error) { sendError(res, error, 500); }
});
app.post('/api/v1/cameras/:id/restart', ...requireCameraRecord('camera:restart'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id)!;
  try {
    await cameraProcesses.stop(camera.id, false);
    const restarted = await startCameraWithProbe(camera.id);
    audit(req, 'camera.restarted', 'camera', camera.id);
    res.json(restarted);
  } catch (error: any) { sendError(res, error, error?.stage === 'capture' ? 422 : 503); }
});
app.delete('/api/v1/cameras/:id', ...requireCameraRecord('camera:delete'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id)!;
  if (recordingService.list(camera.id, null, 1).length > 0 || await recordingService.hasRecordingFiles(camera.id)) return sendError(res, Object.assign(new Error('This camera has recording files. P0.16.1 blocks camera deletion while recording files still exist; delete or archive them first.'), { code: 'CAMERA_HAS_RECORDINGS' }), 409);
  await motionService.updateSettings(camera.id, { enabled: false }).catch(() => undefined);
  try { aiService.updateSettings(camera.id, { enabled: false }); } catch {}
  await recordingService.setContinuous(camera.id, false).catch(() => undefined);
  await cameraProcesses.stop(camera.id, true);
  repo.delete(camera.id);
  authRepo.removeCameraAccess(camera.id);
  audit(req, 'camera.deleted', 'camera', camera.id, { name: camera.name });
  res.status(204).end();
});


// ---- Local AI person/vehicle detection (USB cameras; ONNX model) ----
app.get('/api/v1/cameras/:id/ai', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  res.json(aiService.runtime(camera.id));
});
app.patch('/api/v1/cameras/:id/ai', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const runtime = aiService.updateSettings(camera.id, {
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      confidencePercent: req.body?.confidencePercent === undefined ? undefined : Number(req.body.confidencePercent),
      personConfidencePercent: req.body?.personConfidencePercent === undefined ? undefined : Number(req.body.personConfidencePercent),
      vehicleConfidencePercent: req.body?.vehicleConfidencePercent === undefined ? undefined : Number(req.body.vehicleConfidencePercent),
      sampleIntervalSeconds: req.body?.sampleIntervalSeconds === undefined ? undefined : Number(req.body.sampleIntervalSeconds),
      cooldownSeconds: req.body?.cooldownSeconds === undefined ? undefined : Number(req.body.cooldownSeconds),
      detectPerson: req.body?.detectPerson === undefined ? undefined : Boolean(req.body.detectPerson),
      detectVehicle: req.body?.detectVehicle === undefined ? undefined : Boolean(req.body.detectVehicle),
      performanceProfile: req.body?.performanceProfile,
      triggerMode: req.body?.triggerMode,
      motionGateSeconds: req.body?.motionGateSeconds === undefined ? undefined : Number(req.body.motionGateSeconds),
      motionZoneId: req.body?.motionZoneId === undefined ? undefined : req.body.motionZoneId === null ? null : Number(req.body.motionZoneId),
      preSeconds: req.body?.preSeconds === undefined ? undefined : Number(req.body.preSeconds),
      postSeconds: req.body?.postSeconds === undefined ? undefined : Number(req.body.postSeconds),
    });
    audit(req, 'ai.settings_updated', 'camera', camera.id, { enabled: runtime.enabled, profile: runtime.settings.performanceProfile, triggerMode: runtime.settings.triggerMode, personConfidencePercent: runtime.settings.personConfidencePercent, vehicleConfidencePercent: runtime.settings.vehicleConfidencePercent, sampleIntervalSeconds: runtime.settings.sampleIntervalSeconds, cooldownSeconds: runtime.settings.cooldownSeconds, detectPerson: runtime.settings.detectPerson, detectVehicle: runtime.settings.detectVehicle, motionZoneId: runtime.settings.motionZoneId });
    res.json(runtime);
  } catch (error) { sendError(res, error, (error as any)?.code === 'AI_SOURCE_UNSUPPORTED' ? 422 : 400); }
});

app.post('/api/v1/cameras/:id/ai/pause', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  try { const runtime = aiService.pause(req.params.id, Number(req.body?.minutes ?? 15)); audit(req, 'ai.paused', 'camera', req.params.id, { pausedUntil: runtime.pausedUntil }); res.json(runtime); }
  catch (error: any) { sendError(res, error, error?.code === 'NOT_FOUND' ? 404 : 400); }
});
app.post('/api/v1/cameras/:id/ai/resume', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  try { const runtime = aiService.resume(req.params.id); audit(req, 'ai.resumed', 'camera', req.params.id); res.json(runtime); }
  catch (error: any) { sendError(res, error, error?.code === 'NOT_FOUND' ? 404 : 400); }
});

app.get('/api/v1/events/:id/ai-context', auth.requirePermission('event:view'), (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id); if (!Number.isInteger(eventId) || eventId < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEventRepo.get(eventId); const context = aiService.context(eventId);
  if (!event || !context || !event.camera_id || !cameraAllowed(req, event.camera_id)) return sendError(res, Object.assign(new Error('AI event not found.'), { code: 'NOT_FOUND' }), 404);
  res.json(context);
});

app.patch('/api/v1/events/:id/ai-review', auth.requirePermission('event:view'), (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id); if (!Number.isInteger(eventId) || eventId < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEventRepo.get(eventId); if (!event?.camera_id || !cameraAllowed(req, event.camera_id)) return sendError(res, Object.assign(new Error('AI event not found.'), { code: 'NOT_FOUND' }), 404);
  try { const review = aiService.review(eventId, req.body?.status, String(req.body?.note || ''), req.cctvUser?.username || null); audit(req, 'ai.event_reviewed', 'operational_event', String(eventId), { status: review.status }); res.json(review); }
  catch (error: any) { sendError(res, error, error?.code === 'NOT_FOUND' ? 404 : 400); }
});

app.get('/api/v1/events/:id/ai-snapshot', auth.requirePermission('event:view'), async (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id); const event = operationalEventRepo.get(eventId);
  if (!event?.camera_id || !cameraAllowed(req, event.camera_id)) return sendError(res, Object.assign(new Error('AI snapshot not found.'), { code: 'NOT_FOUND' }), 404);
  const snapshot = await aiService.snapshotPath(eventId); if (!snapshot) return sendError(res, Object.assign(new Error('AI snapshot not found.'), { code: 'NOT_FOUND' }), 404);
  res.setHeader('Cache-Control','no-store'); res.type('image/jpeg'); createReadStream(snapshot).pipe(res);
});
app.get('/api/v1/events/:id/ai-recordings', auth.requirePermission('event:view', 'recording:view'), async (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id); const context = aiService.context(eventId);
  if (!context) return sendError(res, Object.assign(new Error('AI event not found.'), { code: 'NOT_FOUND' }), 404);
  if (!recordingAllowed(req, context.cameraId)) return sendError(res, Object.assign(new Error('Recording access denied.'), { code: 'FORBIDDEN' }), 403);
  await aiService.linkEvent(eventId);
  const rows = aiService.linkedRecordingIds(eventId).map((id) => recordingRepo.get(id)).filter(Boolean) as RecordingSegmentRow[];
  res.json(rows.map((row) => ({ id: row.id, cameraId: row.camera_id, cameraName: row.camera_name || repo.get(row.camera_id)?.name || row.camera_id, startedAt: row.started_at, endedAt: row.ended_at, durationSeconds: row.duration_seconds, sizeBytes: row.size_bytes, status: row.status, protected: Boolean((row as any).is_protected), mediaUrl: `/api/v1/recordings/${row.id}/media`, downloadUrl: `/api/v1/recordings/${row.id}/download` })));
});

// ---- Motion detection + event-linked recording (USB cameras) ----
app.get('/api/v1/cameras/:id/motion', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  res.json(motionService.runtime(camera.id));
});

app.patch('/api/v1/cameras/:id/motion', auth.requirePermission('camera:update'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const runtime = await motionService.updateSettings(camera.id, {
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      sensitivity: req.body?.sensitivity === undefined ? undefined : Number(req.body.sensitivity),
      cooldownSeconds: req.body?.cooldownSeconds === undefined ? undefined : Number(req.body.cooldownSeconds),
      preSeconds: req.body?.preSeconds === undefined ? undefined : Number(req.body.preSeconds),
      postSeconds: req.body?.postSeconds === undefined ? undefined : Number(req.body.postSeconds),
    });
    audit(req, 'motion.settings_updated', 'camera', camera.id, { enabled: runtime.enabled, sensitivity: runtime.settings.sensitivity, cooldownSeconds: runtime.settings.cooldownSeconds, preSeconds: runtime.settings.preSeconds, postSeconds: runtime.settings.postSeconds });
    res.json(runtime);
  } catch (error) { sendError(res, error, (error as any)?.code === 'MOTION_SOURCE_UNSUPPORTED' ? 422 : 400); }
});


app.get('/api/v1/cameras/:id/motion/zones', auth.requirePermission('camera:update'), (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  res.json(motionService.zones(camera.id));
});

app.post('/api/v1/cameras/:id/motion/zones', auth.requirePermission('camera:update'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const zone = await motionService.createZone(camera.id, {
      name: req.body?.name,
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      x: req.body?.x,
      y: req.body?.y,
      width: req.body?.width,
      height: req.body?.height,
      sensitivity: req.body?.sensitivity === undefined ? undefined : req.body.sensitivity === null ? null : Number(req.body.sensitivity),
    });
    audit(req, 'motion.zone_created', 'camera', camera.id, { zoneId: zone.id, name: zone.name, x: zone.x, y: zone.y, width: zone.width, height: zone.height, sensitivity: zone.sensitivity });
    res.status(201).json(zone);
  } catch (error: any) { sendError(res, error, error?.code === 'MOTION_SOURCE_UNSUPPORTED' ? 422 : error?.code === 'MOTION_ZONE_LIMIT' ? 409 : 400); }
});

app.patch('/api/v1/cameras/:id/motion/zones/:zoneId', auth.requirePermission('camera:update'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  const zoneId = Number(req.params.zoneId);
  if (!Number.isInteger(zoneId) || zoneId < 1) return sendError(res, Object.assign(new Error('Invalid motion zone id.'), { code: 'BAD_REQUEST' }), 400);
  try {
    const zone = await motionService.updateZone(camera.id, zoneId, {
      name: req.body?.name,
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      x: req.body?.x,
      y: req.body?.y,
      width: req.body?.width,
      height: req.body?.height,
      sensitivity: req.body?.sensitivity === undefined ? undefined : req.body.sensitivity === null ? null : Number(req.body.sensitivity),
    });
    audit(req, 'motion.zone_updated', 'camera', camera.id, { zoneId: zone.id, name: zone.name, enabled: zone.enabled, x: zone.x, y: zone.y, width: zone.width, height: zone.height, sensitivity: zone.sensitivity });
    res.json(zone);
  } catch (error: any) { sendError(res, error, error?.code === 'NOT_FOUND' ? 404 : error?.code === 'MOTION_SOURCE_UNSUPPORTED' ? 422 : 400); }
});

app.delete('/api/v1/cameras/:id/motion/zones/:zoneId', auth.requirePermission('camera:update'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  const zoneId = Number(req.params.zoneId);
  if (!Number.isInteger(zoneId) || zoneId < 1) return sendError(res, Object.assign(new Error('Invalid motion zone id.'), { code: 'BAD_REQUEST' }), 400);
  try {
    const deleted = await motionService.deleteZone(camera.id, zoneId);
    if (!deleted) return sendError(res, Object.assign(new Error('Motion zone not found.'), { code: 'NOT_FOUND' }), 404);
    audit(req, 'motion.zone_deleted', 'camera', camera.id, { zoneId });
    res.status(204).end();
  } catch (error: any) { sendError(res, error, error?.code === 'MOTION_SOURCE_UNSUPPORTED' ? 422 : 400); }
});

app.get('/api/v1/events/:id/motion-context', auth.requirePermission('event:view'), (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEventRepo.get(eventId);
  const context = motionService.context(eventId);
  if (!event || event.type !== 'MOTION_DETECTED' || !context || !event.camera_id || !cameraAllowed(req, event.camera_id)) return sendError(res, Object.assign(new Error('Motion event not found.'), { code: 'NOT_FOUND' }), 404);
  res.json(context);
});

app.get('/api/v1/events/:id/snapshot', auth.requirePermission('event:view'), async (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEventRepo.get(eventId);
  if (!event || event.type !== 'MOTION_DETECTED' || !event.camera_id || !cameraAllowed(req, event.camera_id)) return sendError(res, Object.assign(new Error('Snapshot not found.'), { code: 'NOT_FOUND' }), 404);
  const snapshot = await motionService.snapshotPath(eventId);
  if (!snapshot) return sendError(res, Object.assign(new Error('Snapshot not found.'), { code: 'NOT_FOUND' }), 404);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  createReadStream(snapshot).pipe(res);
});

app.patch('/api/v1/events/:id/motion-review', auth.requirePermission('event:view'), (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEventRepo.get(eventId);
  if (!event || event.type !== 'MOTION_DETECTED' || !event.camera_id || !cameraAllowed(req, event.camera_id)) return sendError(res, Object.assign(new Error('Motion event not found.'), { code: 'NOT_FOUND' }), 404);
  const rawStatus = String(req.body?.status || 'unreviewed');
  const status: MotionReviewStatus = rawStatus === 'confirmed' || rawStatus === 'dismissed' ? rawStatus : 'unreviewed';
  const note = String(req.body?.note || '').slice(0, 1000);
  try {
    const review = motionService.review(eventId, status, note);
    audit(req, 'motion.event_reviewed', 'operational_event', String(eventId), { eventType: event.type, status: review.status, noteLength: review.note.length });
    res.json(review);
  } catch (error: any) { sendError(res, error, error?.code === 'NOT_FOUND' ? 404 : 400); }
});

app.get('/api/v1/events/:id/recordings', auth.requirePermission('event:view', 'recording:view'), async (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEventRepo.get(eventId);
  if (!event || event.type !== 'MOTION_DETECTED' || !event.camera_id || !recordingAllowed(req, event.camera_id)) {
    return sendError(res, Object.assign(new Error('Linked recording not found.'), { code: 'NOT_FOUND' }), 404);
  }
  await motionService.linkEvent(eventId);
  const rows = motionService.linkedRecordingIds(eventId)
    .map((id) => recordingService.get(id))
    .filter((row): row is RecordingSegmentRow => Boolean(row && recordingAllowed(req, row.camera_id)))
    .map(recordingForClient);
  res.json(rows);
});

// ---- Continuous recording MVP (USB cameras) ----
function recordingForClient(row: RecordingSegmentRow) {
  return {
    id: row.id,
    cameraId: row.camera_id,
    cameraName: row.camera_name || repo.get(row.camera_id)?.name || row.camera_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    status: row.status,
    codec: row.codec,
    protected: row.is_protected,
    mediaUrl: `/api/v1/recordings/${row.id}/media`,
    downloadUrl: `/api/v1/recordings/${row.id}/download`,
  };
}

app.get('/api/v1/recordings', auth.requirePermission('recording:view'), (req: AuthenticatedRequest, res) => {
  const requestedCameraId = String(req.query.cameraId || '').trim() || null;
  if (requestedCameraId && !recordingAllowed(req, requestedCameraId)) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
  const date = String(req.query.date || '').trim() || null;
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 250)));
  const protectedOnly = String(req.query.protected || '') === '1' || String(req.query.protected || '').toLowerCase() === 'true';
  const rows = recordingService.list(requestedCameraId, date, limit, protectedOnly)
    .filter((row) => recordingAllowed(req, row.camera_id))
    .map(recordingForClient);
  res.json(rows);
});

app.get('/api/v1/recordings/runtime', auth.requirePermission('recording:view'), (req: AuthenticatedRequest, res) => {
  const runtimes = recordingService.runtimesSnapshot().filter((runtime) => recordingAllowed(req, runtime.cameraId));
  const allowedIds = runtimes.map((runtime) => runtime.cameraId);
  res.json({ summary: recordingService.summary(allowedIds), runtimes });
});


app.get('/api/v1/recordings/policy', auth.requirePermission('recording:manage'), (_req: AuthenticatedRequest, res) => {
  res.json(recordingService.policy());
});

app.patch('/api/v1/recordings/policy', auth.requirePermission('recording:manage'), (req: AuthenticatedRequest, res) => {
  const input = req.body || {};
  const policy = recordingService.updatePolicy({
    enabled: input.enabled === undefined ? undefined : Boolean(input.enabled),
    maxAgeDays: input.maxAgeDays === undefined ? undefined : Number(input.maxAgeDays),
    maxStorageBytes: input.maxStorageBytes === undefined ? undefined : Number(input.maxStorageBytes),
    minFreeBytes: input.minFreeBytes === undefined ? undefined : Number(input.minFreeBytes),
  });
  audit(req, 'recording.retention_policy_updated', 'recording', 'retention-policy', { enabled: policy.enabled, maxAgeDays: policy.maxAgeDays, maxStorageBytes: policy.maxStorageBytes, minFreeBytes: policy.minFreeBytes });
  res.json(policy);
});

app.get('/api/v1/recordings/health', auth.requirePermission('recording:manage'), (_req: AuthenticatedRequest, res) => {
  res.json({ health: recordingService.health(), quarantine: recordingService.quarantine(250) });
});

app.post('/api/v1/recordings/reconcile', auth.requirePermission('recording:manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await recordingService.reconcile();
    audit(req, 'recording.reconciled', 'recording', 'library', { health: result.health, quarantinedCount: result.quarantined.length });
    res.json(result);
  } catch (error) { sendError(res, error, 500); }
});

app.post('/api/v1/recordings/retention/run', auth.requirePermission('recording:manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await recordingService.runRetention();
    audit(req, 'recording.retention_run', 'recording', 'retention-policy', result as unknown as Record<string, unknown>);
    res.json(result);
  } catch (error) { sendError(res, error, 500); }
});

app.patch('/api/v1/recordings/:id/protection', auth.requirePermission('recording:manage'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const row = recordingService.get(id);
    if (!row || !recordingAllowed(req, row.camera_id)) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
    const updated = recordingService.protect(id, Boolean(req.body?.protected));
    audit(req, updated.is_protected ? 'recording.protected' : 'recording.unprotected', 'recording', String(id), { cameraId: updated.camera_id, startedAt: updated.started_at });
    res.json(recordingForClient(updated));
  } catch (error: any) { sendError(res, error, error?.code === 'NOT_FOUND' ? 404 : 500); }
});

app.delete('/api/v1/recordings/:id', auth.requirePermission('recording:delete'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const row = recordingService.get(id);
    if (!row || !recordingAllowed(req, row.camera_id)) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
    const result = await recordingService.deleteSegment(id);
    audit(req, 'recording.deleted', 'recording', String(id), { cameraId: result.row.camera_id, startedAt: result.row.started_at, bytes: result.row.size_bytes, deletedFile: result.deletedFile });
    res.status(204).end();
  } catch (error: any) { sendError(res, error, error?.code === 'RECORDING_PROTECTED' ? 409 : error?.code === 'NOT_FOUND' ? 404 : 500); }
});

app.post('/api/v1/recordings/delete-bulk', auth.requirePermission('recording:delete'), async (req: AuthenticatedRequest, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0) : [];
  if (!ids.length) return sendError(res, Object.assign(new Error('Select at least one recording.'), { code: 'INVALID_RECORDING_SELECTION' }), 400);
  const allowedIds = ids.filter((id: number) => { const row = recordingService.get(id); return Boolean(row && recordingAllowed(req, row.camera_id)); });
  try {
    const result = await recordingService.deleteSegments(allowedIds);
    audit(req, 'recording.bulk_deleted', 'recording', 'bulk', { requested: ids.length, allowed: allowedIds.length, ...result });
    res.json(result);
  } catch (error) { sendError(res, error, 500); }
});

app.post('/api/v1/cameras/:id/recording/start', auth.requirePermission('recording:manage'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const runtime = await recordingService.setContinuous(camera.id, true);
    audit(req, 'recording.enabled', 'camera', camera.id, { mode: 'continuous', sourceType: camera.source_type });
    res.json({ camera: repo.get(camera.id), runtime });
  } catch (error: any) { sendError(res, error, error?.code === 'RECORDING_SOURCE_UNSUPPORTED' ? 422 : error?.code === 'CAMERA_STREAM_NOT_READY' ? 409 : 500); }
});

app.post('/api/v1/cameras/:id/recording/stop', auth.requirePermission('recording:manage'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  try {
    const runtime = await recordingService.setContinuous(camera.id, false);
    audit(req, 'recording.disabled', 'camera', camera.id, { mode: 'disabled' });
    res.json({ camera: repo.get(camera.id), runtime });
  } catch (error) { sendError(res, error, 500); }
});

async function serveRecording(req: AuthenticatedRequest, res: express.Response, download: boolean) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
  const row = recordingService.get(id);
  if (!row || !recordingAllowed(req, row.camera_id)) return sendError(res, Object.assign(new Error('Recording not found.'), { code: 'NOT_FOUND' }), 404);
  const verified = await recordingService.verifyFile(row);
  if (!verified || verified.status !== 'complete') return sendError(res, Object.assign(new Error('Recording file is unavailable.'), { code: 'RECORDING_FILE_MISSING' }), 410);
  let stat;
  try { stat = await fs.stat(verified.file_path); }
  catch { return sendError(res, Object.assign(new Error('Recording file is unavailable.'), { code: 'RECORDING_FILE_MISSING' }), 410); }
  const total = Number(stat.size);
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(verified.file_path)}"`);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  const range = req.headers.range;
  if (range && !download) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
    let start: number;
    let end: number;
    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) return res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      start = Math.max(0, total - suffixLength);
      end = total - 1;
    } else {
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) return res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    const stream = createReadStream(verified.file_path, { start, end });
    stream.once('error', () => { if (!res.headersSent) res.status(410).end(); else res.destroy(); });
    return stream.pipe(res);
  }
  res.setHeader('Content-Length', String(total));
  const stream = createReadStream(verified.file_path);
  stream.once('error', () => { if (!res.headersSent) res.status(410).end(); else res.destroy(); });
  stream.pipe(res);
}

app.get('/api/v1/recordings/:id/media', auth.requirePermission('recording:view'), (req: AuthenticatedRequest, res) => void serveRecording(req, res, false));
app.get('/api/v1/recordings/:id/download', auth.requirePermission('recording:download'), (req: AuthenticatedRequest, res) => void serveRecording(req, res, true));

app.get('/api/v1/system/info', auth.requirePermission('system:view'), (_req, res) => {
  res.json({ name: 'CCTV Monitor', version: APP_VERSION, node: process.version, platform: `${process.platform} ${process.arch}`, databaseSchemaVersion: repo.schemaVersion() });
});

app.get('/api/v1/system/status', auth.requirePermission('system:view'), async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await systemStatusService.snapshot(req.cctvUser!, (user, cameraId) => auth.canAccessCamera(user, cameraId)));
  } catch (error) { sendError(res, error, 500); }
});

app.get('/api/v1/system/diagnostics', auth.requirePermission('system:view'), async (req: AuthenticatedRequest, res) => {
  try {
    const status = await systemStatusService.snapshot(req.cctvUser!, (user, cameraId) => auth.canAccessCamera(user, cameraId));
    const motionRuntimes = motionService.runtimesSnapshot();
    const aiRuntimes = aiService.runtimesSnapshot();
    const motionActive = motionRuntimes.filter((item) => item.active).length;
    const motionEnabled = motionRuntimes.filter((item) => item.enabled).length;
    const aiActive = aiRuntimes.filter((item) => item.active).length;
    const aiEnabled = aiRuntimes.filter((item) => item.enabled).length;
    const aiModelInstalled = aiRuntimes.some((item) => item.modelInstalled);
    const emailSettings = notificationDeliveryService.settings();
    const emailDeliveries = notificationDeliveryService.list(200);
    const emailPending = emailDeliveries.filter((item) => item.status === 'pending' || item.status === 'retrying' || item.status === 'sending').length;
    const emailFailed = emailDeliveries.filter((item) => item.status === 'failed').length;
    res.json({
      checkedAt: new Date().toISOString(),
      version: APP_VERSION,
      checks: [
        { id: 'backend', label: 'CCTV API', state: status.backend.state, detail: `Port ${status.backend.port}; uptime ${status.backend.uptimeSeconds}s` },
        { id: 'database', label: 'SQLite Registry', state: status.database.state, detail: `Schema v${status.database.schemaVersion ?? 0}` },
        { id: 'ffmpeg', label: 'FFmpeg', state: status.ffmpeg.state, detail: status.ffmpeg.path || 'Executable not found' },
        { id: 'mediamtx', label: 'MediaMTX Control API', state: status.mediamtx.state, detail: status.mediamtx.error || status.mediamtx.api || 'Control API unavailable' },
        { id: 'webrtc', label: 'WebRTC Listener', state: status.mediamtx.webrtcReachable ? 'healthy' : (status.mediamtx.ok ? 'unhealthy' : 'unknown'), detail: status.mediamtx.webrtc || 'Port 8889' },
        { id: 'hls', label: 'HLS Listener', state: status.mediamtx.hlsReachable ? 'healthy' : (status.mediamtx.ok ? 'unhealthy' : 'unknown'), detail: status.mediamtx.hls || 'Port 8888' },
        { id: 'storage', label: 'Data/Recording Volume', state: status.storage.state, detail: `${status.storage.volumeRoot} • ${status.storage.writable ? 'writable' : 'not writable'}` },
        { id: 'recording', label: 'Recording Service', state: status.recording.supported ? 'healthy' : 'not_supported', detail: `${status.recording.activeCount} active • ${status.recording.segmentCount} finalized segment(s)` },
        { id: 'motion', label: 'Motion Detection', state: motionActive > 0 ? 'healthy' : motionEnabled > 0 ? 'unknown' : 'not_configured', detail: `${motionActive} active • ${motionEnabled} enabled` },
        { id: 'ai', label: 'AI Person/Vehicle Detection', state: aiActive > 0 ? 'healthy' : aiEnabled > 0 ? (aiModelInstalled ? 'unknown' : 'unhealthy') : 'not_configured', detail: aiModelInstalled ? `${aiActive} active • ${aiEnabled} enabled • ${aiRuntimes.reduce((n,r)=>n+r.samplesPerMinute,0)} samples/min • local ONNX` : 'AI model is not installed' },
        { id: 'email', label: 'Queued Email Alerts', state: emailSettings.enabled ? (emailFailed > 0 ? 'unknown' : 'healthy') : 'not_configured', detail: emailSettings.enabled ? `${emailSettings.host}:${emailSettings.port} • ${emailPending} pending • ${emailFailed} failed` : 'SMTP delivery disabled' },
      ],
      status,
    });
  } catch (error) { sendError(res, error, 500); }
});

app.get('/api/v1/cameras/:id/diagnostics', auth.requirePermission('system:view'), async (req: AuthenticatedRequest, res) => {
  const camera = repo.get(req.params.id);
  if (!camera || !cameraAllowed(req, camera.id)) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  const runtime = (await cameraProcesses.allRuntimeWithMedia()).find((item) => item.cameraId === camera.id) || cameraProcesses.runtime(camera.id);
  const media = camera.stream?.path ? await mediaMtx.pathState(camera.stream.path) : { state: 'absent' as const, info: null };
  const recordingRuntime = recordingService.runtime(camera.id);
  const motionRuntime = motionService.runtime(camera.id);
  const aiRuntime = aiService.runtime(camera.id);
  res.json({
    checkedAt: new Date().toISOString(),
    camera: cameraForClient(req.cctvUser!, camera),
    runtime,
    recordingRuntime,
    motionRuntime,
    aiRuntime,
    checks: [
      { id: 'configuration', label: 'Camera Configuration', state: 'healthy', detail: `${camera.source_type || 'unknown'} source configured` },
      { id: 'worker', label: 'FFmpeg Worker', state: runtime.running ? 'healthy' : (camera.enabled ? 'unhealthy' : 'not_configured'), detail: runtime.running ? `PID ${runtime.pid ?? 'unknown'} • ${runtime.encoder || 'encoder pending'}` : (camera.enabled ? 'Expected worker is not running' : 'Camera disabled') },
      { id: 'media_path', label: 'MediaMTX Path', state: media.state === 'ready' ? 'healthy' : (camera.enabled ? 'unhealthy' : 'not_configured'), detail: camera.stream?.path ? `${camera.stream.path} • ${media.state}` : 'No stream path configured' },
      { id: 'stream', label: 'Video Stream', state: runtime.streamReady ? 'healthy' : (camera.enabled ? 'unhealthy' : 'not_configured'), detail: runtime.streamReady ? `Ready • ${runtime.mediaReaders} reader(s)` : `State ${runtime.state}${runtime.reason ? ` • ${runtime.reason}` : ''}` },
      { id: 'recording', label: 'Continuous Recording', state: recordingRuntime.active ? 'healthy' : recordingRuntime.desired ? 'unknown' : 'not_configured', detail: camera.source_type !== 'usb' ? 'P0.16.1 recording is currently qualified for USB cameras only' : recordingRuntime.active ? `Recorder PID ${recordingRuntime.pid ?? 'unknown'}` : recordingRuntime.desired ? (recordingRuntime.lastError || 'Armed; waiting for a ready live stream') : 'Disabled' },
      { id: 'motion', label: 'Motion Detection', state: motionRuntime.active ? 'healthy' : motionRuntime.enabled ? 'unknown' : 'not_configured', detail: camera.source_type !== 'usb' ? 'P0.16.1 motion detection is currently qualified for USB cameras only' : motionRuntime.active ? `Analyzer PID ${motionRuntime.pid ?? 'unknown'} • sensitivity ${motionRuntime.settings.sensitivity}%` : motionRuntime.enabled ? (motionRuntime.lastError || 'Armed; waiting for a ready live stream') : 'Disabled' },
      { id: 'ai', label: 'AI Person/Vehicle Detection', state: aiRuntime.active ? 'healthy' : aiRuntime.enabled ? (aiRuntime.modelInstalled ? 'unknown' : 'unhealthy') : 'not_configured', detail: camera.source_type !== 'usb' ? 'P0.16.1 AI detection is currently qualified for USB cameras only' : !aiRuntime.modelInstalled ? 'Tiny YOLOv3 ONNX model is not installed' : aiRuntime.paused ? `Paused until ${aiRuntime.pausedUntil}` : aiRuntime.backoffSeconds > 0 ? `Load backoff ${aiRuntime.backoffSeconds}s • ${aiRuntime.lastInferenceMs ?? '?'} ms last inference` : aiRuntime.waitingForMotion ? 'Motion-gated • waiting for recent motion' : aiRuntime.active ? `Inference active • ${aiRuntime.lastInferenceMs ?? '?'} ms • ${aiRuntime.samplesPerMinute}/min` : aiRuntime.enabled ? (aiRuntime.lastError || `Armed • ${aiRuntime.settings.performanceProfile}`) : 'Disabled' },
    ],
  });
});

app.get('/api/v1/events', auth.requirePermission('event:view'), (req, res) => {
  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 200;
  const categoryRaw = String(req.query.category || 'all');
  const severityRaw = String(req.query.severity || 'all');
  const category: OperationalEventCategory | 'all' = ['camera', 'system', 'storage'].includes(categoryRaw) ? categoryRaw as OperationalEventCategory : 'all';
  const severity: OperationalEventSeverity | 'all' = ['info', 'warning', 'critical'].includes(severityRaw) ? severityRaw as OperationalEventSeverity : 'all';
  const cameraId = req.query.cameraId ? String(req.query.cameraId) : null;
  const acknowledged = req.query.acknowledged === 'true' ? true : req.query.acknowledged === 'false' ? false : null;
  res.json(operationalEvents.list({ limit, category, severity, cameraId, acknowledged }));
});

app.post('/api/v1/events/:id/acknowledge', auth.requirePermission('event:view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return sendError(res, Object.assign(new Error('Invalid event id.'), { code: 'BAD_REQUEST' }), 400);
  const event = operationalEvents.acknowledge(id);
  if (!event) return sendError(res, Object.assign(new Error('Event not found.'), { code: 'NOT_FOUND' }), 404);
  audit(req, 'event.acknowledged', 'operational_event', String(id), { eventType: event.eventType });
  res.json(event);
});


// ---- Notification inbox + alert rules ----
app.get('/api/v1/notifications', auth.requirePermission('notification:view'), (req: AuthenticatedRequest, res) => {
  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 200;
  const unreadOnly = req.query.unread === 'true';
  res.json({ notifications: notificationService.list(limit, unreadOnly), unreadCount: notificationService.unreadCount() });
});

app.post('/api/v1/notifications/:id/read', auth.requirePermission('notification:view'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return sendError(res, Object.assign(new Error('Invalid notification id.'), { code: 'BAD_REQUEST' }), 400);
  const item = notificationService.markRead(id);
  if (!item) return sendError(res, Object.assign(new Error('Notification not found.'), { code: 'NOT_FOUND' }), 404);
  res.json(item);
});

app.post('/api/v1/notifications/read-all', auth.requirePermission('notification:view'), (req: AuthenticatedRequest, res) => {
  const count = notificationService.markAllRead();
  audit(req, 'notification.read_all', 'notification', null, { count });
  res.json({ updated: count });
});

app.get('/api/v1/notification-rules', auth.requirePermission('notification:manage'), (_req, res) => res.json(notificationService.rules()));

app.post('/api/v1/notification-rules', auth.requirePermission('notification:manage'), (req: AuthenticatedRequest, res) => {
  try {
    const cameraId = req.body?.cameraId ? String(req.body.cameraId) : null;
    if (cameraId && !repo.get(cameraId)) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
    const zoneId = req.body?.zoneId == null ? null : Number(req.body.zoneId);
    if (zoneId && (!cameraId || !motionRepo.getZone(cameraId, zoneId))) return sendError(res, Object.assign(new Error('Motion zone not found for selected camera.'), { code: 'NOT_FOUND' }), 404);
    const rule = notificationService.createRule({
      name: req.body?.name, enabled: req.body?.enabled === undefined ? true : Boolean(req.body.enabled), eventType: req.body?.eventType,
      minimumSeverity: req.body?.minimumSeverity, cameraId, zoneId, cooldownSeconds: req.body?.cooldownSeconds,
      desktopEnabled: req.body?.desktopEnabled === undefined ? true : Boolean(req.body.desktopEnabled),
      emailEnabled: req.body?.emailEnabled === undefined ? false : Boolean(req.body.emailEnabled),
    });
    audit(req, 'notification.rule_created', 'notification_rule', String(rule.id), { name: rule.name, eventType: rule.eventType, cameraId: rule.cameraId, zoneId: rule.zoneId });
    res.status(201).json(rule);
  } catch (error) { sendError(res, error, 400); }
});

app.patch('/api/v1/notification-rules/:id', auth.requirePermission('notification:manage'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return sendError(res, Object.assign(new Error('Invalid rule id.'), { code: 'BAD_REQUEST' }), 400);
  const cameraId = req.body?.cameraId === undefined ? undefined : req.body.cameraId ? String(req.body.cameraId) : null;
  if (cameraId && !repo.get(cameraId)) return sendError(res, Object.assign(new Error('Camera not found.'), { code: 'NOT_FOUND' }), 404);
  const zoneId = req.body?.zoneId === undefined ? undefined : req.body.zoneId == null ? null : Number(req.body.zoneId);
  const effectiveCamera = cameraId === undefined ? notificationService.rules().find((rule) => rule.id === id)?.cameraId || null : cameraId;
  if (zoneId && (!effectiveCamera || !motionRepo.getZone(effectiveCamera, zoneId))) return sendError(res, Object.assign(new Error('Motion zone not found for selected camera.'), { code: 'NOT_FOUND' }), 404);
  const rule = notificationService.updateRule(id, {
    name: req.body?.name, enabled: req.body?.enabled, eventType: req.body?.eventType, minimumSeverity: req.body?.minimumSeverity,
    cameraId, zoneId, cooldownSeconds: req.body?.cooldownSeconds, desktopEnabled: req.body?.desktopEnabled, emailEnabled: req.body?.emailEnabled,
  });
  if (!rule) return sendError(res, Object.assign(new Error('Notification rule not found.'), { code: 'NOT_FOUND' }), 404);
  audit(req, 'notification.rule_updated', 'notification_rule', String(id), { name: rule.name, enabled: rule.enabled, eventType: rule.eventType, cameraId: rule.cameraId, zoneId: rule.zoneId });
  res.json(rule);
});

app.delete('/api/v1/notification-rules/:id', auth.requirePermission('notification:manage'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return sendError(res, Object.assign(new Error('Invalid rule id.'), { code: 'BAD_REQUEST' }), 400);
  if (!notificationService.deleteRule(id)) return sendError(res, Object.assign(new Error('Notification rule not found.'), { code: 'NOT_FOUND' }), 404);
  audit(req, 'notification.rule_deleted', 'notification_rule', String(id));
  res.status(204).end();
});


// ---- External email delivery (queued and isolated from camera/runtime work) ----
app.get('/api/v1/notification-email/settings', auth.requirePermission('notification:manage'), (_req, res) => {
  res.json(notificationDeliveryService.settings());
});

app.put('/api/v1/notification-email/settings', auth.requirePermission('notification:manage'), (req: AuthenticatedRequest, res) => {
  try {
    const settings = notificationDeliveryService.saveSettings({
      enabled: req.body?.enabled,
      host: req.body?.host,
      port: req.body?.port,
      secureMode: req.body?.secureMode,
      username: req.body?.username,
      password: req.body?.password,
      clearPassword: Boolean(req.body?.clearPassword),
      fromAddress: req.body?.fromAddress,
      recipients: req.body?.recipients,
      baseUrl: req.body?.baseUrl,
    });
    audit(req, 'notification.smtp_updated', 'notification_email_settings', '1', {
      enabled: settings.enabled, host: settings.host, port: settings.port, secureMode: settings.secureMode,
      usernameConfigured: Boolean(settings.username), passwordConfigured: settings.passwordConfigured,
      fromConfigured: Boolean(settings.fromAddress), recipientCount: settings.recipients.length, baseUrlConfigured: Boolean(settings.baseUrl),
    });
    res.json(settings);
  } catch (error) { sendError(res, error, 400); }
});

app.post('/api/v1/notification-email/test', auth.requirePermission('notification:manage'), async (req: AuthenticatedRequest, res) => {
  try {
    await notificationDeliveryService.sendTest();
    audit(req, 'notification.smtp_test_sent', 'notification_email_settings', '1');
    res.json({ ok: true });
  } catch (error: any) {
    audit(req, 'notification.smtp_test_failed', 'notification_email_settings', '1', { error: error?.message || String(error) });
    sendError(res, Object.assign(error instanceof Error ? error : new Error(String(error)), { code: 'SMTP_TEST_FAILED' }), 422);
  }
});

app.get('/api/v1/notification-deliveries', auth.requirePermission('notification:manage'), (req, res) => {
  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 200;
  res.json(notificationDeliveryService.list(limit));
});

app.post('/api/v1/notification-deliveries/:id/retry', auth.requirePermission('notification:manage'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return sendError(res, Object.assign(new Error('Invalid delivery id.'), { code: 'BAD_REQUEST' }), 400);
  const delivery = notificationDeliveryService.retry(id);
  if (!delivery) return sendError(res, Object.assign(new Error('Delivery not found.'), { code: 'NOT_FOUND' }), 404);
  audit(req, 'notification.delivery_retried', 'notification_delivery', String(id));
  res.json(delivery);
});

app.get('/api/v1/audit', auth.requirePermission('audit:view'), (req, res) => {
  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(500, Math.floor(requested))) : 200;
  res.json(auditRepo.list({
    limit,
    actionPrefix: req.query.actionPrefix ? String(req.query.actionPrefix).slice(0, 64) : undefined,
    resourceType: req.query.resourceType ? String(req.query.resourceType).slice(0, 64) : undefined,
    username: req.query.username ? String(req.query.username).slice(0, 64) : undefined,
    query: req.query.q ? String(req.query.q).slice(0, 200) : undefined,
  }));
});

app.get('/api/v1/system/support-bundle', auth.requirePermission('system:view'), async (_req, res) => {
  try {
    const remote = await getRemoteAccessStatus();
    const media = await mediaMtx.health();
    const snapshot = {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      remote: { connected: remote.connected, backendState: remote.backendState, dnsName: remote.dnsName, tailscaleIps: remote.tailscaleIps, serveConfigured: remote.serveConfigured, serveUrl: remote.serveUrl },
      media: { ok: media.ok, runtime: mediaMtx.runtimeInfo() },
      cameras: cameraProcesses.allRuntime().map((item) => ({ ...item, last_error: repo.get(item.cameraId)?.last_error || null })),
      database: { engine: 'node:sqlite', path: dbPath },
    };
    const bundle = createStoreZip([
      { name: 'support.json', data: JSON.stringify(snapshot, null, 2) },
      { name: 'environment-redacted.txt', data: redactedEnvSnapshot() },
      { name: 'logs/server.log', data: tailLog('server') },
      { name: 'logs/camera-manager.log', data: tailLog('camera-manager') },
      { name: 'logs/ffmpeg.log', data: tailLog('ffmpeg') },
      { name: 'logs/mediamtx.log', data: tailLog('mediamtx') },
      { name: 'logs/recovery.log', data: tailLog('recovery') },
      { name: 'audit/recent.json', data: JSON.stringify(auditRepo.list(500), null, 2) },
      { name: 'events/recent.json', data: JSON.stringify(operationalEvents.list({ limit: 500 }), null, 2) },
    ]);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    audit(_req, 'support_bundle.downloaded', 'system');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="CCTV-Support-${stamp}.zip"`);
    res.send(bundle);
  } catch (error: any) {
    sendError(res, Object.assign(new Error(error?.message || 'Could not create support bundle.'), { code: 'SUPPORT_BUNDLE_FAILED' }), 500);
  }
});

// ---- AI assistant: authenticated because it can reveal operational state and consume provider quota. ----
app.post('/api/chat', auth.requireAuth, auth.requirePermission('ai:use'), async (req: AuthenticatedRequest, res) => {
  try {
    const { messages, model = 'gemini-3.5-flash' } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in environment' });
    const cameras = repo.list().filter((camera) => Boolean(req.cctvUser && auth.canAccessCamera(req.cctvUser, camera.id)));
    const media = await mediaMtx.health();
    const systemInstruction = [
      'You are the AI Security Officer and NVR Dispatcher for CCTV Monitor.',
      'Never invent camera, stream, recording, storage, or service status. Use only the live state supplied below.',
      `Camera registry: ${JSON.stringify(cameras.map(c => ({ id: c.id, name: c.name, status: c.status, enabled: c.enabled, recording: c.recording, ...(req.cctvUser?.role === 'Admin' ? { last_error: c.last_error } : {}) })))}`,
      `MediaMTX healthy: ${media.ok}.`,
      'If information is not in this state, say it is unavailable rather than guessing.',
    ].join('\n');
    const ai = new GoogleGenAI({ apiKey });
    const contents = (Array.isArray(messages) ? messages : []).slice(-30).map((m: { role: string; text: string }) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.text || '').slice(0, 8000) }] }));
    const response = await ai.models.generateContent({ model, contents, config: { systemInstruction, temperature: 0.4 } });
    res.json({ text: response.text || 'No response generated.', modelUsed: model });
  } catch (error: any) {
    console.error('Chat API Error:', error);
    res.status(500).json({ error: error.message || 'Error communicating with Gemini model' });
  }
});

// ---- Gemini Live voice: authenticated WebSocket and safe dual-sided close. ----
const wss = new WebSocketServer({ server, path: '/api/live' });
wss.on('connection', async (clientWs: WebSocket, request) => {
  const webUser = auth.sessionFromCookieHeader(request.headers.cookie);
  if (!webUser || !auth.hasPermission(webUser, 'ai:use')) { clientWs.close(1008, 'Authentication required'); return; }
  let session: any = null;
  let closed = false;
  const safeSend = (payload: unknown) => { if (!closed && clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload)); };
  const closeUpstream = () => { if (closed) return; closed = true; try { session?.close?.(); } catch {} session = null; };
  clientWs.once('close', closeUpstream);
  clientWs.once('error', closeUpstream);
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) { safeSend({ error: 'GEMINI_API_KEY is not configured in server environment' }); return; }
    const ai = new GoogleGenAI({ apiKey });
    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }, systemInstruction: 'You are the voice intercom assistant for CCTV Monitor. Do not invent operational state; keep spoken responses concise.' },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          const text = message.serverContent?.modelTurn?.parts?.[0]?.text;
          if (audio || text) safeSend({ audio, text });
          if (message.serverContent?.interrupted) safeSend({ interrupted: true });
        },
        onclose: () => safeSend({ status: 'live_session_closed' }),
      },
    });
    if (closed) { try { session?.close?.(); } catch {} return; }
    safeSend({ status: 'connected', model: 'gemini-3.8-live' });
    clientWs.on('message', (data) => {
      if (!session || closed) return;
      try {
        const payload = JSON.parse(data.toString());
        if (payload.audio) session.sendRealtimeInput({ audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' } });
        else if (payload.text) session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: String(payload.text).slice(0, 8000) }] }], turnComplete: true });
      } catch (error) { console.error('Live message error:', error); }
    });
  } catch (error: any) { safeSend({ error: error.message || 'Failed to start Live API session' }); closeUpstream(); }
});

async function installFrontend() {
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(appRoot, 'dist');
    const indexPath = path.join(distDir, 'index.html');
    try { await fs.access(indexPath); } catch { throw new Error(`Production frontend is not built: ${indexPath}. Run npm run build before starting with NODE_ENV=production.`); }
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(indexPath));
    return;
  }
  const { createServer: createViteServer } = await import('vite');
  // Vite permits localhost and IP literals by default, but rejects arbitrary
  // hostnames with HTTP 403. Allow only hostnames that belong to this CCTV
  // server: its Windows hostname and its exact Tailscale MagicDNS name.
  // Do not use allowedHosts: true; that would weaken Vite's DNS-rebinding
  // protection.
  const remote = await getRemoteAccessStatus();
  const allowedHosts = [...new Set([os.hostname(), remote.dnsName].filter((value): value is string => Boolean(value)))];
  const vite = await createViteServer({ server: { middlewareMode: true, allowedHosts }, appType: 'custom' });
  app.use(vite.middlewares);
  app.get('*', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/internal/') || req.path.startsWith('/usb/') || req.path.startsWith('/cameras/')) return next();
    try {
      const templatePath = path.resolve(appRoot, 'index.html');
      const template = await fs.readFile(templatePath, 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).type('html').send(html);
    } catch (error) { vite.ssrFixStacktrace(error as Error); next(error); }
  });
}

let supervisorBusy = false;
let supervisorTimer: NodeJS.Timeout | null = null;

async function runSupervisorCycle() {
  if (supervisorBusy || shuttingDown) return;
  supervisorBusy = true;
  try {
    const mediaBeforeRecovery = await mediaMtx.health();
    if (!mediaBeforeRecovery.ok) operationalEvents.observeMediaHealth(false, mediaBeforeRecovery.error || null);
    const mediaHealthy = mediaBeforeRecovery.ok ? true : await mediaMtx.recoverIfNeeded();
    if (mediaHealthy) operationalEvents.observeMediaHealth(true);
    operationalEvents.observeStorage(await storageService.status());
    if (mediaHealthy) {
      await cameraProcesses.superviseEnabled();
      await recordingService.supervise();
    }
  } catch (error: any) {
    logLine('recovery', 'ERROR', `Supervisor cycle failed: ${error?.message || String(error)}`);
  } finally {
    supervisorBusy = false;
  }
}

async function startServer() {
  cameraProcesses.prepareForStartup();
  await installFrontend();
  server.listen(PORT, '0.0.0.0', async () => {
    operationalEvents.systemStarted(APP_VERSION);
    console.log('');
    console.log('CCTV Monitor is running.');
    console.log(`Mode:    ${process.env.NODE_ENV === 'production' ? 'production' : 'development'}`);
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Loopback:http://127.0.0.1:${PORT}`);
    const interfaces = os.networkInterfaces();
    const lanUrls: string[] = [];
    for (const entries of Object.values(interfaces)) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) lanUrls.push(`http://${entry.address}:${PORT}`);
    for (const url of [...new Set(lanUrls)]) console.log(`LAN/VPN: ${url}`);
    console.log(`Bind:    0.0.0.0:${PORT} (server listen address only; do not open this in a browser)`);
    if (auth.setupRequired()) console.log(`[SETUP] Create the first administrator from http://localhost:${PORT} on this CCTV PC.`);
    console.log('');

    try {
      await mediaMtx.ensureStarted();
      const media = mediaMtx.runtimeInfo();
      console.log(`[OK] MediaMTX ready: API ${mediaMtx.apiBase} | RTSP ${mediaMtx.rtspBase} | WebRTC :8889 | HLS :8888 | ICE UDP :8189${media.startedByApp ? ' | managed by CCTV Monitor' : ' | external instance reused'}`);
      console.log('[OK] Media reads require CCTV-issued short-lived tokens.');
      operationalEvents.observeMediaHealth(true);
    } catch (error: any) {
      console.warn(`[WARN] MediaMTX unavailable: ${error?.message || String(error)}`);
      console.warn('       The UI will remain available, but real camera streaming cannot start until MediaMTX is installed/running.');
      operationalEvents.observeMediaHealth(false, error?.message || String(error));
    }

    const remote = await getRemoteAccessStatus();
    if (remote.connected) console.log(`[OK] Tailscale detected: ${remote.dnsName || remote.tailscaleIps.join(', ')}`);
    else console.log('[INFO] Tailscale is not connected. LAN viewing still works; install/connect Tailscale for private remote viewing.');
    const ffmpeg = await findFfmpegPath();
    if (ffmpeg) console.log(`[OK] FFmpeg: ${ffmpeg}`);
    else console.warn('[WARN] FFmpeg was not found. USB camera discovery and streaming are unavailable until FFMPEG_PATH is configured or ffmpeg is added to PATH.');
    console.log('');
    operationalEvents.observeStorage(await storageService.status());
    await cameraProcesses.startEnabled();
    await recordingService.startSupervisor();
    console.log('[OK] Continuous recording service ready (USB MVP; finalized MP4 segments indexed in SQLite).');
    await motionService.startSupervisor();
    console.log('[OK] Motion detection service ready (USB scene-change analyzer; cooldown + event links active).');
    await aiService.startSupervisor();
    console.log(`[OK] AI detector supervisor ready (P0.16.1 local ONNX; model ${aiService.runtimesSnapshot().some((r) => r.modelInstalled) ? 'installed' : 'not installed'}; detection disabled by default).`);
    notificationDeliveryService.start();
    console.log('[OK] External notification delivery worker ready (queued SMTP email; non-blocking retries).');
    supervisorTimer = setInterval(() => void runSupervisorCycle(), 15000);
    supervisorTimer.unref?.();
    console.log('[OK] Reliability supervisor active (15 s health/recovery cycle).');
  });
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (supervisorTimer) { clearInterval(supervisorTimer); supervisorTimer = null; }
  console.log(`\n${signal}: stopping camera workers and owned services...`);
  try { await aiService.stopAll(); } catch (e) { console.error(e); }
  try { await motionService.stopAll(); } catch (e) { console.error(e); }
  try { await recordingService.stopAll(); } catch (e) { console.error(e); }
  try { await cameraProcesses.stopAll(); } catch (e) { console.error(e); }
  try { await mediaMtx.stop(); } catch (e) { console.error(e); }
  try { repo.close(); } catch {}
  try { authRepo.close(); } catch {}
  try { sessionRepo.close(); } catch {}
  try { auditRepo.close(); } catch {}
  try { operationalEvents.close(); } catch {}
  try { notificationDeliveryService.close(); } catch {}
  try { notificationService.close(); } catch {}
  try { aiRepo.close(); } catch {}
  try { motionRepo.close(); } catch {}
  try { recordingRepo.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  try { repo.close(); } catch {}
  try { authRepo.close(); } catch {}
  try { sessionRepo.close(); } catch {}
  try { auditRepo.close(); } catch {}
  try { operationalEvents.close(); } catch {}
  try { notificationDeliveryService.close(); } catch {}
  try { notificationService.close(); } catch {}
  try { aiRepo.close(); } catch {}
  try { motionRepo.close(); } catch {}
  try { recordingRepo.close(); } catch {}
  process.exit(1);
});
