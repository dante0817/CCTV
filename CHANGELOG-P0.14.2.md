# CCTV Monitor P0.14.2 Changelog

## Notifications & Motion Alert Rules

- Added schema v9 notification tables.
- Added persistent Admin alert inbox with unread/read state.
- Added configurable notification rules matched against Operational Events.
- Rule filters: event type, minimum severity, optional camera, optional motion zone.
- Added per-rule cooldown to suppress alert spam.
- Added optional browser desktop popups using the Web Notifications API.
- Fresh installs seed Critical system alerts and Camera offline alerts as enabled.
- Fresh installs seed Motion alerts disabled by default.
- Added notification-rule and notification audit actions.
- Added notification badges and header alert popover.
- Preserved Operational Events as the source of truth; notification acknowledgement/read state is separate.
- Preserved P0.14.1 motion snapshots/zones/review, P0.13.1 retention, P0.12 sessions/audit, and 5–8 character new/changed password policy.
- Protected MediaMTX, FFmpeg capture service, and browser CameraPlayer remain unchanged.

## Scope intentionally deferred

SMTP/email, SMS, mobile push, cloud notification services, generic webhooks, AI person/vehicle classification, RTSP/Tenda motion qualification, PTZ, audio and two-way intercom remain deferred.
