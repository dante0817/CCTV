# P0.14.3 Implementation Status

Implemented: schema v10; per-rule Email channel; encrypted SMTP settings; native SMTP TLS/STARTTLS transport; persistent non-blocking email queue; retry/backoff; interrupted-delivery recovery; delivery history; manual retry; SMTP test-send; fresh-install/verification/qualification scripts.

Intentionally deferred: SMS, cloud/mobile push, generic webhooks, AI person/vehicle classification, RTSP/Tenda motion qualification, PTZ, audio and two-way intercom.

Real external SMTP delivery must still be qualified on the Windows CCTV PC against the user's chosen SMTP provider.
