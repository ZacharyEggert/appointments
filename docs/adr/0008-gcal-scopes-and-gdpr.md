# 8. Google scopes and GDPR redaction

Status: accepted (2026-11-05)

Scopes: `calendar.events`, `calendar.freebusy`, `calendar.calendarlist.readonly` — sensitive, not restricted → Google OAuth verification, no CASA audit.

`customers/redact`: find events by customer email (private extended property), remove attendee + scrub description, keep the busy block. Bookings auto-confirm (no approval step in v1).
