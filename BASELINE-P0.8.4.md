# P0.8.4 known-good remote-viewing baseline

P0.9 was forked from `cctv-monitor-p0.8.4-hls-stability.zip`. The media path is intentionally frozen while deployment/reliability work is added around it.

Known-good media invariants:

- USB webcam capture owned by CameraProcessManager / one FFmpeg process per camera.
- CFR H.264 output from FFmpeg.
- MediaMTX RTSP publish on loopback `127.0.0.1:8554`.
- MediaMTX Control API on loopback `127.0.0.1:9997`.
- MediaMTX HLS on loopback `127.0.0.1:8888`.
- `hlsVariant: lowLatency`.
- `hlsSegmentDuration: 1s`.
- `hlsPartDuration: 500ms`.
- HTTPS/Tailscale Serve clients use the authenticated same-origin HLS proxy.
- direct HTTP LAN/Tailscale clients may prefer WebRTC and fall back to HLS.

Before calling a P0.9 change good, compare behavior against this baseline: local live view, remote Serve login/live video, browser refresh/reconnect, unauthorized media denial, and one FFmpeg publisher per USB camera.

See `BASELINE-P0.8.4.sha256` for the media-critical file hashes captured when P0.9 was created.
