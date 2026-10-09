import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CameraRepository } from '../src/server/repositories/CameraRepository';
import { CredentialService } from '../src/server/services/CredentialService';
import { CameraSourceAdapterRegistry } from '../src/server/services/CameraSourceAdapter';
import { buildRtspUrl, normalizeRtspPath } from '../src/server/services/RtspService';
import type { Camera } from '../src/types/cctv';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-rtsp-test-'));
const dbPath = path.join(temp, 'data', 'cctv.db');
const repo = new CameraRepository(dbPath);
const credentials = new CredentialService(temp);

try {
  assert.ok(repo.schemaVersion() >= 3, 'RTSP foundation requires schema migration v3 or later.');
  const sources = new CameraSourceAdapterRegistry(repo, credentials);
  assert.deepEqual(sources.supportedTypes().sort(), ['rtsp', 'usb'], 'camera source registry must isolate USB and RTSP adapters');
  assert.equal(normalizeRtspPath('ch=1&subtype=0'), '/ch=1&subtype=0');
  const url = buildRtspUrl({ host: '192.168.1.20', port: 554, path: '/ch=1&subtype=0', username: 'admin', password: 'p@ss:word', transport: 'tcp' });
  assert.equal(url, 'rtsp://admin:p%40ss%3Aword@192.168.1.20:554/ch=1&subtype=0');

  const encrypted = credentials.encrypt('secret-camera-password');
  assert.notEqual(encrypted, 'secret-camera-password');
  assert.equal(credentials.decrypt(encrypted), 'secret-camera-password');

  const camera: Camera = {
    id: 'cam-rtsp-test', name: 'Tenda Test', location: 'Porch', address: '192.168.1.20:554', status: 'configured',
    recording: false, recordingMode: 'disabled', resolution: 'Detected after connection', fps: 20, bitrate: '2.5 Mbps',
    codec: 'H.264 (not started)', model: 'Tenda CP3 Pro', uptime: 'Not started', lastSeen: 'Never', lastMotion: 'Not implemented',
    protocol: 'RTSP → FFmpeg → MediaMTX → WebRTC/HLS', ptz: true, substream: 'Not configured', enabled: false, source_type: 'rtsp',
    stream: { path: 'cam-cam-rtsp-test', protocol: 'webrtc', whepPath: '/cam-cam-rtsp-test/whep' },
    rtsp_source: { host: '192.168.1.20', port: 554, path: '/ch=1&subtype=0', username: 'admin', transport: 'tcp', video_mode: 'transcode', encoder: 'auto', bitrate_kbps: 2500, vendor_profile: 'tenda-cp3-pro', credential_configured: true },
  };
  repo.save(camera);
  repo.saveRtspConfig(camera.id, { host: '192.168.1.20', port: 554, stream_path: '/ch=1&subtype=0', username: 'admin', password_encrypted: encrypted, transport: 'tcp', video_mode: 'transcode', encoder: 'auto', bitrate_kbps: 2500, vendor_profile: 'tenda-cp3-pro' });
  assert.equal(repo.getRtspConfig(camera.id)?.password_encrypted, encrypted);
  assert.equal(JSON.stringify(repo.get(camera.id)).includes('secret-camera-password'), false, 'plaintext RTSP password must not be present in camera payload');

  const raw = new DatabaseSync(dbPath);
  const stored = raw.prepare('SELECT password_encrypted FROM camera_rtsp_config WHERE camera_id=?').get(camera.id) as { password_encrypted: string };
  raw.close();
  assert.notEqual(stored.password_encrypted, 'secret-camera-password');
  console.log('P0.11.2 RTSP/migration/credential foundation checks passed.');
} finally {
  repo.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
