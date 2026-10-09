# P0.10 media baseline

P0.10 intentionally preserves the proven P0.8.4/P0.9 media pipeline. `CameraPlayer.tsx` has one authorization-facing change: playback may begin when `stream_available` is true even when the Viewer camera-list payload omits the raw `stream.path`. The player still obtains the actual path only from the authenticated stream-token endpoint.

Frozen media-critical expectations:

- MediaMTX Low-Latency HLS remains enabled.
- `hlsPartDuration` remains `500ms`.
- RTSP publish, HLS origin, and MediaMTX Control API remain loopback-bound where configured by this release.
- FFmpeg keeps constant-frame-rate H.264 output used by the working USB-camera path.
- WHEP remains preferred for direct HTTP LAN/VPN access.
- HTTPS/Tailscale Serve uses the authenticated same-origin HLS fallback.
- MediaMTX reads still require short-lived CCTV-issued path-scoped tokens.

See `BASELINE-P0.10.sha256` for the current media-critical hashes.
