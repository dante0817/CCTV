# CCTV Monitor

**A self-hosted CCTV dashboard for viewing cameras, managing recordings, and reviewing motion and AI events from one local web app.** CCTV Monitor runs on your own PC, stores its operational data locally, and supports USB cameras plus live RTSP streams from network cameras.

This repository contains the P0.16.1 application source and Windows setup scripts. It is designed for a dedicated Windows CCTV PC; the browser UI can also be used from authorized devices on your private network.

## What it does

- View USB and RTSP network cameras in a responsive desktop, tablet, or phone interface.
- Record USB camera footage in MP4 segments, browse playback, and configure retention.
- Detect motion on supported USB cameras, define zones, and review event snapshots and footage.
- Optionally detect people and vehicles locally on USB camera feeds with Tiny YOLOv3 and ONNX Runtime. AI is off by default; frames used for this detection stay on the CCTV PC.
- Configure in-app notifications and optional SMTP email alerts with delivery history.
- Manage users, camera access, sessions, audit events, storage, and system diagnostics.
- Use Tailscale for private remote viewing while keeping the app behind its own sign-in.
- Optionally connect Gemini chat and voice features with a Gemini API key. These cloud features are separate from local object detection.

### Current feature scope

RTSP cameras support live viewing. Continuous recording, motion analysis, and local person/vehicle detection are currently qualified for USB cameras only. The app does not provide face recognition, identity matching, ONVIF discovery, PTZ control, or public internet access. Do not expose the CCTV PC by router port forwarding; use the supported private Tailscale network for remote access.

## Install on Windows

### Requirements

- Windows 10 or 11, 64-bit.
- Node.js 22.5 or later (the project supports Node.js versions below 26) with npm available in `PATH`.
- FFmpeg for USB camera discovery and capture. Install FFmpeg and add it to `PATH`, or set `FFMPEG_PATH` in `.env` to the full path to `ffmpeg.exe`.
- Internet access during setup to install Node packages and download MediaMTX. The optional AI model is downloaded separately and verified by SHA-256.

### First run

1. Install Node.js, then download this repository with **Code → Download ZIP** and extract it to a folder you can write to.
2. Install FFmpeg if you plan to use USB cameras. Confirm it works by running `ffmpeg -version` in PowerShell.
3. Double-click `FIRST-RUN-P0.16.1.cmd`. It installs dependencies, attempts the optional AI model download, runs the project checks and regression suite, builds the app, checks the local setup, and starts CCTV Monitor. The AI model download can fail without blocking the core app; AI will remain unavailable until the model is installed.
4. On the CCTV PC, open [http://localhost:3000](http://localhost:3000) and create the first administrator account. Initial setup is restricted to the CCTV PC. The current password policy accepts 5–8 characters.
5. Sign in, add a USB or RTSP camera, then check **Diagnostics** if a device or stream is not ready.

The launcher creates `.env` from `.env.example` when needed. Edit `.env` to change `PORT` or set `FFMPEG_PATH`. Keep `.env` private; it is ignored by Git.

### Start and stop

- For normal use, double-click `START-CCTV-MONITOR.cmd`. Keep its console window open while the app is running; close it or press Ctrl+C to stop.
- To run the built production server, double-click `START-CCTV-MONITOR-PRODUCTION.cmd`. It installs missing runtime dependencies, builds if needed, and starts production mode.
- To retry the optional person/vehicle model download, run `INSTALL-AI-MODEL-P0.16.1.cmd`.
- To run checks manually, use `npm run check` and `npm test`.

## Optional setup

### Local person and vehicle detection

P0.16.1 AI requires the Tiny YOLOv3 ONNX model and the optional `onnxruntime-node` dependency. First run attempts to install the model; to retry it later, use `INSTALL-AI-MODEL-P0.16.1.cmd`. The installer checks the model's SHA-256 before use. AI is disabled by default and can be enabled per supported USB camera. Tuning profiles control confidence thresholds and sampling cadence; the model does not train itself from event reviews.

### Gemini chat and voice

The optional Gemini assistant uses Google's Gemini API and requires a `GEMINI_API_KEY`. Add it to the local `.env` file, then restart the app. Never put the key in source files or commit `.env`.

### Private remote viewing

Install and connect Tailscale on the CCTV PC and the viewer devices you authorize. Use the private Tailscale address shown in the app's **Settings**. Keep Tailscale access limited to trusted users/devices; the app still requires its own account sign-in and permissions.

## Data and backups

The app stores its SQLite database under `data/`, recordings under `data/recordings/` by default, and generated snapshots under `data/snapshots/`. The first run creates `data/.credential-key` to encrypt saved camera credentials. Back up the database, credential key, and recordings together, and keep those files private. Runtime data, `.env`, dependencies, and build output are excluded from Git.

## Useful scripts

| Script | Purpose |
| --- | --- |
| `FIRST-RUN-P0.16.1.cmd` | Set up dependencies, run checks, build, and launch |
| `START-CCTV-MONITOR.cmd` | Start the normal Windows launcher |
| `START-CCTV-MONITOR-PRODUCTION.cmd` | Start the production build |
| `VERIFY-P0.16.1-COMPLETE.cmd` | Run the P0.16.1 verification workflow |
| `QUALIFY-P0.16.1.cmd` | Qualify USB camera and AI operation on the target PC |

See the versioned `CHANGELOG`, `START-HERE`, and validation files in the repository for release details.
