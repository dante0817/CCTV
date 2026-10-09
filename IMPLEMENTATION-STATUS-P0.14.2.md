# P0.14.2 Implementation Status

Implemented:
- SQLite schema v9 notification rules + notification inbox.
- Operational-event subscription hook; no notification polling of the Events table.
- Persistent unread/read notification state.
- Event type / severity / camera / motion-zone rule matching.
- Persistent per-rule cooldown suppression.
- Admin notification inbox and rule-management UI.
- Browser desktop notifications when the user explicitly grants browser permission.
- Notification badges in the main navigation/header.
- Default critical and camera-offline rules; default motion rule disabled.
- Audit entries for rule create/update/delete and mark-all-read.
- P0.14.2 regression/migration test.

Qualification still required on the Windows CCTV PC:
- Real USB unplug/reconnect notifications.
- Browser desktop popup behavior on localhost and Tailscale Serve HTTPS.
- Camera/zone-specific motion rule behavior in real-room lighting.
- Long-running alert cooldown behavior.

Not implemented in this release:
- SMTP/email delivery.
- SMS/mobile push.
- Generic outbound webhooks.
- AI person/vehicle classification.
