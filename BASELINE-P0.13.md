# P0.13 Protected Media Baseline

P0.13 adds continuous USB recording as a **separate consumer of the already-published MediaMTX stream**. It intentionally does not modify the proven live-media core protected by `BASELINE-P0.13.sha256`:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Recording must never reopen the physical USB camera. The recorder reads the loopback MediaMTX RTSP path using a dedicated internal credential and writes finalized MP4 segments independently of live WebRTC/HLS playback.
