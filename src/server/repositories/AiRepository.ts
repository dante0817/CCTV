import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type AiObjectType = 'person' | 'vehicle';
export type AiPerformanceProfile = 'low_cpu' | 'balanced' | 'high_accuracy' | 'custom';
export type AiTriggerMode = 'continuous' | 'motion';
export type AiReviewStatus = 'unreviewed' | 'confirmed_person' | 'confirmed_vehicle' | 'false_detection';

export interface AiSettings {
  cameraId: string;
  enabled: boolean;
  confidencePercent: number; // historical P0.16 compatibility
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

export interface AiReview {
  eventId: number;
  status: AiReviewStatus;
  note: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface AiFeedbackStats {
  totalReviewed: number;
  confirmedPerson: number;
  confirmedVehicle: number;
  falseDetections: number;
  falsePositiveRatePercent: number | null;
}

export interface AiDetectionRow {
  event_id: number;
  camera_id: string;
  detected_at: string;
  object_type: AiObjectType;
  confidence: number;
  object_count: number;
  classes_json: string;
  boxes_json: string;
  snapshot_path: string | null;
  pre_seconds: number;
  post_seconds: number;
  model_name: string;
  created_at: string;
}

const PROFILE_DEFAULTS: Record<Exclude<AiPerformanceProfile, 'custom'>, Pick<AiSettings, 'sampleIntervalSeconds'|'personConfidencePercent'|'vehicleConfidencePercent'>> = {
  low_cpu: { sampleIntervalSeconds: 10, personConfidencePercent: 65, vehicleConfidencePercent: 65 },
  balanced: { sampleIntervalSeconds: 5, personConfidencePercent: 55, vehicleConfidencePercent: 55 },
  high_accuracy: { sampleIntervalSeconds: 2, personConfidencePercent: 45, vehicleConfidencePercent: 50 },
};

export class AiRepository {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }

  getSettings(cameraId: string): AiSettings {
    const row = this.db.prepare('SELECT * FROM camera_ai_settings WHERE camera_id=?').get(cameraId) as any;
    if (!row) return {
      cameraId, enabled: false, confidencePercent: 55, personConfidencePercent: 55, vehicleConfidencePercent: 55,
      sampleIntervalSeconds: 5, cooldownSeconds: 30, detectPerson: true, detectVehicle: true,
      performanceProfile: 'balanced', triggerMode: 'continuous', motionGateSeconds: 30, motionZoneId: null,
      preSeconds: 15, postSeconds: 45, updatedAt: new Date(0).toISOString(),
    };
    const legacy = Number(row.confidence_percent ?? 55);
    return {
      cameraId: String(row.camera_id), enabled: Boolean(row.enabled), confidencePercent: legacy,
      personConfidencePercent: Number(row.person_confidence_percent ?? legacy), vehicleConfidencePercent: Number(row.vehicle_confidence_percent ?? legacy),
      sampleIntervalSeconds: Number(row.sample_interval_seconds), cooldownSeconds: Number(row.cooldown_seconds),
      detectPerson: Boolean(row.detect_person), detectVehicle: Boolean(row.detect_vehicle),
      performanceProfile: this.profile(row.performance_profile), triggerMode: row.trigger_mode === 'motion' ? 'motion' : 'continuous',
      motionGateSeconds: Number(row.motion_gate_seconds ?? 30), motionZoneId: row.motion_zone_id == null ? null : Number(row.motion_zone_id),
      preSeconds: Number(row.pre_seconds), postSeconds: Number(row.post_seconds), updatedAt: String(row.updated_at),
    };
  }

