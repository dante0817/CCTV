# CCTV Monitor P0.5 — USB Camera Busy / DirectShow Lock Fix

## Fixed

- Browser webcam preview is now explicitly stopped before **Test Selected Mode**.
- Browser webcam preview is now explicitly stopped before **Save / Start Camera**.
- The `<video>` element is detached from its MediaStream when the preview stops.
- Added a short 700 ms Windows/UVC release delay before server-side DirectShow opens the webcam.
- Fixed stale browser-stream cleanup in the embedded USB-camera screen by tracking the active stream in a ref.
- After the server's registration probe succeeds, the backend now waits briefly before starting the persistent FFmpeg worker, preventing a probe-to-stream DirectShow race.
- FFmpeg errors containing `device already in use`, `Could not run graph`, `Error opening input`, or `I/O error` are now translated into a clear `DEVICE_BUSY_OR_GRAPH_ERROR` message.
- Raw FFmpeg tail output is retained as diagnostic details while the normal UI gets an actionable message.

## If the camera is still busy

Close any application that may own the camera, including Windows Camera, Teams, Zoom, OBS, browser tabs using camera permission, or another CCTV/FFmpeg process. Then wait a few seconds and retry.
