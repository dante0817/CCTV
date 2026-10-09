# P0.8.1 — Tailscale MagicDNS host fix

- Allows only the CCTV PC Windows hostname and its exact Tailscale MagicDNS hostname in the embedded Vite development server.
- Fixes HTTP 403 when opening `http://<machine>.<tailnet>.ts.net:3000`.
- Keeps Vite DNS-rebinding protection enabled; `allowedHosts: true` is intentionally not used.
- Tailscale IP access remains supported and requires no hostname allow-list entry.
