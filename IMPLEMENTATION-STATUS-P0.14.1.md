# P0.14.1 Implementation Status

## Implemented
- Database schema v8.
- Rectangular motion zones (maximum 4 per camera).
- Per-zone sensitivity override / camera-sensitivity inheritance.
- Separate low-rate MediaMTX scene analyzer per enabled zone.
- Whole-frame compatibility mode when no zones exist.
- Authenticated event snapshots.
- Motion-event review status and notes.
- Zone-aware event metadata.
- Existing event-to-recording linkage retained.
- P0.14.1 UI for zone configuration and event review.

## Protected / unchanged media core
- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

## Hardware qualification still required
- Real USB motion-zone selectivity under actual room lighting.
- Snapshot capture latency/reliability on the Windows CCTV PC.
- CPU usage with 1–4 simultaneously enabled zones.
- USB unplug/replug analyzer recovery.

## Not implemented in this release
AI object classification, polygon zones, push notification delivery, RTSP/Tenda motion qualification, PTZ, audio, or two-way intercom.
