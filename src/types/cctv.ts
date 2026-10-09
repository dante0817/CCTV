export type CameraStatus =
  | 'configured'
  | 'starting'
  | 'online'
  | 'degraded'
  | 'reconnecting'
  | 'retrying'
  | 'offline'
  | 'error'
  | 'disabled';

export interface CameraStream {
  path: string;
  protocol: 'webrtc';
  whepPath: string;
}

export interface UsbSource {
  device_id: string;
  device_name: string;
  width: number;
  height: number;
  fps: number;
  pixel_format?: string | null;
  encoder: string;
  encoder_active?: string | null;
  bitrate_kbps: number;
  last_capture_error?: string | null;
}


export type RtspTransport = 'tcp' | 'udp';
export type RtspVideoMode = 'transcode' | 'copy';
export type RtspVendorProfile = 'generic' | 'tenda-cp3-pro';

export interface RtspSource {
  host: string;
  port: number;
  path: string;
  username: string;
  transport: RtspTransport;
  video_mode: RtspVideoMode;
  encoder: string;
  encoder_active?: string | null;
  bitrate_kbps: number;
  vendor_profile: RtspVendorProfile;
  credential_configured?: boolean;
}

export interface RtspProbe {
  ok: boolean;
  message: string;
  ffmpeg_available: boolean;
  connected?: boolean;
  codec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  code?: string;
  details?: string;
}

export interface UsbDevice {
  device_id: string;
  name: string;
  alternative_name?: string | null;
  is_video?: boolean;
}

export interface UsbFormat {
  pixel_format?: string;
  codec?: string;
  width: number;
  height: number;
  min_fps?: number;
  max_fps?: number;
}

export interface UsbEncoder {
  name: string;
  available: boolean;
  usable: boolean;
  hardware: boolean;
  reason?: string;
}

export interface UsbProbe {
  ok: boolean;
  message: string;
  ffmpeg_available: boolean;
  device_opened?: boolean;
  frames_received?: number | null;
  duration_ms?: number;
  width?: number;
  height?: number;
  fps_requested?: number;
  code?: string;
  details?: string;
  stage?: 'capture' | 'stream';
}

