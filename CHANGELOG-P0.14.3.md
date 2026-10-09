# CCTV Monitor P0.14.3 — Queued Email Notifications & Delivery Reliability

## Added
- Schema v10 notification email delivery migration.
- Per-alert-rule Email channel toggle.
- Encrypted SMTP configuration using the existing CCTV credential key.
- Native Node TCP/TLS SMTP client with direct TLS and STARTTLS.
- SMTP authentication (AUTH PLAIN with LOGIN fallback).
- Non-blocking persistent delivery queue.
- Retry/backoff: 1m, 5m, 15m, then 1h, terminal after five failed attempts.
- Recovery of deliveries interrupted while the application was restarting.
- Admin SMTP test-send endpoint and UI.
- Admin delivery history and manual retry.
- Optional CCTV base URL in email messages.

## Security
- SMTP password is never returned by API and is stored encrypted.
- Existing Audit redaction covers password/credential fields.
- TLS certificate validation remains enabled for TLS/STARTTLS.
- Generic webhooks remain deferred; P0.14.3 does not introduce arbitrary HTTP callbacks.

## Preserved
- 5–8 character new/changed password policy.
- Protected USB/MediaMTX/WebRTC live-media baseline.
- Recording, retention, motion, zones, snapshots, review and local/browser notifications.
