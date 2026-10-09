import type {
  AlertNotification,
  AuditEntry,
  AuthStatus,
  AuthUser,
  Camera,
  CameraAccess,
  CCTVEvent,
  MediaStreamToken,
  NotificationRule,
  NotificationEmailSettings,
  NotificationDelivery,
  RecordingSegment,
  RecordingRuntime,
  RecordingSummary,
  RecordingRetentionPolicy,
  RecordingHealth,
  RecordingQuarantineItem,
  RecordingRetentionRunResult,
  RtspProbe,
  SystemStatus,
  StreamRuntimeConfig,
  SessionInfo,
  UsbDevice,
  UsbEncoder,
  UsbFormat,
  UsbProbe,
  UserRole,
} from './types/cctv';
export type { UsbDevice, UsbEncoder, UsbFormat, UsbProbe };

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: string;
  stage?: 'capture' | 'stream';

  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
    this.stage = body?.stage;
  }
}

export interface MappedUsbDevice {
  device_id: string;
  name: string;
  raw_name: string;
  alternative_name: string | null;
  is_persistent: boolean;
  capture_moniker: string;
  vendor: string;
  vid: string | null;
  pid: string | null;
  guid: string | null;
  is_video: boolean;
}

export function mapDirectShowDevice(dev: Partial<UsbDevice>): MappedUsbDevice {
  const rawName = dev.name || 'DirectShow Video Device';
  const cleanName = rawName.trim().replace(/^["']|["']$/g, '').replace(/\s*\(video\)\s*$/i, '').replace(/^video=\s*/i, '');
  let altName = dev.alternative_name || null;
  if (!altName && dev.device_id?.startsWith('@device_pnp_')) altName = dev.device_id;
  const primaryId = altName || dev.device_id || cleanName;
  const vid = altName?.match(/vid_([0-9a-fA-F]{4})/i)?.[1]?.toUpperCase() || null;
  const pid = altName?.match(/pid_([0-9a-fA-F]{4})/i)?.[1]?.toUpperCase() || null;
  const guidValue = altName?.match(/\{([0-9a-fA-F-]{36})\}/i)?.[1];
  const guid = guidValue ? `{${guidValue}}` : null;
  let vendor = 'DirectShow Device';
  if (vid === '413C') vendor = 'Dell';
  else if (vid === '046D') vendor = 'Logitech';
  else if (vid === '04F2') vendor = 'Chicony / Integrated UVC';
  else if (vid === '0FD9') vendor = 'Elgato';
  else if (cleanName.toLowerCase().includes('integrated')) vendor = 'Integrated OEM';
  return { device_id: primaryId, name: cleanName || 'DirectShow Video Device', raw_name: rawName, alternative_name: altName, is_persistent: Boolean(altName?.includes('usb#vid_')), capture_moniker: primaryId.startsWith('video=') ? primaryId : `video=${primaryId}`, vendor, vid, pid, guid, is_video: dev.is_video ?? true };
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path.startsWith('/') ? path : `/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const raw = await res.text();
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    const message = parsed?.message || parsed?.error || raw || `Request failed: ${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Authentication and users
export async function getAuthStatus() { return api<AuthStatus>('/api/v1/auth/status'); }
export async function setupAdmin(username: string, password: string) { return api<{ user: AuthUser }>('/api/v1/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }); }
export async function login(username: string, password: string) { return api<{ user: AuthUser }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); }
export async function logout() { return api<void>('/api/v1/auth/logout', { method: 'POST' }); }
export async function getMe() { return api<{ user: AuthUser }>('/api/v1/auth/me'); }
export async function changeMyPassword(currentPassword: string, newPassword: string) { return api<{ user: AuthUser }>('/api/v1/auth/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }); }
export async function getUsers() { return api<AuthUser[]>('/api/v1/users'); }
export async function createUser(payload: { username: string; password: string; role: UserRole; cameraAccess?: CameraAccess; recordingAccess?: CameraAccess; aiEnabled?: boolean }) { return api<AuthUser>('/api/v1/users', { method: 'POST', body: JSON.stringify(payload) }); }
export async function updateUser(id: string, payload: Partial<{ username: string; password: string; role: UserRole; status: 'Active' | 'Inactive'; cameraAccess: CameraAccess; recordingAccess: CameraAccess; aiEnabled: boolean }>) { return api<AuthUser>(`/api/v1/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function deleteUser(id: string) { return api<void>(`/api/v1/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function getAuditLog(options: number | { limit?: number; actionPrefix?: string; resourceType?: string; username?: string; query?: string } = 200) {
  const opts = typeof options === 'number' ? { limit: options } : options;
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 200));
  if (opts.actionPrefix) params.set('actionPrefix', opts.actionPrefix);
  if (opts.resourceType) params.set('resourceType', opts.resourceType);
  if (opts.username) params.set('username', opts.username);
  if (opts.query) params.set('q', opts.query);
  return api<AuditEntry[]>(`/api/v1/audit?${params.toString()}`);
}
export async function getMySessions() { return api<SessionInfo[]>('/api/v1/auth/sessions'); }
export async function revokeMySession(id: string) { return api<{ revoked: boolean; current: boolean }>(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function revokeOtherSessions() { return api<{ revoked: number }>('/api/v1/auth/sessions/revoke-others', { method: 'POST' }); }
export async function getAllSessions() { return api<SessionInfo[]>('/api/v1/sessions'); }
export async function revokeAdminSession(id: string) { return api<void>(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function revokeAllUserSessions(id: string) { return api<{ revoked: number }>(`/api/v1/users/${encodeURIComponent(id)}/sessions/revoke-all`, { method: 'POST' }); }
export async function getOperationalEvents(options: { limit?: number; category?: 'all' | 'camera' | 'system' | 'storage'; severity?: 'all' | 'info' | 'warning' | 'critical'; cameraId?: string; acknowledged?: boolean } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 200));
  if (options.category && options.category !== 'all') params.set('category', options.category);
  if (options.severity && options.severity !== 'all') params.set('severity', options.severity);
  if (options.cameraId) params.set('cameraId', options.cameraId);
  if (options.acknowledged !== undefined) params.set('acknowledged', String(options.acknowledged));
  return api<CCTVEvent[]>(`/api/v1/events?${params.toString()}`);
}
export async function acknowledgeOperationalEvent(id: string) { return api<CCTVEvent>(`/api/v1/events/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' }); }


export async function getNotifications(options: { limit?: number; unreadOnly?: boolean } = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 200) });
  if (options.unreadOnly) params.set('unread', 'true');
  return api<{ notifications: AlertNotification[]; unreadCount: number }>(`/api/v1/notifications?${params.toString()}`);
}
export async function markNotificationRead(id: number) { return api<AlertNotification>(`/api/v1/notifications/${encodeURIComponent(String(id))}/read`, { method: 'POST' }); }
export async function markAllNotificationsRead() { return api<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST' }); }
export async function getNotificationRules() { return api<NotificationRule[]>('/api/v1/notification-rules'); }
export async function createNotificationRule(payload: Partial<Omit<NotificationRule, 'id' | 'updatedAt'>>) { return api<NotificationRule>('/api/v1/notification-rules', { method: 'POST', body: JSON.stringify(payload) }); }
export async function updateNotificationRule(id: number, payload: Partial<Omit<NotificationRule, 'id' | 'updatedAt'>>) { return api<NotificationRule>(`/api/v1/notification-rules/${encodeURIComponent(String(id))}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function deleteNotificationRule(id: number) { return api<void>(`/api/v1/notification-rules/${encodeURIComponent(String(id))}`, { method: 'DELETE' }); }

export async function getNotificationEmailSettings() { return api<NotificationEmailSettings>('/api/v1/notification-email/settings'); }
export async function updateNotificationEmailSettings(payload: Partial<NotificationEmailSettings> & { password?: string; clearPassword?: boolean; recipients?: string[] }) {
  return api<NotificationEmailSettings>('/api/v1/notification-email/settings', { method: 'PUT', body: JSON.stringify(payload) });
}
export async function testNotificationEmail() { return api<{ ok: boolean }>('/api/v1/notification-email/test', { method: 'POST' }); }
export async function getNotificationDeliveries(limit = 200) { return api<NotificationDelivery[]>(`/api/v1/notification-deliveries?limit=${encodeURIComponent(String(limit))}`); }
export async function retryNotificationDelivery(id: number) { return api<NotificationDelivery>(`/api/v1/notification-deliveries/${encodeURIComponent(String(id))}/retry`, { method: 'POST' }); }

// Cameras and media
export async function getCameras() { return api<Camera[]>('/api/v1/cameras'); }
export async function startCamera(id: string) { return api<Camera>(`/api/v1/cameras/${encodeURIComponent(id)}/start`, { method: 'POST' }); }
export async function stopCamera(id: string) { return api<Camera>(`/api/v1/cameras/${encodeURIComponent(id)}/stop`, { method: 'POST' }); }
export async function restartCamera(id: string) { return api<Camera>(`/api/v1/cameras/${encodeURIComponent(id)}/restart`, { method: 'POST' }); }
export async function deleteCamera(id: string) { return api<void>(`/api/v1/cameras/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function updateCamera(id: string, payload: Partial<Pick<Camera, 'name' | 'location'>>) { return api<Camera>(`/api/v1/cameras/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function getStreamRuntimeConfig() { return api<StreamRuntimeConfig>('/api/v1/runtime/stream-config'); }
export async function getStreamToken(id: string) { return api<MediaStreamToken>(`/api/v1/cameras/${encodeURIComponent(id)}/stream-token`, { method: 'POST' }); }

export async function getUsbDevices() { return (await api<UsbDevice[]>('/api/v1/usb/devices')).map(mapDirectShowDevice); }
export async function getUsbFormats(deviceId: string) { return api<UsbFormat[]>(`/api/v1/usb/formats?device_id=${encodeURIComponent(deviceId)}`); }
export async function getUsbEncoders() { return api<UsbEncoder[]>('/api/v1/usb/encoders'); }
export async function probeUsbDevice(params: { device_id: string; width?: number; height?: number; fps?: number; pixel_format?: string | null; }) {
  const res = await fetch('/api/v1/usb/probe', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const raw = await res.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  if (body && typeof body.ok === 'boolean' && (res.ok || res.status === 422)) return body as UsbProbe;
  if (!res.ok) throw new ApiError(body?.message || raw || `USB probe failed: HTTP ${res.status}`, res.status, body);
  return body as UsbProbe;
}
export async function registerUsbCamera(payload: Record<string, unknown>) {
  return api<Camera & { warning?: string }>('/api/v1/cameras/usb', { method: 'POST', body: JSON.stringify(payload) });
}

export async function testRtspCamera(payload: Record<string, unknown>) {
  const res = await fetch('/api/v1/cameras/rtsp/test', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const raw = await res.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  if (body && typeof body.ok === 'boolean' && (res.ok || res.status === 422)) return body as RtspProbe;
  if (!res.ok) throw new ApiError(body?.message || raw || `RTSP test failed: HTTP ${res.status}`, res.status, body);
  return body as RtspProbe;
}

export async function registerRtspCamera(payload: Record<string, unknown>) {
  return api<Camera>('/api/v1/cameras/rtsp', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getSystemStatus() { return api<SystemStatus>('/api/v1/system/status'); }
export async function getSystemDiagnostics() { return api<any>('/api/v1/system/diagnostics'); }
export async function getCameraDiagnostics(id: string) { return api<any>(`/api/v1/cameras/${encodeURIComponent(id)}/diagnostics`); }

export async function downloadSupportBundle() {
  const res = await fetch('/api/v1/system/support-bundle', { credentials: 'same-origin' });
  if (!res.ok) {
    const raw = await res.text();
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    throw new ApiError(parsed?.message || raw || `Support bundle failed: HTTP ${res.status}`, res.status, parsed);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `CCTV-Support-${Date.now()}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}


// Recording MVP
export async function getRecordings(options: { cameraId?: string; date?: string; limit?: number; protectedOnly?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.cameraId) params.set('cameraId', options.cameraId);
  if (options.date) params.set('date', options.date);
  if (options.protectedOnly) params.set('protected', '1');
  params.set('limit', String(options.limit ?? 250));
  return api<RecordingSegment[]>(`/api/v1/recordings?${params.toString()}`);
}
export async function getRecordingRuntime() { return api<{ summary: RecordingSummary; runtimes: RecordingRuntime[] }>('/api/v1/recordings/runtime'); }
export async function startContinuousRecording(cameraId: string) { return api<{ camera: Camera; runtime: RecordingRuntime }>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/recording/start`, { method: 'POST' }); }
export async function stopContinuousRecording(cameraId: string) { return api<{ camera: Camera; runtime: RecordingRuntime }>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/recording/stop`, { method: 'POST' }); }
export function recordingMediaUrl(id: number) { return `/api/v1/recordings/${encodeURIComponent(String(id))}/media`; }
export function recordingDownloadUrl(id: number) { return `/api/v1/recordings/${encodeURIComponent(String(id))}/download`; }

export async function setRecordingProtected(id: number, protectedValue: boolean) { return api<RecordingSegment>(`/api/v1/recordings/${encodeURIComponent(String(id))}/protection`, { method: 'PATCH', body: JSON.stringify({ protected: protectedValue }) }); }
export async function deleteRecording(id: number) { return api<void>(`/api/v1/recordings/${encodeURIComponent(String(id))}`, { method: 'DELETE' }); }
export async function deleteRecordingsBulk(ids: number[]) { return api<{ deletedCount: number; deletedBytes: number; skippedProtected: number; missing: number }>('/api/v1/recordings/delete-bulk', { method: 'POST', body: JSON.stringify({ ids }) }); }
export async function getRecordingPolicy() { return api<RecordingRetentionPolicy>('/api/v1/recordings/policy'); }
export async function updateRecordingPolicy(payload: Partial<Omit<RecordingRetentionPolicy, 'updatedAt'>>) { return api<RecordingRetentionPolicy>('/api/v1/recordings/policy', { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function getRecordingHealth() { return api<{ health: RecordingHealth; quarantine: RecordingQuarantineItem[] }>('/api/v1/recordings/health'); }
export async function reconcileRecordings() { return api<{ checkedAt: string; health: RecordingHealth; quarantined: RecordingQuarantineItem[] }>('/api/v1/recordings/reconcile', { method: 'POST' }); }
export async function runRecordingRetention() { return api<RecordingRetentionRunResult>('/api/v1/recordings/retention/run', { method: 'POST' }); }


// Motion detection + event-linked recordings
export async function getCameraMotion(cameraId: string) { return api<import('./types/cctv').MotionRuntime>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/motion`); }
export async function updateCameraMotion(cameraId: string, payload: Partial<Pick<import('./types/cctv').MotionSettings, 'enabled' | 'sensitivity' | 'cooldownSeconds' | 'preSeconds' | 'postSeconds'>>) {
  return api<import('./types/cctv').MotionRuntime>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/motion`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function getEventRecordings(eventId: string) { return api<import('./types/cctv').RecordingSegment[]>(`/api/v1/events/${encodeURIComponent(eventId)}/recordings`); }

export async function getMotionZones(cameraId: string) { return api<import('./types/cctv').MotionZone[]>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/motion/zones`); }
export async function createMotionZone(cameraId: string, payload: Partial<Omit<import('./types/cctv').MotionZone, 'id' | 'cameraId' | 'updatedAt'>>) { return api<import('./types/cctv').MotionZone>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/motion/zones`, { method: 'POST', body: JSON.stringify(payload) }); }
export async function updateMotionZone(cameraId: string, zoneId: number, payload: Partial<Omit<import('./types/cctv').MotionZone, 'id' | 'cameraId' | 'updatedAt'>>) { return api<import('./types/cctv').MotionZone>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/motion/zones/${encodeURIComponent(String(zoneId))}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export async function deleteMotionZone(cameraId: string, zoneId: number) { return api<void>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/motion/zones/${encodeURIComponent(String(zoneId))}`, { method: 'DELETE' }); }
export async function getMotionEventContext(eventId: string) { return api<import('./types/cctv').MotionEventContext>(`/api/v1/events/${encodeURIComponent(eventId)}/motion-context`); }
export async function updateMotionEventReview(eventId: string, status: import('./types/cctv').MotionReviewStatus, note: string) { return api<import('./types/cctv').MotionReview>(`/api/v1/events/${encodeURIComponent(eventId)}/motion-review`, { method: 'PATCH', body: JSON.stringify({ status, note }) }); }
export function motionSnapshotUrl(eventId: string) { return `/api/v1/events/${encodeURIComponent(eventId)}/snapshot`; }

// Local AI person / vehicle detection
export async function getCameraAi(cameraId: string) { return api<import('./types/cctv').AiRuntime>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/ai`); }
export async function updateCameraAi(cameraId: string, payload: Partial<Omit<import('./types/cctv').AiSettings, 'cameraId'|'updatedAt'>>) { return api<import('./types/cctv').AiRuntime>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/ai`, { method:'PATCH', body:JSON.stringify(payload) }); }
export async function pauseCameraAi(cameraId: string, minutes = 15) { return api<import('./types/cctv').AiRuntime>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/ai/pause`, { method:'POST', body:JSON.stringify({ minutes }) }); }
export async function resumeCameraAi(cameraId: string) { return api<import('./types/cctv').AiRuntime>(`/api/v1/cameras/${encodeURIComponent(cameraId)}/ai/resume`, { method:'POST', body:'{}' }); }
export async function getAiEventContext(eventId: string) { return api<import('./types/cctv').AiEventContext>(`/api/v1/events/${encodeURIComponent(eventId)}/ai-context`); }
export async function updateAiEventReview(eventId: string, status: import('./types/cctv').AiReviewStatus, note: string) { return api<import('./types/cctv').AiReview>(`/api/v1/events/${encodeURIComponent(eventId)}/ai-review`, { method:'PATCH', body:JSON.stringify({ status, note }) }); }
export async function getAiEventRecordings(eventId: string) { return api<import('./types/cctv').RecordingSegment[]>(`/api/v1/events/${encodeURIComponent(eventId)}/ai-recordings`); }
export function aiSnapshotUrl(eventId:string){ return `/api/v1/events/${encodeURIComponent(eventId)}/ai-snapshot`; }
