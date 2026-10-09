# CCTV Monitor P0.8 — Private Remote Viewing

## Implemented

- Added first-admin bootstrap restricted to the CCTV server loopback address.
- Added SQLite-backed Admin / Operator / Viewer accounts.
- Added scrypt password hashing and HttpOnly SameSite=Strict application sessions.
- Added per-camera access lists for non-admin users.
- Added rate limiting for repeated failed logins.
- Added short-lived, HMAC-signed, path-scoped media tokens.
- Switched MediaMTX to external HTTP authorization through CCTV Monitor.
- Local FFmpeg publishers are accepted only from loopback; anonymous remote stream reads are rejected.
- Added runtime stream configuration so camera records do not store LAN/Tailscale URLs.
- WebRTC/WHEP remains primary playback.
- Added one WebRTC retry followed by automatic HLS fallback.
- Added same-origin authenticated HLS proxy; MediaMTX HLS origin is loopback-only.
- Kept MediaMTX Control API loopback-only.
- Kept RTSP publisher listener loopback-only for the USB-camera release.
- Added Tailscale status/MagicDNS/IP detection to backend diagnostics.
- Added Remote Access status to Settings/Diagnostics.
- Replaced prototype remote/HTTPS toggles with live runtime status and deployment guidance.
- Added `CHECK-REMOTE-ACCESS.cmd` and `scripts/check-remote-access.ps1`.
- Added optional Tailscale-scoped Windows firewall helper for TCP 3000, TCP 8889, and UDP 8189.
- Updated startup health checks to use `/api/v1/health` instead of the now-protected diagnostics endpoint.
- Added security regression tests for password/media-token/camera-permission behavior.
- Enforced restricted Operator camera permissions on start/stop/restart/delete actions and added editing of existing user camera access in the Admin UI.
- Restricted the MediaMTX authorization callback itself to loopback callers and filtered AI operational context by the signed-in user's camera access.
- Added a MediaMTX configuration hardening regression test.
- Existing running MediaMTX instances are checked for required HTTP media authorization and patched through the loopback Control API when possible.

## Retained from P0.7

- one backend-owned FFmpeg process per USB webcam;
- DirectShow device/format enumeration;
- probe-before-save/start workflow;
- runtime-tested H.264 encoder selection;
- automatic camera-worker restart handling;
- MediaMTX path readiness checks;
- real camera state rather than simulated UI success.

## Deferred

- public Internet hosting;
- router port forwarding;
- Tailscale Funnel;
- Cloudflare Tunnel;
- public TURN/STUN infrastructure;
- HTTPS/Tailscale Serve;
- persistent server-side login sessions across application restart;
- production Windows service/installer;
- 24/7 soak qualification on target hardware.
