# P0.8.3 — HLS compatibility fix

- Changed MediaMTX fallback HLS from `lowLatency` to `fmp4`.
- Explicitly uses 1-second HLS segments.
- Eliminates LL-HLS part-duration timing from the remote fallback path, addressing the observed iOS compatibility warning when part duration drifted from 200 ms to 234 ms.
- Keeps the HLS origin bound to `127.0.0.1:8888` and available to browsers only through the authenticated CCTV proxy.
- Keeps WebRTC preferred for direct HTTP LAN/Tailscale viewing; secure Tailscale Serve / HTTPS viewing continues to use authenticated HLS fallback.
