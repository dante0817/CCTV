# CCTV Monitor P0.7 — Encoder Runtime Validation

## Fixed

- `Auto` no longer assumes that an H.264 hardware encoder is usable merely because it appears in `ffmpeg -encoders`.
- NVIDIA NVENC, Intel QSV, AMD AMF, and libx264 are now runtime-tested with a short synthetic H.264 encode.
- Auto-selection chooses the first encoder that actually completes an encode on the current PC.
- Hardware encoders that are compiled into FFmpeg but unusable with the installed GPU/driver are shown as unavailable for selection.
- Explicitly selecting an unusable encoder now returns a clear `ENCODER_NOT_USABLE` error with the underlying FFmpeg reason.

## Why this was needed

On some Windows systems FFmpeg lists `h264_nvenc` even when the NVIDIA driver/GPU cannot create a working NVENC session. P0.6 therefore displayed `Auto — NVIDIA NVENC`, while the real camera capture succeeded and the streaming worker failed with `Invalid argument` before MediaMTX received any packets.

P0.7 separates **compiled encoder support** from **runtime encoder usability**.