export interface Camera {
  id: string;
  name: string;
  location: string;
  address: string;
  status: CameraStatus;
  recording: boolean;
  recordingMode: 'continuous' | 'motion' | 'disabled';
  resolution: string;
  fps: number;
  bitrate: string;
  codec: string;
  model: string;
  uptime: string;
  lastSeen: string;
  lastMotion: string;
  image?: string;
  thumbnail?: string;
  protocol: string;
  ptz: boolean;
  substream: string;
  enabled: boolean;
  source_type?: 'onvif' | 'rtsp' | 'usb';
  usb_source?: UsbSource;
  rtsp_source?: RtspSource;
  stream?: CameraStream;
  stream_available?: boolean;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type EventSeverity = 'info' | 'warning' | 'critical';

export interface CCTVEvent {
  id: string;
  timestamp: string;
  timeOnly: string;
  camera: string;
  cameraId: string;
  eventType: string;
  message: string;
  severity: EventSeverity;
  category?: 'camera' | 'system' | 'storage';
  title?: string;
  acknowledgedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  thumbnail?: string;
}


export interface AlertNotification {
  id: number;
  ruleId: number;
  eventId: number;
  eventType: string;
  cameraId: string | null;
  cameraName: string | null;
  zoneName: string | null;
  severity: EventSeverity;
  title: string;
  message: string;
  desktopEnabled: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationRule {
  id: number;
  name: string;
  enabled: boolean;
  eventType: string;
  minimumSeverity: EventSeverity;
  cameraId: string | null;
  zoneId: number | null;
  cooldownSeconds: number;
  desktopEnabled: boolean;
  emailEnabled: boolean;
  updatedAt: string;
}


export interface NotificationEmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secureMode: 'none' | 'starttls' | 'tls';
  username: string;
  passwordConfigured: boolean;
  fromAddress: string;
  recipients: string[];
  baseUrl: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: number;
  notificationId: number;
  channel: 'email';
  status: 'pending' | 'sending' | 'sent' | 'retrying' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  cameraName: string | null;
}

export interface RecordedClip {
  id: string;
  cameraId: string;
  cameraName: string;
  location: string;
  date: string;
  timeRange: string;
  startTime: string;
  endTime: string;
  duration: string;
  durationSeconds: number;
  type: 'motion' | 'continuous';
  thumbnail: string;
  fileSize: string;
}

export type RecordingSegmentStatus = 'complete' | 'missing' | 'corrupt';

export interface RecordingSegment {
  id: number;
  cameraId: string;
  cameraName: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  sizeBytes: number;
  status: RecordingSegmentStatus;
  codec: string | null;
  protected: boolean;
  mediaUrl: string;
  downloadUrl: string;
}

export interface RecordingRuntime {
  cameraId: string;
  desired: boolean;
  supported: boolean;
  active: boolean;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  directory?: string;
}

export interface RecordingSummary {
  supported: boolean;
  active: boolean;
  activeCount: number;
  desiredCount: number;
  segmentCount: number;
  bytes: number;
  runtimes?: RecordingRuntime[];
}


export interface RecordingRetentionPolicy {
  enabled: boolean;
  maxAgeDays: number;
  maxStorageBytes: number;
  minFreeBytes: number;
  updatedAt: string;
}

export interface RecordingHealth {
  complete: number;
  missing: number;
  corrupt: number;
  protected: number;
  quarantined: number;
  indexedBytes: number;
}

export interface RecordingQuarantineItem {
  id: number;
  camera_id: string;
  file_path: string;
  reason: string;
  size_bytes: number;
  detected_at: string;
}

export interface RecordingRetentionRunResult {
  enabled: boolean;
  ranAt: string;
  deletedCount: number;
  deletedBytes: number;
  beforeBytes: number;
  afterBytes: number;
  freeBytesBefore: number | null;
  freeBytesAfterEstimate: number | null;
  reason: 'disabled' | 'no_action' | 'policy';
}

export interface MotionSettings {
  cameraId: string;
  enabled: boolean;
  sensitivity: number;
  cooldownSeconds: number;
  preSeconds: number;
  postSeconds: number;
  updatedAt: string;
}

export interface MotionZone {
  id: number;
  cameraId: string;
  name: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  sensitivity: number | null;
  updatedAt: string;
}

export type MotionReviewStatus = 'unreviewed' | 'confirmed' | 'dismissed';

export interface MotionReview {
  eventId: number;
  status: MotionReviewStatus;
  note: string;
  reviewedAt: string | null;
}

export interface MotionEventContext {
  eventId: number;
  cameraId: string;
  detectedAt: string;
  sceneScore: number;
  sensitivity: number;
  zoneId: number | null;
  zoneName: string | null;
  snapshotUrl: string | null;
  review: MotionReview;
}

export interface MotionRuntime {
  cameraId: string;
  supported: boolean;
  enabled: boolean;
  active: boolean;
  pid: number | null;
  analyzerCount: number;
  activeZoneCount: number;
  startedAt: string | null;
  lastDetectedAt: string | null;
  lastScore: number | null;
  lastError: string | null;
  threshold: number;
  settings: MotionSettings;
  zones: MotionZone[];
}


export type AiPerformanceProfile = 'low_cpu' | 'balanced' | 'high_accuracy' | 'custom';
export type AiTriggerMode = 'continuous' | 'motion';
export type AiReviewStatus = 'unreviewed' | 'confirmed_person' | 'confirmed_vehicle' | 'false_detection';

export interface AiSettings {
  cameraId: string;
  enabled: boolean;
  confidencePercent: number;
  personConfidencePercent: number;
  vehicleConfidencePercent: number;
  sampleIntervalSeconds: number;
  cooldownSeconds: number;
  detectPerson: boolean;
  detectVehicle: boolean;
  performanceProfile: AiPerformanceProfile;
  triggerMode: AiTriggerMode;
  motionGateSeconds: number;
  motionZoneId: number | null;
  preSeconds: number;
  postSeconds: number;
  updatedAt: string;
}
export interface AiBox { classId:number; className:string; confidence:number; x:number; y:number; width:number; height:number; }
export interface AiReview { eventId:number; status:AiReviewStatus; note:string; reviewedAt:string|null; reviewedBy:string|null; }
export interface AiFeedbackStats { totalReviewed:number; confirmedPerson:number; confirmedVehicle:number; falseDetections:number; falsePositiveRatePercent:number|null; }
export interface AiRuntime {
  cameraId:string; supported:boolean; enabled:boolean; active:boolean; paused:boolean; pausedUntil:string|null; modelInstalled:boolean; runtimeAvailable:boolean; modelName:string;
  lastRunAt:string|null; lastSuccessfulInferenceAt:string|null; lastDetectedAt:string|null; lastError:string|null; lastInferenceMs:number|null; averageInferenceMs:number|null;
  samplesPerMinute:number; skippedSamples:number; backoffSeconds:number; lastAiCpuPercent:number|null; processRssMb:number; systemMemoryPercent:number; waitingForMotion:boolean;
  settings:AiSettings; feedback:AiFeedbackStats;
}
export interface AiEventContext {
  eventId:number; cameraId:string; detectedAt:string; objectType:'person'|'vehicle'; confidence:number; objectCount:number; classes:string[]; boxes:AiBox[]; snapshotUrl:string|null; modelName:string; review:AiReview;
}

export interface UserAccount {
  id: string;
  username: string;
  name: string;
  role: 'Admin' | 'Viewer';
  email: string;
  lastActive: string;
  cameraAccess: 'all' | string[];
}

export type ActiveTab =
  | 'live'
  | 'my-cameras'
  | 'account'
  | 'dashboard'
  | 'cameras'
  | 'recordings'
  | 'events'
  | 'notifications'
  | 'users'
  | 'camera-access'
  | 'storage'
  | 'diagnostics'
  | 'audit'
  | 'sessions'
  | 'settings';

export type UserRole = 'Admin' | 'Viewer';
export type CameraAccess = 'all' | string[];

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  status: 'Active' | 'Inactive';
  cameraAccess: CameraAccess;
  recordingAccess: CameraAccess;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  security_version: number;
  password_changed_at: string | null;
  aiEnabled: boolean;
}

