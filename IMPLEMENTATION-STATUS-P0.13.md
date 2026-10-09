# Implementation Status — P0.13

## Implemented
- USB continuous recorder reading from loopback MediaMTX RTSP.
- MP4 segment output and SQLite recording index (schema v5).
- Persistent recording intent and automatic resume after live camera recovery.
- Internal recorder MediaMTX authentication.
- Per-camera recording ACLs, authenticated listing/playback and Admin download.
- Real Recordings UI and recording-aware Dashboard, Storage and Diagnostics.
- Graceful stop/finalization, retry/backoff and operational recording events.
- Crash-leftover quarantine and camera-delete safeguards.
- P0.13 recording regression test plus all inherited P0.11/P0.12 regression invariants.

## Intentionally deferred
- RTSP/Tenda recording qualification.
- Retention/automatic deletion.
- Motion/event-triggered recording.
- Clip export/bookmark/protect workflow.
- Audio recording, PTZ and two-way audio.

## Required Windows hardware gate
Run `VERIFY-P0.13-COMPLETE.cmd`, start the app, then run `QUALIFY-P0.13.cmd`. P0.13 must be qualified with the actual USB camera before being frozen as known-good.
