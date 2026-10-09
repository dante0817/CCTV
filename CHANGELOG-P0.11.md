# CCTV Monitor P0.11 — RTSP / Tenda Live Video Foundation

## Added

- Explicit USB/RTSP camera-source adapter layer so lifecycle/recovery stays source-neutral.
- Generic RTSP camera source support through the existing FFmpeg -> MediaMTX -> WebRTC/HLS pipeline.
- Tenda CP3 Pro setup preset using RTSP port `554` and main-stream path `/ch=1&subtype=0`.
- Server-side RTSP connection probe with codec, resolution and FPS detection.
- Versioned SQLite schema migrations and a separate `camera_rtsp_config` table.
- AES-256-GCM encryption for stored RTSP passwords with a local credential key.
- Independent RTSP camera workers with supervised restart/backoff and jitter.
- Current-user/current-camera ACL revalidation during MediaMTX read authorization.
- Real `/api/v1/system/info` and expanded `/api/v1/system/status` information.
- P0.11 qualification helper and RTSP/migration/credential regression tests.

## Changed

- Dashboard now reports real camera/service state instead of fixed demo health values.
- Storage view reports host-volume capacity and truthfully marks recording/retention as not implemented.
- Network-camera creation is backend-persistent instead of a temporary frontend object.
- Camera edit saves name/location to the backend.
- Viewer camera payloads exclude RTSP source configuration.
- Dependency ranges in `package.json` are pinned to exact versions pending lockfile generation on an internet-connected build PC.

## Preserved

The protected P0.10 media baseline files are intentionally unchanged:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

## Deliberately deferred

- ONVIF discovery
- PTZ command/control
- camera audio / two-way intercom
- recording/NVR and retention
- motion/AI events
- notification delivery

These should be implemented only after USB + RTSP/Tenda live video passes real Windows hardware, network-recovery and soak qualification.
