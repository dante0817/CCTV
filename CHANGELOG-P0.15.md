# CCTV Monitor P0.15 Changelog

## Added
- Responsive phone/tablet application shell.
- Viewer mobile bottom navigation.
- Compact Admin mobile navigation and More sheet.
- Phone one-camera focus mode with quick-switch chips.
- Swipe camera switching plus previous/next controls.
- Touch-sized live-camera actions and mobile fullscreen handling.
- Responsive tablet two-column Live View.
- Local/LAN/Tailscale/Remote browser-context indicator.
- Browser network-quality and secure-context visibility.
- Mobile-safe notification popover and compact Header.
- Safe-area/dynamic-viewport CSS and narrow-screen Recordings/Account/My Cameras refinements.
- `test:p015` responsive/mobile-viewer regression.
- `QUALIFY-P0.15.cmd` Windows/mobile/Tailscale qualification guide.

## Preserved
- Database schema remains v10.
- Protected MediaMTX, FFmpeg service, and CameraPlayer files remain byte-for-byte unchanged.
- Password policy remains 5–8 characters for new/changed passwords.
- All P0.14.3 and earlier recording, motion, notification, session, and security functionality remains in scope.

## Intentionally deferred
- Service-worker/offline caching.
- Native mobile app packaging.
- AI person/vehicle classification.
- PTZ/two-way audio hardware qualification.
