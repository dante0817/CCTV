# CCTV Monitor P0.6 — USB Setup Workflow & Validation

## USB camera setup

- The Add USB Camera screen now prefers **1920×1080 @ 30 FPS** when the webcam reports it, then falls back to other practical 1080p/720p modes instead of automatically choosing the largest resolution.
- Exact DirectShow frame rates such as `60.0002` are retained internally while the UI displays a clean value such as `60 FPS`.
- Bitrate is now resolution/FPS-aware. **Auto** selects a practical H.264 target for the selected mode, while manual bitrate presets remain available.
- Camera input and stream output are now presented as separate stages:
  - **Camera Capture** — DirectShow input format, resolution, FPS.
  - **Stream Output** — H.264 encoder, bitrate, MediaMTX/WebRTC path.
- Encoder **Auto** now shows the encoder it will actually prefer (NVENC, Quick Sync, AMF, or libx264) based on detected FFmpeg capabilities.
- Dell USB hardware VID `413C` is identified as **Dell** in the device list.

## Validation and save behavior

- Added a persistent **Camera Validation** panel for hardware, capture probe, FFmpeg worker, MediaMTX publish, and WebRTC gateway stages.
- Probe validity is tied to the exact capture settings: device ID, width, height, FPS, and input format.
- Changing capture settings after a successful probe immediately marks that probe as stale and disables **Save & Start** until the new mode is tested.
- Encoder/bitrate changes do not invalidate the DirectShow capture probe because they belong to the later stream-output stage.
- **Save Configuration** can store a camera without opening it. It remains `configured` and disabled until explicitly started.
- **Save & Start** requires a current successful capture probe. The backend independently re-probes before launching the persistent stream.
- Initial **Save & Start** is transactional: if capture or stream startup fails, the temporary camera record is removed instead of leaving duplicate/error entries behind.
- Starting or restarting an already-saved USB camera also performs a real capture probe first.
- Raw FFmpeg details are hidden behind **Show technical details** while the primary error message remains actionable.

## Browser-camera test

- Removed browser `getUserMedia()` preview from the Add USB Camera flow so it cannot accidentally test the wrong client device or hold the server webcam open.
- Added **Diagnostics → Browser Media Test** instead. It is explicitly labeled as a test of the camera attached to the current browser device, not the CCTV server's DirectShow camera.

## Cleanup

- Removed the duplicate legacy USB camera setup component; the app now has one authoritative DirectShow onboarding flow.
- Updated the Vite alias to use `import.meta.dirname`, eliminating the Vite native-config warning about `__dirname`.
- H.264 GOP calculation now rounds exact fractional DirectShow FPS values to an integer GOP size.
