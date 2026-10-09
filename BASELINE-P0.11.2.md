# Protected Media Baseline — P0.11.2

P0.11.2 adds operational-event persistence around the qualified runtime state machine. It intentionally leaves the known-working media core unchanged. `BASELINE-P0.11.2.sha256` protects:

- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Any hash change in those files requires a separate media-core review and hardware qualification.
