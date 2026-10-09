# P0.10 implementation status

## Completed in this build

- Admin + Viewer role model.
- Legacy Operator migration.
- Central permission matrix.
- Default-deny Viewer camera access.
- Per-camera Live View and Recordings assignments.
- Backend authorization for management and system endpoints.
- Sanitized Viewer camera payloads.
- Existing short-lived media-token authorization retained.
- Users, Camera Access, My Cameras, My Account, and Audit & Logs interfaces.
- Viewer direct-to-Live landing and tablet kiosk mode.
- Viewer recording filtering and Admin-only download/export controls.
- Bounded audit history (latest 5,000 entries).
- Upgrade-safe autostart task migration.
- P0.10 qualification helper.

## Validation completed here

- TypeScript/TSX syntax transpilation: **41 files, 0 syntax errors**.
- Role/access/security regression checks: **PASS**.
- MediaMTX security-configuration regression: **PASS**.
- Reliability/access-control invariant regression: **PASS**.
- P0.8.4 MediaMTX YAML and FFmpeg media-critical files remain unchanged.

## Validation still required on the Windows CCTV PC

The package registry was not reachable in this build environment, so a fresh dependency install and full Vite production build must be performed by the existing Windows launcher. Hardware/network checks also remain target-PC gates:

- `npm install` / production build through the launcher;
- Admin and Viewer login/view separation;
- Viewer camera assignment and revocation behavior;
- Viewer recording assignment behavior;
- desktop and tablet live playback;
- Tailscale Serve HTTPS/HLS playback;
- webcam unplug/replug and forced FFmpeg recovery;
- 2–4 simultaneous viewers;
- reboot/autostart behavior;
- 8–24 hour unattended soak test.

## Known scope limit

The current Recordings screen still uses the app's existing sample/mock clip dataset; P0.10 applies role/camera visibility and download/export controls to that surface, but it does not add a new real recording-index backend. Live camera authorization is real and backend-enforced.
