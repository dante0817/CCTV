# Implementation Status — P0.12

## Implemented
- Database schema v4 security migration.
- Persistent, hashed, revocable browser sessions.
- Session-bound media authorization and security-version invalidation.
- Own-session and Admin session management APIs/UI.
- Stronger new/changed-password policy.
- Per-user AI grants.
- Sanitized/filterable Audit logs.
- Login throttling and trusted-loopback proxy address handling.
- P0.12 security regression coverage.

## Preserved
- P0.11.2 Operational Events.
- P0.11.1 runtime truth/diagnostics.
- P0.11 RTSP/Tenda software foundation.
- Protected USB/WebRTC/HLS media baseline.

## Hardware/runtime qualification required
Run `npm run check`, `npm run test`, `npm run build`, start the application, then run `QUALIFY-P0.12.cmd` on the Windows CCTV PC.
