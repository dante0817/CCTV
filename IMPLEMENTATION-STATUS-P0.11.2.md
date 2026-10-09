# Implementation Status — P0.11.2

## Implemented
- Real operational-event persistence in SQLite.
- Camera events derived from actual runtime state transitions, not repeated supervisor observations.
- Duplicate OFFLINE polling does not generate duplicate events.
- MediaMTX outage/recovery transition events.
- Storage warning/recovery transition events.
- Event query, filtering, acknowledgement, Dashboard activity and Header alert surfaces.
- Event acknowledgement is written to Audit without merging Operational Events and Audit datasets.
- Schema version advanced to v3.
- P0.11.1a strict-TypeScript hotfix included.

## Protected media core
The FFmpeg service, MediaMTX configuration and browser CameraPlayer remain unchanged and are covered by `BASELINE-P0.11.2.sha256`.

## Qualification still required on the CCTV PC
Run `npm run check`, `npm run test`, `npm run build`, then `QUALIFY-P0.11.2.cmd`. Physically verify USB unplug/replug produces exactly one offline event and one recovery event, and that events survive an application restart.
