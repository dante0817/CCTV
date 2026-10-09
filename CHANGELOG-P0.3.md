# P0.3 changes

- Added `START-CCTV-MONITOR.cmd` as the recommended one-click Windows launcher.
- Added `CHECK-CCTV-SETUP.cmd` for non-destructive preflight checks.
- Added `scripts/run-dev.ps1` to check Node/npm, synchronize dependencies, detect FFmpeg, install/check MediaMTX, detect port conflicts, and start the app.
- Added `scripts/open-browser-when-ready.ps1` to open `http://localhost:<PORT>` only after the backend health endpoint responds.
- Launcher calls `npm.cmd` directly to avoid PowerShell execution-policy problems with `npm.ps1`.
- Added dependency hash stamp so `npm install` reruns when `package.json` changes but not on every normal launch.
- Server now attempts to start/reuse MediaMTX at backend startup instead of waiting for the first camera worker.
- MediaMTX runtime status now reports binary/config, PID, and whether CCTV Monitor owns the process.
- Fixed MediaMTX binary discovery so a nonexistent bare executable is not reported as installed.
- Fixed `setup-mediamtx.ps1` so downloading MediaMTX never overwrites the project's CCTV-specific `mediamtx.yml`.
- Diagnostics now shows the valid browser URL and distinguishes missing MediaMTX from an installed-but-unreachable instance.
- Added `START HERE.txt` and updated README for the simplified workflow.
