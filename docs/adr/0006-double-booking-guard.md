# 6. Double-booking guard: advisory lock + check-insert-verify

Status: accepted (2026-11-05)

Consequence of ADR-0001 (no transactional store). Booking flow:
1. Postgres advisory lock keyed on Resource (serialises our own requests).
2. GCal free/busy check → insert event.
3. Re-list overlapping events; if an earlier-created blocking event exists, delete ours → "slot just taken".

Step 3 catches races with edits made directly in GCal. Non-blocking Bookings are written `transparency: transparent`, so GCal free/busy ignores them natively.
