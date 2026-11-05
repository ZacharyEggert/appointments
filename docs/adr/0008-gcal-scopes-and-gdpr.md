# 8. Google scopes and GDPR redaction

Status: accepted (2026-11-05)

Scopes: `calendar.events`, `calendar.freebusy`, `calendar.calendarlist.readonly`. Believed sensitive, not restricted → Google OAuth verification, no CASA audit. Unverified — confirm in Google Cloud console before submitting for verification. `calendar.events` covers Meet creation via `conferenceData`.

`customers/redact` (arrives ~10 days after request, 30 days to complete): find events by customer email hash or Shopify customer id; clear summary PII, description, attendee, and PII extended props; keep the busy block.

`customers/data_request`: respond 200; collect matching Bookings and deliver to the merchant (not in the webhook response).

Known limit: if Google is disconnected or the app is uninstalled (token revoked) when a redaction arrives, it cannot run. Log the failure; no retry infrastructure in v1 (free app, no background jobs). Revisit if it occurs in practice.

Bookings auto-confirm (no approval step in v1).
