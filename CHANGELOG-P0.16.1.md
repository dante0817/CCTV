# CCTV Monitor P0.16.1 Changelog

## Added
- AI performance profiles: Low CPU, Balanced, High Accuracy, and Custom.
- Separate Person and Vehicle confidence thresholds.
- Motion-gated AI mode so inference can run only after recent motion.
- Optional motion-zone scope; only a selected zone can arm AI and accepted detections must fall inside that zone.
- Temporary runtime-only AI pause/resume.
- Automatic AI load backoff when inference is too slow or system memory is critically high.
- AI runtime health metrics: last/average inference time, samples/minute, skipped samples, process CPU estimate, process RSS, system-memory use, backoff, and last successful inference.
- AI event review: Confirm Person, Confirm Vehicle, False Detection, Reset, reviewer note, reviewer identity, and review timestamp.
- Per-camera review statistics including false-positive rate among reviewed detections.
- Browser overlay labels for AI bounding boxes and confidence.
- Schema v12 for AI tuning/review metadata.

## Security hardening
- AI event context, AI snapshot, and AI review endpoints now enforce the same per-camera ACL boundary as motion-event review.

## Preserved
- Local-only object inference; no face recognition or identity matching.
- AI remains off by default.
- P0.15 mobile/tablet Viewer UX.
- P0.14.x motion, event review, local/browser/email notifications.
- P0.13.x recording/playback/retention.
- P0.12 sessions/security/audit.
- Requested 5–8 character new/changed-password policy.
- Protected MediaMTX/FFmpeg/CameraPlayer baseline unchanged.
