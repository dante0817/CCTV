# CCTV Monitor P0.11.2 — Operational Events

P0.11.2 builds directly on P0.11.1a runtime stability. It persists real operational state transitions without changing the protected USB/WebRTC/HLS media core.

## Added
- SQLite schema migration v3 with dedicated `operational_events` table.
- Separate `OperationalEventRepository` and `OperationalEventService`.
- Transition-driven camera events: `CAMERA_ONLINE`, `CAMERA_OFFLINE`, `CAMERA_RECOVERED`, `CAMERA_DISABLED`, `CAMERA_ENABLED`, and `CAMERA_ERROR`.
- System events for MediaMTX outage/recovery and server startup.
- Storage warning/recovery events based on writability and <=10% free-space threshold.
- `/api/v1/events` query API and event acknowledgement endpoint.
- Real Events screen with category/severity/acknowledgement filters and search.
- Real Dashboard recent operational activity.
- Header alert indicator now reflects unacknowledged warning/critical events.
- Recent operational events are included in the Admin support bundle.
- P0.11.2 event regression test.

## Kept separate by design
Security/user activity remains in the existing Audit subsystem. Operational events describe CCTV/system state; audit entries describe human/security actions.

## Still deferred
Recording/NVR, motion detection, notifications, ONVIF discovery, PTZ commands, audio/intercom, and Tenda physical qualification.
