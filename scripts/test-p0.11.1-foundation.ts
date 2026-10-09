import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MediaMtxService } from '../src/server/services/MediaMtxService';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const mediaSource = read('src/server/services/MediaMtxService.ts');
assert.doesNotMatch(mediaSource, /\/v3\/paths\/get\//, 'P0.11.1 readiness checks must not probe a missing path with the noisy path-specific API.');
assert.match(mediaSource, /\/v3\/paths\/list/, 'P0.11.1 must discover MediaMTX paths through the list endpoint.');

const manager = read('src/server/services/CameraProcessManager.ts');
assert.match(manager, /reason:\s*string \| null/, 'Runtime state must carry a reason.');
assert.match(manager, /stateSince:/, 'Runtime state must carry a transition timestamp.');
assert.match(manager, /CIRCUIT_BREAKER_OPEN/, 'Recovery circuit breaker must prevent restart storms.');
assert.match(manager, /STUCK_MEDIA_PIPELINE/, 'Supervisor must detect FFmpeg-alive/media-not-ready stuck state.');
assert.match(manager, /prepareForStartup/, 'Startup reconciliation must reset stale persisted runtime state.');
assert.match(manager, /restartTimers\.clear\(\)/, 'Graceful shutdown must clear pending recovery timers.');

const systemStatus = read('src/server/services/SystemStatusService.ts');
assert.match(systemStatus, /cameraProcesses\.allRuntimeWithMedia/, 'System status must use runtime/media truth rather than camera-row status alone.');
const storage = read('src/server/services/StorageService.ts');
assert.match(storage, /writeProbe/, 'Storage health must verify writability, not only capacity.');
assert.match(storage, /databaseBytes/, 'Storage status must expose real SQLite database size.');

const originalFetch = globalThis.fetch;
const calls: string[] = [];
try {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify({ items: [
      { name: 'cam-starting', ready: false },
      { name: 'cam-ready', ready: true, readers: [{ id: 'reader-1' }] },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const service = new MediaMtxService(root);
  assert.equal((await service.pathState('cam-missing')).state, 'absent');
  assert.equal((await service.pathState('cam-starting')).state, 'present-not-ready');
  const ready = await service.pathState('cam-ready');
  assert.equal(ready.state, 'ready');
  assert.equal(ready.info?.readers?.length, 1);
  assert.ok(calls.every((url) => url.endsWith('/v3/paths/list')), 'All readiness probes must use path listing.');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('P0.11.1 runtime observability/stability foundation checks passed.');