export interface SessionInfo {
  id: string;
  userId: string;
  username?: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  remoteAddress: string | null;
  userAgent: string | null;
  current?: boolean;
}

export interface AuditEntry {
  id: number;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuthStatus {
  setupRequired: boolean;
  setupAllowed: boolean;
}

export interface RemoteAccessStatus {
  installed: boolean;
  connected: boolean;
  backendState?: string | null;
  dnsName?: string | null;
  tailscaleIps: string[];
  lanAddresses: string[];
  recommendedHost?: string | null;
  serveConfigured?: boolean;
  serveUrl?: string | null;
  serveDetail?: string | null;
  error?: string | null;
}

export interface StreamRuntimeConfig {
  host: string;
  webrtcBase: string;
  hlsProxyBase: string;
  preferredProtocol: 'webrtc' | 'hls';
  fallbackProtocol: 'hls';
  remote: RemoteAccessStatus;
  secureOriginReady: boolean;
}

export interface MediaStreamToken {
  token: string;
  expiresAt: string;
  path: string;
}



export type HealthState = 'healthy' | 'unhealthy' | 'unknown' | 'not_configured' | 'not_supported';

export interface CameraRuntimeSnapshot {
  cameraId: string;
  name: string;
  enabled: boolean;
  state: CameraStatus;
  reason: string | null;
  stateSince: string;
  sourceType?: Camera['source_type'];
  running: boolean;
  pid: number | null;
  encoder: string | null;
  workerStartedAt: string | null;
  restartCount: number;
  consecutiveFailures: number;
  recoveryAttempt: number;
  reconnectScheduled: boolean;
  starting: boolean;
  nextRetryAt: string | null;
  circuitOpenUntil: string | null;
  lastRecovery: string | null;
  lastExit: string | null;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  mediaPathPresent: boolean;
  streamReady: boolean;
  mediaReaders: number;
}

export interface SystemStatus {
  version: string;
  backend: { ok: boolean; state: HealthState; port: number; bind: string; browserUrl: string; mode: string; uptimeSeconds: number; root?: string };
  ffmpeg: { ok: boolean; state: HealthState; path: string | null };
  mediamtx: { ok: boolean; state: HealthState; installed: boolean; binary?: string | null; config?: string; startedByApp?: boolean; pid?: number | null; api?: string; rtsp?: string; webrtc?: string; hls?: string; webrtcReachable: boolean; hlsReachable: boolean; webrtcPort: number; hlsPort: number; iceUdpPort: number; auth?: string; info?: unknown; error?: string };
  database: { ok: boolean; state: HealthState; engine: string; path: string; schemaVersion?: number };
  remoteAccess: RemoteAccessStatus;
  cameras: CameraRuntimeSnapshot[];
  cameraSummary: { total: number; online: number; offline: number; transitional: number; disabled: number; error: number };
  activeMediaSessions: number;
  storage: { ok: boolean; state: HealthState; path: string; volumeRoot: string; writable: boolean; totalBytes: number | null; freeBytes: number | null; usedBytes: number | null; databaseBytes: number | null; recordingsBytes: number; recordingImplemented: boolean; retentionImplemented: boolean; error?: string | null };
  recording: { state: 'ready' | 'recording' | 'idle'; supported: true; active: boolean; activeCount: number; desiredCount: number; segmentCount: number; bytes: number };
  features: { usb: 'available' | 'unavailable'; rtsp: 'available'; onvifDiscovery: 'planned'; recording: 'available'; motion: 'available'; notifications: 'available'; ai: 'available'; ptz: 'planned'; twoWayAudio: 'planned' };
  memory: { rss: number; heapUsed: number; systemFree: number; systemTotal: number };
  demoMode: boolean;
}
