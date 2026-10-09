# CCTV Monitor P0.16 Changelog

## Added
- Local person/vehicle detection using ONNX Runtime and Tiny YOLOv3.
- Per-camera AI enable/disable, confidence, sample interval, cooldown, person, and vehicle switches.
- `PERSON_DETECTED` and `VEHICLE_DETECTED` Operational Events.
- AI event snapshots with bounding boxes.
- AI event-to-recording links using the existing continuous-recording archive.
- AI context/details in Operational Events.
- Person/vehicle event types in Notification Rules; fresh defaults are disabled to prevent surprise alert spam.
- AI status in System and Camera Diagnostics.
- Schema v11 for AI settings, detections, and recording links.
- Optional `onnxruntime-node` 1.30.0 dependency so AI-native-runtime failures do not block the rest of CCTV Monitor.
- SHA-256-verified local model installer (`INSTALL-AI-MODEL-P0.16.cmd`).

## Privacy/scope
- Detection runs locally on the CCTV PC after the ONNX model/runtime are installed.
- No face recognition, identity matching, biometric enrollment, or person naming.
- No CCTV frame is sent to Gemini or another cloud model for P0.16 detection.
- AI detection is OFF by default.

## Preserved
- P0.15 mobile/tablet Viewer UX.
- P0.14.3 queued SMTP notifications and earlier notification features.
- P0.14.x motion, snapshots, zones, and review.
- P0.13.x continuous recording, playback, storage, and safe retention.
- P0.12 sessions/security/audit.
- 5–8 character new/changed-password policy.
- Protected live-media baseline files unchanged.
