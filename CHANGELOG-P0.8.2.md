# P0.8.2 — Tailscale Serve secure-playback fix

- Detects HTTPS reverse-proxy access, including Tailscale Serve via `X-Forwarded-Proto`.
- Avoids blocked mixed-content WebRTC signaling (`https://` CCTV page calling plain `http://...:8889`).
- Uses the existing authenticated same-origin HLS proxy immediately when the UI is opened through HTTPS.
- Keeps WebRTC preferred for direct HTTP LAN/Tailscale access where the browser can reach MediaMTX signaling normally.
- No router port forwarding, Funnel, or public exposure is added.
