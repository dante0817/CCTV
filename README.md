# CCTV Monitor P0.16.1 — AI Tuning, Review & Performance Controls

P0.16.1 retains the complete P0.16 local person/vehicle detection foundation and makes it practical to tune and operate on a real CCTV PC without changing the proven live-media pipeline.

## Fresh install
Run `FIRST-RUN-P0.16.1.cmd` from a newly extracted folder.

Normal startup remains `START-CCTV-MONITOR.cmd`.

Software verification: `VERIFY-P0.16.1-COMPLETE.cmd`

Real USB/AI qualification: `QUALIFY-P0.16.1.cmd`

## AI controls
Per USB camera, an Admin can select:
- Low CPU, Balanced, High Accuracy, or Custom profile;
- separate Person and Vehicle confidence thresholds;
- sampling interval and event cooldown;
- Continuous sampling or Only after motion;
- an optional enabled motion zone as the AI scope;
- temporary Pause 15m / Resume.

Profile presets tune cadence and thresholds; they do not replace or change the Tiny YOLOv3 model architecture.

## Motion-gated AI
When `Only after motion` is selected, no ONNX inference runs until a persisted motion detection occurred within the configured gate window. If a motion zone is selected, that zone must have triggered and accepted AI boxes must have their center inside the same zone.

This reduces unnecessary CPU use in quiet scenes.

## Review feedback
AI events can be marked:
- Confirm Person
- Confirm Vehicle
- False Detection
- Unreviewed

Each review supports a note and records reviewer/time. Camera settings show reviewed counts and false-positive rate among reviewed AI events. This feedback is for operational tuning only; P0.16.1 does not train or fine-tune the model automatically.

## Performance safeguards
Runtime metrics include inference time, rolling average, samples/minute, skipped samples, AI process CPU estimate, process RSS, system-memory utilization, and load-backoff state.

If inference becomes too slow relative to its configured cadence or system memory reaches a critical level, the AI sampler temporarily backs off. Live view, recording, motion detection, and notifications remain separate.

## AI prerequisites
`onnxruntime-node` remains an optional dependency. The model is installed separately and SHA-256 verified.

Retry model installation with `INSTALL-AI-MODEL-P0.16.1.cmd`.

Expected model SHA-256:
`f715cc2d99740d22d312777e20d9de2b2ecdc250155be8fd3752ce7e8b823521`

If ONNX Runtime needs repair, run `REPAIR-AI-RUNTIME-P0.16.1.cmd`.

## Privacy / scope
- Local person/vehicle object detection only.
- No face recognition, identity matching, biometric enrollment, or person naming.
- Routine P0.16.1 AI frames are not sent to Gemini/cloud.
- AI is OFF by default.

## Existing features preserved
P0.15 phone/tablet Viewer UX, queued SMTP alerts, notification rules, motion snapshots/zones/review, continuous recording/playback/safe retention, persistent sessions/security/audit, and RTSP/Tenda-ready streaming architecture remain included.

New/changed passwords remain 5–8 characters per the requested development policy.
