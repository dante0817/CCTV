# CCTV Monitor P0.11.1 — Runtime Observability & Stability

P0.11.1 is a deliberately narrow stabilization release built on the working P0.11 USB + RTSP architecture. It does not add recording, motion, ONVIF, PTZ, audio/intercom, or persistent operational events.

## Implemented

- Replaced noisy MediaMTX path-specific readiness polling with `/v3/paths/list` discovery, so a path that does not exist yet during startup is treated as a normal STARTING condition instead of generating repeated MediaMTX `ERR [API] path not found` messages.
- Added explicit camera runtime state metadata: state, reason, state timestamp, online/offline timestamps, worker PID/start time, stream readiness, reader count, retry timing, recovery counts, and circuit-breaker state.
- Defined ONLINE from a ready MediaMTX stream path rather than from FFmpeg process existence alone.
- Added supervisor detection for the stuck state “FFmpeg alive but MediaMTX stream not ready.” One failed supervisor observation marks DEGRADED; a repeated observation recycles the worker and enters controlled recovery.
- Extended recovery backoff to 2/5/15/30/60 seconds with jitter and added a circuit breaker after repeated failures to prevent restart storms.
- Added startup reconciliation so persisted ONLINE/RETRYING state from an abnormal prior shutdown is not trusted on the next process start.
- Improved graceful shutdown so pending recovery timers are cleared before camera workers and owned MediaMTX are stopped.
- Added `StorageService` for real host-volume capacity, free/used space, directory writability, and SQLite database size.
- Added `SystemStatusService` as the authoritative status aggregator instead of assembling dashboard truth directly in route/UI code.
- Added read-only system and per-camera diagnostic APIs.
- Added minimal public `/api/health` liveness endpoint while keeping detailed diagnostics authenticated.
- Updated Dashboard, Storage, Diagnostics, Live View and Camera Management status presentation to understand the new runtime state.
- Replaced mock Events presentation with an explicit P0.11.2 placeholder. Existing security/user Audit remains separate.
- Added P0.11.1 source tests and a Windows qualification script.
- Preserved the protected MediaMTX configuration, FFmpeg service and browser CameraPlayer byte-for-byte.

## Deferred intentionally

- Persistent operational events: P0.11.2
- Session/security/audit hardening: P0.12
- Continuous recording/NVR: P0.13
- Playback/storage retention: P0.13.1
- Motion detection: P0.14
- Tablet/mobile polish: P0.15
- ONVIF discovery, PTZ, camera audio and two-way intercom: later capability work

## Hardware qualification required

The code-level release cannot prove Windows DirectShow hardware behavior in this build environment. Run `QUALIFY-P0.11.1.cmd` on the actual CCTV PC and complete its USB disconnect/reconnect, MediaMTX recovery, clean shutdown and soak-test gates before treating P0.11.1 as hardware-qualified.
