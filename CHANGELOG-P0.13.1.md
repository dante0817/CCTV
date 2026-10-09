# CCTV Monitor P0.13.1 — Recording Management, Storage & Safe Retention

P0.13.1 builds on the P0.13 Continuous USB Recording MVP without changing the protected live-media core.

## Added
- Recording protection/lock flag; protected footage cannot be manually or automatically deleted.
- Individual and bulk deletion of finalized, unlocked indexed recordings.
- Recording browser filters by camera/date and protected-only state.
- SQLite schema v6 with recording protection, retention policy and quarantine metadata.
- Opt-in retention policy with three independent thresholds:
  - maximum age in days,
  - maximum indexed recording storage,
  - minimum free disk space.
- Safe retention engine: oldest finalized/unlocked/indexed footage is considered first.
- Automatic retention remains disabled by default after migration.
- Manual “Run retention now” uses the same safety rules as automatic retention.
- Recording reconciliation and health summary for missing/corrupt/quarantined/protected footage.
- Lightweight MP4 signature validation before a recording is treated as healthy/playable.
- Crash-leftover newest files remain quarantined and are never retention candidates.
- Storage screen now reports retention availability and recording-health counts.
- Admin audit entries for protection, deletion, retention policy changes, retention runs and reconciliation.

## Safety invariants
- Active newest segment is not indexed and cannot be retention-deleted.
- Protected footage is excluded from deletion and retention.
- Quarantined/unknown files are excluded from deletion and retention.
- All managed recording paths are constrained under the configured recordings root.
- Camera deletion remains blocked while any recording files exist.
- RTSP/Tenda recording is still not enabled; USB is the qualified recording source.

## Deferred
Motion/event-triggered recording, clip export, RTSP/Tenda recording, audio recording, PTZ and two-way audio remain outside P0.13.1.
