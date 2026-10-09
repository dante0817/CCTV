# P0.12 Protected Media Baseline

P0.12 intentionally preserves the proven media-delivery core. `BASELINE-P0.12.sha256` protects:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Security/session/audit work must not silently change these files. Run `npm run test:baseline` before qualification.
