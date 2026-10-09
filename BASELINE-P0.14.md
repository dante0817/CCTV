# CCTV Monitor P0.14 Protected Media Baseline

P0.14 preserves the known-good live media core while adding a separate motion-analysis consumer. The following files must remain byte-for-byte identical to the protected baseline:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Use `npm run test:baseline` or `node scripts/verify-baseline.mjs` to verify.
