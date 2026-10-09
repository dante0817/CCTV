# CCTV Monitor P0.13 — Continuous USB Recording MVP

P0.13 adds the first real NVR capability while preserving the proven live-media path.

## Added
- Continuous recording for USB cameras by consuming the already-published local MediaMTX RTSP stream.
- No second DirectShow capture and no change to the protected live FFmpeg/WebRTC/HLS core.
- Schema migration v5 and `recording_segments` SQLite index.
- Time-segmented H.264 MP4 recording under `data/recordings/<camera-id>/` (or `CCTV_RECORDINGS_DIR`).
- Persistent recording intent: armed USB cameras automatically resume recording after live-stream recovery/restart.
- Internal loopback-only MediaMTX recorder credential derived from the existing CCTV credential key.
- Authenticated recording list/runtime APIs and per-camera Recording Access enforcement.
- Authenticated byte-range MP4 playback and Admin download.
- Real Recordings UI; old simulated clip/timeline presentation removed.
- Real recording bytes/storage reporting and recording status on Dashboard/Diagnostics.
- Recording operational events: started, stopped and rate-limited errors.
- Graceful recorder shutdown and final-segment indexing.
- Crash-leftover safety: the newest unindexed MP4 found at startup is retained on disk but not automatically advertised as healthy footage.
- Camera deletion is blocked while indexed or unindexed recording MP4 files remain.

## Safety boundaries
- USB recording only in P0.13. RTSP/Tenda recording remains disabled pending hardware qualification.
- No automatic retention or deletion.
- No motion-triggered recording, clip export, protected-clip management, audio recording or PTZ integration.
- Missing recording files are marked unavailable instead of silently served.

## Protected baseline
`mediamtx.yml`, `FfmpegService.ts`, and `CameraPlayer.tsx` remain byte-for-byte unchanged and are verified by `BASELINE-P0.13.sha256`.
