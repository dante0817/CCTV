# P0.9 implementation status

## Implemented

- P0.8.4 remote-media baseline frozen and hash-checked.
- Production frontend/server build scripts and production launcher.
- Windows autostart install/remove/status helpers.
- Conservative at-sign-in autostart plus explicit experimental SYSTEM-at-boot qualification mode.
- MediaMTX single-start lock and automatic recovery.
- Per-camera single-start lock.
- Bounded camera recovery (2 s, 5 s, 15 s, 30 s) with retry/recovery metadata.
- 15-second media/camera reliability supervisor.
- Rotating application/media/recovery logs with redaction.
- Tailscale Serve detection in diagnostics.
- Application uptime, runtime mode, active media sessions, and recovery counts.
- Admin-only redacted ZIP support bundle.
- Camera restart action in Diagnostics.
- Restricted Operator system status to only cameras the account may access.
- P0.9 qualification and regression helpers.
- Optional cleanup of the temporary direct Tailscale TCP 3000 firewall rule after Serve qualification.

## Validation completed in the build environment

- P0.8.4 media-critical hash verification: PASS.
- TypeScript/TSX syntax transpilation: 37 files, 0 syntax errors.
- Authentication/media-token regression: PASS.
- MediaMTX security-configuration regression: PASS.
- P0.9 static reliability/security invariants: PASS.
- Support ZIP creation/extraction test: PASS.
- Final release ZIP integrity test: PASS.

## Validation that must run on the Windows CCTV PC

The build environment could not reach the npm registry, so a full dependency install / Vite production build could not be executed here. `START-CCTV-MONITOR-PRODUCTION.cmd` performs dependency synchronization and `npm run build` on the target PC.

Hardware/network release gates remain intentionally manual:

- production build/start on Windows,
- existing remote Tailscale Serve HLS playback,
- webcam unplug/replug recovery,
- forced FFmpeg recovery,
- 2–4 concurrent viewers,
- reboot/autostart behavior,
- experimental pre-login/SYSTEM startup only if desired and proven with the actual DirectShow webcam,
- 8–24 hour unattended soak test.
