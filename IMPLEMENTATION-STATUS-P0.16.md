# P0.16 Implementation Status

Implemented in software:
- schema v11 AI settings/detection/link tables;
- local ONNX detector supervisor;
- Tiny YOLOv3 preprocessing/postprocessing for COCO person and selected vehicle classes;
- per-type cooldown aggregation;
- person/vehicle Operational Events;
- authenticated AI snapshots with boxes;
- event-linked recording lookup;
- Camera UI AI settings;
- Events AI details;
- Notification Rule person/vehicle types;
- Diagnostics integration;
- best-effort verified model installer;
- optional ONNX Runtime dependency.

Still requires real Windows/USB qualification:
- actual ONNX Runtime native initialization on the CCTV PC;
- real person/vehicle detection accuracy;
- CPU/RAM load at different sample intervals;
- nighttime/low-light false positives;
- long-run coexistence with WebRTC, continuous recording, motion detection, retention, and SMTP notifications.

RTSP/Tenda AI detection remains unqualified until the network camera hardware is available.