  updateSettings(cameraId: string, input: Partial<Omit<AiSettings,'cameraId'|'updatedAt'>>): AiSettings {
    const current = this.getSettings(cameraId);
    const clamp = (v: unknown, f: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : f; };
    const requestedProfile = input.performanceProfile === undefined ? current.performanceProfile : this.profile(input.performanceProfile);
    const preset = requestedProfile === 'custom' ? null : PROFILE_DEFAULTS[requestedProfile];
    const profileChanged = input.performanceProfile !== undefined && requestedProfile !== current.performanceProfile;
    const personConfidencePercent = clamp(input.personConfidencePercent ?? input.confidencePercent ?? (profileChanged && preset ? preset.personConfidencePercent : current.personConfidencePercent), current.personConfidencePercent, 20, 95);
    const vehicleConfidencePercent = clamp(input.vehicleConfidencePercent ?? input.confidencePercent ?? (profileChanged && preset ? preset.vehicleConfidencePercent : current.vehicleConfidencePercent), current.vehicleConfidencePercent, 20, 95);
    const sampleIntervalSeconds = clamp(input.sampleIntervalSeconds ?? (profileChanged && preset ? preset.sampleIntervalSeconds : current.sampleIntervalSeconds), current.sampleIntervalSeconds, 2, 60);
    const next = {
      enabled: input.enabled ?? current.enabled,
      confidencePercent: Math.min(personConfidencePercent, vehicleConfidencePercent),
      personConfidencePercent, vehicleConfidencePercent, sampleIntervalSeconds,
      cooldownSeconds: clamp(input.cooldownSeconds, current.cooldownSeconds, 5, 600),
      detectPerson: input.detectPerson ?? current.detectPerson,
      detectVehicle: input.detectVehicle ?? current.detectVehicle,
      performanceProfile: requestedProfile,
      triggerMode: input.triggerMode === undefined ? current.triggerMode : input.triggerMode === 'motion' ? 'motion' : 'continuous',
      motionGateSeconds: clamp(input.motionGateSeconds, current.motionGateSeconds, 5, 300),
      motionZoneId: input.motionZoneId === undefined ? current.motionZoneId : input.motionZoneId == null ? null : Math.max(1, Math.round(Number(input.motionZoneId))),
      preSeconds: clamp(input.preSeconds, current.preSeconds, 0, 120),
      postSeconds: clamp(input.postSeconds, current.postSeconds, 5, 300),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`INSERT INTO camera_ai_settings(camera_id,enabled,confidence_percent,sample_interval_seconds,cooldown_seconds,detect_person,detect_vehicle,pre_seconds,post_seconds,updated_at,performance_profile,person_confidence_percent,vehicle_confidence_percent,trigger_mode,motion_gate_seconds,motion_zone_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(camera_id) DO UPDATE SET enabled=excluded.enabled,confidence_percent=excluded.confidence_percent,sample_interval_seconds=excluded.sample_interval_seconds,cooldown_seconds=excluded.cooldown_seconds,detect_person=excluded.detect_person,detect_vehicle=excluded.detect_vehicle,pre_seconds=excluded.pre_seconds,post_seconds=excluded.post_seconds,updated_at=excluded.updated_at,performance_profile=excluded.performance_profile,person_confidence_percent=excluded.person_confidence_percent,vehicle_confidence_percent=excluded.vehicle_confidence_percent,trigger_mode=excluded.trigger_mode,motion_gate_seconds=excluded.motion_gate_seconds,motion_zone_id=excluded.motion_zone_id`)
      .run(cameraId,next.enabled?1:0,next.confidencePercent,next.sampleIntervalSeconds,next.cooldownSeconds,next.detectPerson?1:0,next.detectVehicle?1:0,next.preSeconds,next.postSeconds,next.updatedAt,next.performanceProfile,next.personConfidencePercent,next.vehicleConfidencePercent,next.triggerMode,next.motionGateSeconds,next.motionZoneId);
    return this.getSettings(cameraId);
  }

