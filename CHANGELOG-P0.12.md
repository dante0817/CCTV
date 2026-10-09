# CCTV Monitor P0.12 — Security, Sessions & Audit Hardening

## Added
- SQLite-backed persistent authentication sessions with SHA-256 token hashes.
- User and Admin active-session views and revocation controls.
- Session-bound media tokens plus per-user security-version revalidation.
- 12-character minimum for newly created/changed passwords.
- Per-user AI access grants; new Viewers default to disabled.
- Filterable Audit UI and recursive secret redaction.
- Proxy-aware client address handling for trusted loopback reverse proxies.
- Combined IP and IP/username login throttling.
- Schema migration v4.

## Changed
- Password, role, status and selected security changes invalidate sessions/security epochs as appropriate.
- Current identity refreshes periodically so role/status/AI changes take effect without a full reload.
- Media authorization now checks the current user, current camera ACL, active browser session and security version.

## Preserved
- P0.11.2 Operational Events remain separate from Audit.
- Protected FFmpeg, MediaMTX configuration and CameraPlayer files are unchanged.

## Deferred
- Recording/NVR, motion detection, PTZ/audio and physical Tenda qualification remain outside P0.12.
- An already-established WebRTC connection may continue until that connection closes; session revocation blocks subsequent API calls and new media reads.
