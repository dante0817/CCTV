# P0.13.1 Protected Media Baseline

P0.13.1 adds recording management and opt-in safe retention around the P0.13 recorder. It does **not** modify the proven live-media core protected by `BASELINE-P0.13.1.sha256`:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Run `npm run test:baseline` before qualification. These hashes must remain unchanged unless a separately reviewed media-core change is intentionally approved.
