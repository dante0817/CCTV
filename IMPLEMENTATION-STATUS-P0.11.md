# CCTV Monitor P0.11 Implementation Status

## Implemented in source

- Existing USB ingest preserved.
- Generic RTSP ingest implemented.
- Tenda CP3 Pro RTSP preset implemented.
- RTSP probe-before-add workflow implemented.
- RTSP camera persistence and automatic restart implemented.
- RTSP credential encryption and Viewer redaction implemented.
- SQLite schema migration tracking implemented (schema version 2).
- Dashboard/system status made authoritative for implemented runtime state.
- Storage volume reporting implemented; recording/retention explicitly marked unavailable.
- Media authorization now re-reads the current active user and current camera ACL.
- Source-level security, MediaMTX security, reliability and RTSP foundation tests pass in the packaging environment.
- Dependency versions pinned exactly in `package.json`.

## Not claimed as qualified in this package

This packaging environment has no Windows DirectShow camera, Tenda CP3 Pro, MediaMTX runtime or npm registry access. Therefore the following must be completed on the actual CCTV PC before P0.11 is considered hardware-qualified:

1. `npm install` once to generate/retain `package-lock.json` (then use `npm ci`).
2. `npm run check`, `npm run test`, and `npm run build` with the installed project dependencies.
3. Existing USB-camera regression through WebRTC and HLS fallback.
4. Tenda CP3 Pro RTSP Test Connection, Add & Start, restart persistence and remote viewing.
5. USB + Tenda simultaneous operation.
6. camera/router/MediaMTX restart recovery.
7. 8–24 hour unattended soak test.

Use `QUALIFY-P0.11.cmd` as the release checklist.

## Security/recovery note

Back up `data/.credential-key` together with the database. If that key is lost, encrypted RTSP passwords cannot be decrypted and the affected network cameras must be reconfigured.

Revoking camera access or disabling a Viewer is revalidated for subsequent MediaMTX authorization requests. An already-established media connection may still require disconnect/reconnect or explicit reader termination; full active-reader termination is reserved for the later session-control hardening stage.