  createDetection(input: { eventId:number; cameraId:string; detectedAt:string; objectType:AiObjectType; confidence:number; objectCount:number; classes:string[]; boxes:unknown[]; snapshotPath?:string|null; settings:AiSettings; modelName:string }): AiDetectionRow {
    const createdAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_detections(event_id,camera_id,detected_at,object_type,confidence,object_count,classes_json,boxes_json,snapshot_path,pre_seconds,post_seconds,model_name,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`)
      .run(input.eventId,input.cameraId,input.detectedAt,input.objectType,input.confidence,input.objectCount,JSON.stringify(input.classes),JSON.stringify(input.boxes),input.snapshotPath||null,input.settings.preSeconds,input.settings.postSeconds,input.modelName,createdAt);
    return this.getDetection(input.eventId)!;
  }

  setSnapshotPath(eventId:number, snapshotPath:string|null): AiDetectionRow | null { this.db.prepare('UPDATE ai_detections SET snapshot_path=? WHERE event_id=?').run(snapshotPath,eventId); return this.getDetection(eventId); }
  getDetection(eventId:number): AiDetectionRow | null { const row=this.db.prepare('SELECT * FROM ai_detections WHERE event_id=?').get(eventId) as any; return row ? row as AiDetectionRow : null; }
  listRecent(maxAgeSeconds=3600): AiDetectionRow[] { const cutoff=new Date(Date.now()-Math.max(60,maxAgeSeconds)*1000).toISOString(); return this.db.prepare('SELECT * FROM ai_detections WHERE detected_at>=? ORDER BY detected_at DESC').all(cutoff) as any[]; }

  getReview(eventId: number): AiReview {
    const row = this.db.prepare('SELECT * FROM ai_event_reviews WHERE event_id=?').get(eventId) as any;
    if (!row) return { eventId, status: 'unreviewed', note: '', reviewedAt: null, reviewedBy: null };
    return { eventId, status: this.reviewStatus(row.status), note: String(row.note || ''), reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at), reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by) };
  }

  setReview(eventId: number, status: AiReviewStatus, note = '', reviewedBy: string | null = null): AiReview {
    const safeStatus = this.reviewStatus(status); const safeNote = String(note || '').trim().slice(0, 1000); const reviewedAt = safeStatus === 'unreviewed' ? null : new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_event_reviews(event_id,status,note,reviewed_at,reviewed_by) VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET status=excluded.status,note=excluded.note,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by`)
      .run(eventId,safeStatus,safeNote,reviewedAt,safeStatus === 'unreviewed' ? null : reviewedBy);
    return this.getReview(eventId);
  }

  feedbackStats(cameraId?: string): AiFeedbackStats {
    const rows = cameraId
      ? this.db.prepare(`SELECT r.status, COUNT(*) AS n FROM ai_event_reviews r JOIN ai_detections d ON d.event_id=r.event_id WHERE d.camera_id=? AND r.status<>'unreviewed' GROUP BY r.status`).all(cameraId) as any[]
      : this.db.prepare(`SELECT status, COUNT(*) AS n FROM ai_event_reviews WHERE status<>'unreviewed' GROUP BY status`).all() as any[];
    const counts = new Map(rows.map(r => [String(r.status), Number(r.n)]));
    const confirmedPerson=counts.get('confirmed_person')||0, confirmedVehicle=counts.get('confirmed_vehicle')||0, falseDetections=counts.get('false_detection')||0;
    const totalReviewed=confirmedPerson+confirmedVehicle+falseDetections;
    return { totalReviewed, confirmedPerson, confirmedVehicle, falseDetections, falsePositiveRatePercent: totalReviewed ? Number(((falseDetections/totalReviewed)*100).toFixed(1)) : null };
  }

  linkRecording(eventId:number, recordingId:number): void { this.db.prepare('INSERT OR IGNORE INTO ai_event_recordings(event_id,recording_id,linked_at) VALUES(?,?,?)').run(eventId,recordingId,new Date().toISOString()); }
  linkedRecordingIds(eventId:number): number[] { return (this.db.prepare('SELECT recording_id FROM ai_event_recordings WHERE event_id=? ORDER BY recording_id').all(eventId) as any[]).map(r=>Number(r.recording_id)); }
  close(){ this.db.close(); }

  private profile(value: unknown): AiPerformanceProfile { return value === 'low_cpu' || value === 'high_accuracy' || value === 'custom' ? value : 'balanced'; }
  private reviewStatus(value: unknown): AiReviewStatus { return value === 'confirmed_person' || value === 'confirmed_vehicle' || value === 'false_detection' ? value : 'unreviewed'; }
}
