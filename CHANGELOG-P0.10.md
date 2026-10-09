# CCTV Monitor P0.10 — Role-Based Access

P0.10 is an authorization/UI upgrade on top of the P0.9 deployment-reliability release. The known-good P0.8.4/P0.9 USB webcam, FFmpeg, MediaMTX, WebRTC and Low-Latency HLS behavior is intentionally preserved.

## Implemented

- Reduced the active role model to **Admin** and **Viewer**.
- Added one-time migration of legacy **Operator** accounts to Viewer.
- Added central role-permission policy shared by frontend/server code.
- Added relational `user_camera_access` records with separate Live View and Recordings flags.
- New Viewer accounts default to **no cameras**.
- Recording permission implies live-camera visibility for the same camera.
- Added backend permission middleware for camera creation/lifecycle, user administration, system status, audit, AI access, and media access.
- Viewer camera API responses remove raw USB source configuration and direct stream metadata.
- Existing path-scoped, short-lived MediaMTX read tokens remain in force.
- Added Admin **Camera Access** screen.
- Simplified **Users** screen and made disable/enable the normal account lifecycle action.
- Added Viewer **My Cameras** and **My Account** screens.
- Added Viewer direct-to-Live-View login behavior.
- Added Viewer tablet **Kiosk mode**.
- Added persistent, bounded audit history for security-relevant actions.
- Added Admin **Audit & Logs** screen and audit data in support bundles.
- Viewer recording list is filtered to permitted cameras; download/export controls remain Admin-only.
- Changed Windows autostart task name to stable `CCTV Monitor`; installer removes the legacy `CCTV Monitor P0.9` task.
- Added `QUALIFY-P0.10.cmd` role/access qualification gates.

## Compatibility / migration

The existing `users` table is retained. P0.10 adds `user_camera_access` and migrates legacy JSON access into explicit rows. Existing Admin accounts retain full access. Existing Viewer/Operator camera access is preserved as explicit live access, while recording access starts empty unless assigned in P0.10.

## Media-path constraint

P0.10 changes `CameraPlayer.tsx` only so a sanitized Viewer camera record can start playback using the authorized token endpoint without receiving the raw stream path in the camera list. WHEP/HLS connection logic, LL-HLS settings, RTSP/HLS/API loopback binding, FFmpeg CFR behavior, and the authenticated HLS proxy are unchanged.
