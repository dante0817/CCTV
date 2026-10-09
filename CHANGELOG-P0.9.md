# CCTV Monitor P0.9 — Deployment & Reliability

P0.9 is built on the known-good P0.8.4 remote-viewing path. It deliberately keeps the working USB → FFmpeg → MediaMTX → Low-Latency HLS → authenticated backend proxy → Tailscale Serve pipeline unchanged.

## Added

- Separate production runtime: prebuilt Vite frontend plus bundled Node server (`npm run build`, `npm run start:prod`).
- Windows production launcher (`START-CCTV-MONITOR-PRODUCTION.cmd`).
- Optional Scheduled Task autostart installer/remover/status helpers. Default autostart occurs at user sign-in; an explicit experimental SYSTEM-at-startup mode is available only for hardware qualification.
- 15-second reliability supervisor that restores MediaMTX and reconciles enabled cameras.
- Bounded camera recovery schedule: 2 s → 5 s → 15 s → 30 s periodic retry.
- Recovery counters, last-exit and last-recovery timestamps.
- Rotating server, MediaMTX, FFmpeg, camera-manager and recovery logs.
- Tailscale Serve status detection in system diagnostics.
- Runtime mode, uptime, active media-session and recovery-count diagnostics.
- Admin-only redacted ZIP support bundle export.
- Camera restart control in Diagnostics.
- P0.9 qualification helper and reliability regression test.
- Optional helper to remove the temporary direct Tailscale TCP 3000 firewall rule after Serve passes the release gates.

## Preserved intentionally

- `hlsVariant: lowLatency`
- `hlsSegmentDuration: 1s`
- `hlsPartDuration: 500ms`
- CFR webcam timing introduced in P0.8.4
- authenticated same-origin HLS proxy for Tailscale Serve
- short-lived path-scoped media tokens
- loopback-only MediaMTX RTSP/HLS/Control API surfaces

## Release gate

P0.9 should not be treated as qualified until the target Windows CCTV PC passes:

1. local + remote tablet live view,
2. webcam unplug/replug recovery,
3. forced FFmpeg recovery,
4. 2–4 simultaneous viewers while retaining one FFmpeg publisher per USB camera,
5. reboot/autostart recovery,
6. 8–24 hour unattended soak test.

The default Scheduled Task starts at Windows sign-in because USB DirectShow behavior in a noninteractive SYSTEM session must be proven on the actual hardware before enabling the experimental startup mode.
