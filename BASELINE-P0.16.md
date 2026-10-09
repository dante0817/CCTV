# P0.16 Protected Media Baseline

P0.16 adds local AI person/vehicle detection as a separate consumer of the existing MediaMTX stream. These proven live-media files remain protected and unchanged:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Verify with `npm run test:baseline` or `node scripts/verify-baseline.mjs`.
