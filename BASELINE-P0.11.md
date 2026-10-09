# CCTV Monitor P0.11 Protected Media Baseline

P0.11 intentionally leaves the proven P0.10 media core unchanged while adding RTSP source orchestration around it.

Verify with:

```powershell
Get-FileHash tools\mediamtx\mediamtx.yml, src\server\services\FfmpegService.ts, src\components\live\CameraPlayer.tsx -Algorithm SHA256
```

Expected hashes are in `BASELINE-P0.11.sha256` and should match P0.10 exactly.
