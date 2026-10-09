import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AuthRepository, type CameraAccess, type PublicUser, type StoredUser, type UserRole } from '../repositories/AuthRepository';
import { SessionRepository, type PublicSession, type StoredSession } from '../repositories/SessionRepository';
import { hasPermission as roleHasPermission, type Permission } from '../../security/permissions';

const SESSION_COOKIE = 'cctv_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MEDIA_TOKEN_TTL_SECONDS = 5 * 60;

export interface AuthenticatedRequest extends Request {
  cctvUser?: PublicUser;
  cctvSessionId?: string;
}

function b64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : input).toString('base64url');
}

function parseCookies(header = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

export function isLoopbackAddress(ip?: string | null): boolean {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

export function clientAddress(req: Request): string {
  const direct = String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  // Only trust forwarding metadata from a loopback reverse proxy such as
  // Tailscale Serve. Never trust X-Forwarded-For from an arbitrary client.
  if (isLoopbackAddress(direct)) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (forwarded) return forwarded;
  }
  return direct;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private mediaSecret = process.env.CCTV_MEDIA_TOKEN_SECRET || crypto.randomBytes(32).toString('base64url');

  constructor(private repo: AuthRepository, private sessions: SessionRepository) {}

  setupRequired(): boolean { return this.repo.count() === 0; }

  hashPassword(password: string): string {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const [kind, saltB64, hashB64] = stored.split('$');
    if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
    try {
      const expected = Buffer.from(hashB64, 'base64url');
      const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length);
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch { return false; }
  }

  validatePassword(password: string): string | null {
    if (!password.trim()) return 'Password cannot be blank.';
    if (password.length < 5) return 'Password must contain at least 5 characters.';
    if (password.length > 8) return 'Password must contain at most 8 characters.';
    return null;
  }

  createUser(input: { username: string; password: string; role: UserRole; cameraAccess?: CameraAccess; recordingAccess?: CameraAccess; aiEnabled?: boolean }): PublicUser {
    const username = input.username.trim();
    if (!/^[A-Za-z0-9._-]{3,48}$/.test(username)) throw Object.assign(new Error('Username must be 3–48 characters using letters, numbers, dot, underscore, or hyphen.'), { code: 'INVALID_USERNAME' });
    const passwordError = this.validatePassword(input.password);
    if (passwordError) throw Object.assign(new Error(passwordError), { code: 'INVALID_PASSWORD' });
    if (this.repo.getByUsername(username)) throw Object.assign(new Error('Username already exists.'), { code: 'USERNAME_EXISTS' });
    return this.repo.create({
      id: `usr-${crypto.randomUUID()}`,
      username,
      password_hash: this.hashPassword(input.password),
      role: input.role,
      cameraAccess: input.role === 'Admin' ? 'all' : (input.cameraAccess ?? []),
      recordingAccess: input.role === 'Admin' ? 'all' : (input.recordingAccess ?? []),
      aiEnabled: input.aiEnabled ?? (input.role === 'Admin'),
    });
  }

  authenticate(username: string, password: string): PublicUser | null {
    const stored = this.repo.getByUsername(username);
    if (!stored || stored.status !== 'Active' || !this.verifyPassword(password, stored.password_hash)) return null;
    this.repo.touchLogin(stored.id);
    return this.repo.toPublic(this.repo.get(stored.id)!);
  }

  createSession(user: PublicUser, res: Response, req?: Request): PublicSession {
    this.sessions.prune();
    const token = crypto.randomBytes(32).toString('base64url');
    const row = this.sessions.create({
      id: `ses-${crypto.randomUUID()}`,
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      remoteAddress: req ? clientAddress(req) : null,
      userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 500) || null : null,
    });
    res.setHeader('Set-Cookie', this.cookieHeader(token, req));
    return this.publicSession(row, true);
  }

  clearSession(req: Request, res: Response): PublicSession | null {
    const token = this.sessionToken(req);
    let revoked: StoredSession | null = null;
    if (token) revoked = this.sessions.revokeByTokenHash(token);
    res.setHeader('Set-Cookie', this.cookieHeader('', req, 0));
    return revoked ? this.publicSession(revoked, true) : null;
  }

  revokeUserSessions(userId: string, exceptSessionId?: string | null): number {
    return this.sessions.revokeUser(userId, exceptSessionId);
  }

  revokeSession(sessionId: string, actingUser: PublicUser): boolean {
    const row = this.sessions.getById(sessionId);
    if (!row) return false;
    if (actingUser.role !== 'Admin' && row.user_id !== actingUser.id) return false;
    return this.sessions.revokeById(sessionId);
  }

  listSessionsForUser(userId: string, currentSessionId?: string | null): PublicSession[] {
    return this.sessions.listActive(userId).map((row) => this.publicSession(row, row.id === currentSessionId));
  }

  listAllSessions(currentSessionId?: string | null): Array<PublicSession & { username: string | null }> {
    return this.sessions.listActive().map((row) => ({
      ...this.publicSession(row, row.id === currentSessionId),
      username: this.repo.get(row.user_id)?.username || null,
    }));
  }

  currentSession(req: Request): PublicSession | null {
    const resolved = this.resolveRequest(req, false);
    return resolved ? this.publicSession(resolved.session, true) : null;
  }

  userFromRequest(req: Request): PublicUser | null {
    return this.resolveRequest(req)?.user || null;
  }

  requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const resolved = this.resolveRequest(req);
    if (!resolved) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
    req.cctvUser = resolved.user;
    req.cctvSessionId = resolved.session.id;
    next();
  };

  requireRole = (...roles: UserRole[]) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.cctvUser || this.userFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
    if (!roles.includes(user.role)) return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'Your role does not allow this action.' });
    req.cctvUser = user;
    next();
  };

  hasPermission(user: PublicUser, permission: Permission): boolean {
    if (!roleHasPermission(user.role, permission)) return false;
    if (permission === 'ai:use') return Boolean(user.aiEnabled);
    return true;
  }

  requirePermission = (...permissions: Permission[]) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.cctvUser || this.userFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
    if (!permissions.every((permission) => this.hasPermission(user, permission))) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'Your account does not have permission for this action.' });
    }
    req.cctvUser = user;
    next();
  };

  canAccessCamera(user: PublicUser, cameraId: string): boolean {
    if (user.role === 'Admin' || user.cameraAccess === 'all') return true;
    return Array.isArray(user.cameraAccess) && user.cameraAccess.includes(cameraId);
  }

  canAccessRecording(user: PublicUser, cameraId: string): boolean {
    if (user.role === 'Admin' || user.recordingAccess === 'all') return true;
    return Array.isArray(user.recordingAccess) && user.recordingAccess.includes(cameraId);
  }

  issueMediaToken(user: PublicUser, path: string, ttlSeconds = MEDIA_TOKEN_TTL_SECONDS, sessionId: string | null = null): { token: string; expiresAt: string } {
    const exp = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(900, ttlSeconds));
    const payload = b64url(JSON.stringify({ v: 2, sub: user.id, sid: sessionId, sv: user.security_version, path, action: 'read', exp, jti: crypto.randomUUID() }));
    const signature = crypto.createHmac('sha256', this.mediaSecret).update(payload).digest('base64url');
    return { token: `${payload}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  mediaTokenUser(token: string, path: string, action = 'read'): PublicUser | null {
    if (!token || action !== 'read') return null;
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;
    const expected = crypto.createHmac('sha256', this.mediaSecret).update(payloadB64).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      if (Number(payload?.v) !== 2 || payload?.action !== 'read' || payload?.path !== path || Number(payload?.exp || 0) < Math.floor(Date.now() / 1000)) return null;
      const stored = this.repo.get(String(payload?.sub || ''));
      if (!stored || stored.status !== 'Active') return null;
      if (!payload?.sid || !this.sessions.isActive(String(payload.sid), stored.id)) return null;
      // v2 binds every media token to the user's current security epoch.
      // Password, role, camera-access, AI-access and administrator session-revoke
      // actions advance this value so older tokens stop authorizing new reads.
      if (Number(payload?.sv || 0) !== stored.security_version) return null;
      return this.repo.toPublic(stored);
    } catch { return null; }
  }

  verifyMediaToken(token: string, path: string, action = 'read'): boolean {
    return Boolean(this.mediaTokenUser(token, path, action));
  }

  sessionFromCookieHeader(cookieHeader?: string): PublicUser | null {
    const cookies = parseCookies(cookieHeader || '');
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = this.sessions.getActiveByTokenHash(tokenHash(token));
    if (!session) return null;
    const stored = this.repo.get(session.user_id);
    return stored && stored.status === 'Active' ? this.repo.toPublic(stored) : null;
  }

  private resolveRequest(req: Request, touch = true): { user: PublicUser; session: StoredSession } | null {
    const token = this.sessionToken(req);
    if (!token) return null;
    const session = this.sessions.getActiveByTokenHash(tokenHash(token));
    if (!session) return null;
    const stored = this.repo.get(session.user_id);
    if (!stored || stored.status !== 'Active') {
      this.sessions.revokeById(session.id);
      return null;
    }
    if (touch) this.sessions.touch(session.id);
    return { user: this.repo.toPublic(stored), session };
  }

  private sessionToken(req: Request): string | null {
    return parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || null;
  }

  private cookieHeader(token: string, req?: Request, maxAge = Math.floor(SESSION_TTL_MS / 1000)): string {
    const forwardedProto = req && isLoopbackAddress(req.socket.remoteAddress)
      ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
      : '';
    const secure = process.env.CCTV_COOKIE_SECURE === 'true' || req?.protocol === 'https' || forwardedProto === 'https';
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  private publicSession(row: StoredSession, current = false): PublicSession {
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      remoteAddress: row.remote_address,
      userAgent: row.user_agent,
      current,
    };
  }
}
