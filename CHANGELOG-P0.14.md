# P0.14 — Motion Detection & Event-Linked Recording

## Added
- Schema v7 motion configuration, motion detections and motion↔recording links.
- Per-camera USB motion settings: enabled, sensitivity, cooldown, pre-link and post-link windows.
- Separate low-resolution FFmpeg scene-change analyzer consuming MediaMTX RTSP.
- `MOTION_DETECTED` operational events with scene score/sensitivity metadata.
- Event-linked recording API and Event-screen linked-footage controls.
- Motion runtime state in camera and system diagnostics.
- Automatic analyzer stop/restart with camera availability.

## Safety / architecture
- Protected live-media files remain unchanged.
- Motion detection is off by default.
- Motion analysis does not open the USB webcam directly.
- Continuous recording remains the only footage archive; motion links reference finalized segments.
- P0.14 motion qualification is USB-only.

## Deferred
AI classification, zones, snapshots, notifications, RTSP/Tenda motion qualification, audio and PTZ.
