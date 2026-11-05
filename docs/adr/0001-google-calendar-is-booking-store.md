# 1. Google Calendar is the store of record for Bookings

Status: accepted (2026-11-05)

Bookings exist only as Google Calendar events on the Resource's calendar. App metadata lives in the event's private extended properties: shop, service id, subject product id, Shopify customer id (if logged in), and a SHA-256 hash of the normalised customer email (never the raw email). The app DB holds no Booking table.

Why: GCal is the backbone; merchant edits/moves/deletes in GCal are the truth with no sync layer to drift.

Consequences: no transactional double-booking guard (ADR-0006); querying Bookings = `events.list` with `privateExtendedProperty` filters (AND-combined; `singleEvents=true` for `orderBy=startTime`); GDPR redaction must scrub GCal events (ADR-0008); availability/reporting bound by Google API quotas.
