# 1. Google Calendar is the store of record for Bookings

Status: accepted (2026-11-05)

Bookings exist only as Google Calendar events on the Resource's calendar; app metadata (shop, service id, subject product id, customer id) lives in the event's private extended properties. The app DB holds only config/auth (sessions, Google tokens, settings) — no Booking table.

Why: GCal is the backbone; merchant edits/moves/deletes in GCal are the truth with no sync layer to drift.

Consequences: no transactional double-booking guard (needs check-insert-verify); querying Bookings = `events.list` with `privateExtendedProperty` filters; GDPR redaction must scrub GCal events; availability/reporting bound by Google API quotas.
