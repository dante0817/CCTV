# CCTV Monitor P0.8.4 — HLS Stability Fix

This release fixes the blank remote video regression introduced in P0.8.3.

## Changes

- Restores MediaMTX `hlsVariant: lowLatency`, the mode already proven on the Android/Tailscale Serve path.
- Sets `hlsPartDuration: 500ms` to reduce sensitivity to USB-camera timestamp variation.
- Forces FFmpeg CFR output with `-r <configured fps> -fps_mode cfr`.
- Keeps H.264 B-frames disabled and the existing authenticated HLS proxy.
- Keeps Tailscale Serve HTTPS behavior: secure-origin clients use HLS fallback, while direct HTTP LAN/Tailscale clients may still prefer WebRTC.

## Upgrade

Copy the existing `data\` directory and `.env` (if present) from P0.8.3/P0.8.2 into this release before starting it.
