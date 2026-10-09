# Protected Media Baseline — P0.11.1

P0.11.1 intentionally preserves the known-working media core inherited from P0.10/P0.11. The SHA-256 values in `BASELINE-P0.11.1.sha256` must remain unchanged unless a separately qualified media-core release explicitly replaces them.

Protected files:
- `tools/mediamtx/mediamtx.yml`
- `src/server/services/FfmpegService.ts`
- `src/components/live/CameraPlayer.tsx`

Run:

```powershell
npm run test:baseline
```

or:

```powershell
node scripts/verify-baseline.mjs
```
