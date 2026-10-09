# CCTV Monitor P0.14.3 Protected Media Baseline

P0.14.3 adds queued SMTP email delivery, retry/backoff, encrypted mail credentials, and delivery history around the P0.14.2 notification rule engine. The known-good live media core remains protected and unchanged.

Protected files:
- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`
