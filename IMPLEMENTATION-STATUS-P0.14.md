# CCTV Monitor P0.14 Implementation Status

Implemented in software:
- schema v7 migration;
- persistent per-camera motion settings;
- FFmpeg scene-change motion analyzer from MediaMTX;
- sensitivity/cooldown controls;
- transition-safe motion event creation;
- persisted motion detections;
- event↔recording link table;
- on-demand and periodic linking to finalized overlapping recordings;
- Event UI linked-footage lookup/playback;
- camera/system motion diagnostics;
- P0.13.1 recording/retention and P0.12 session/audit functionality retained;
- 5–8 character new/changed password policy retained.

Requires real Windows hardware qualification:
- false-positive behavior in the actual room/lighting;
- USB motion analyzer CPU load;
- unplug/replug recovery;
- motion-event timing relative to 60-second MP4 segments;
- browser playback of linked footage;
- long-duration motion analyzer soak test.
