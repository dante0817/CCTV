# CCTV Monitor P0.14.1 Changelog

## Added
- Schema v8 migration for motion zones, snapshot references, and motion-event reviews.
- Up to four rectangular zones per USB camera.
- Per-zone enable/disable and optional sensitivity override.
- Whole-frame fallback when no zones are configured.
- Authenticated JPEG motion snapshots from the existing MediaMTX stream.
- Zone highlight overlay on snapshots.
- Motion-event context API with zone, scene score, sensitivity, snapshot availability, and review status.
- Review workflow: Unreviewed / Confirmed / Dismissed plus reviewer note.
- Zone-aware motion titles/metadata and historical zone-name preservation.
- Snapshot orphan cleanup on motion-service startup.

## Preserved
- Protected USB capture / MediaMTX / WebRTC-HLS live path.
- P0.13 recording and P0.13.1 safe retention.
- P0.14 event-linked recording behavior.
- 5–8 character policy for newly created/changed passwords.

## Deferred
- Polygon/freehand zones.
- Person/vehicle AI classification.
- Push notifications.
- RTSP/Tenda motion hardware qualification.
- PTZ and two-way audio.
