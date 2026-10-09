# Implementation Status — P0.11.1

## Software-complete in this package

- MediaMTX startup polling cleanup
- Runtime state/reason/timestamp model
- Stream-readiness-based ONLINE state
- Supervisor stuck-stream detection
- Backoff + jitter + restart-storm circuit breaker
- Startup reconciliation
- Graceful shutdown timer cleanup
- Authoritative system-status service
- Real storage capacity/writability/database-size service
- Read-only system/camera diagnostics APIs
- Dashboard/Storage/Diagnostics UI integration
- Explicit Events deferral; no mock production event claims
- Version set to P0.11.1
- Protected media baseline retained

## Environment-dependent release gate

The following must be verified on the user's Windows CCTV PC:

- Real USB DirectShow capture
- WebRTC and HLS browser playback
- USB unplug/replug recovery
- MediaMTX restart recovery
- absence of startup `ERR [API] path not found` noise
- Ctrl+C process cleanup
- 8–24 hour unattended USB soak test
- full `npm ci` / typecheck / test / build using locally installed dependencies

## Dependency lockfile

`package.json` remains pinned to exact dependency versions. This build environment cannot reach the npm registry for `@google/genai`, so it cannot honestly generate a new `package-lock.json`. On the internet-connected CCTV PC, the first `npm install` will generate the lockfile; preserve that file and use `npm ci` afterward.
