# CCTV Monitor P0.14.1 Protected Media Baseline

P0.14.1 preserves the known-good live media core while adding motion snapshots, rectangular zones, and event review around the separate motion-analysis pipeline.

The following protected files must remain byte-for-byte identical to the known-good baseline:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Use `npm run test:baseline` or `node scripts/verify-baseline.mjs` to verify.
