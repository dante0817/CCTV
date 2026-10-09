# CCTV Monitor P0.4 — Frontend 404 Fix

- Fixed a case where the backend API could be healthy while `/` returned `404 page not found`.
- Windows dev launcher now forces `NODE_ENV=development`, preventing a machine-level production environment variable from making the server look for an unbuilt `dist/index.html`.
- Production mode now fails clearly if `dist/index.html` has not been built instead of silently exposing a broken root route.
- Development mode now uses Vite in custom middleware mode and explicitly transforms/serves `index.html` for SPA routes.
- Browser auto-launch now waits for both the API health endpoint **and** valid CCTV frontend HTML.
- Preflight now separately reports API health and frontend-root health.
- Launcher rejects MediaMTX-reserved ports 8554, 8889, and 9997 for the CCTV HTTP server.
- Existing P0.3 startup, FFmpeg, MediaMTX, SQLite, and camera-pipeline changes are retained.
