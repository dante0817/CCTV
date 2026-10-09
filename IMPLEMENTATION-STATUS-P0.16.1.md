# P0.16.1 Implementation Status

Implemented in software:
- schema v12 migration;
- AI performance presets and custom tuning;
- separate person/vehicle confidence thresholds;
- motion-gated inference and optional motion-zone scope;
- source-aspect-aware zone mapping for letterboxed ONNX input;
- runtime-only pause/resume;
- overload backoff;
- AI process/runtime metrics;
- persisted AI review feedback and per-camera review statistics;
- labeled browser overlays on AI snapshots;
- AI context/snapshot/review ACL hardening;
- inherited P0.13–P0.16 regression coverage.

Still requires real Windows/USB qualification:
- CPU and RAM impact for each profile;
- real motion-gated wake-up latency;
- zone accuracy on actual 16:9 camera frames;
- false-positive behavior in daylight/night lighting;
- long-run coexistence with recording, WebRTC, motion, notifications, and SMTP;
- optional ONNX Runtime native initialization on the target PC.

RTSP/Tenda AI remains unqualified until actual network-camera hardware is available.
