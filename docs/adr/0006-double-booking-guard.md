# 6. Double-booking guard: advisory lock + check-insert-verify

Status: accepted (2026-11-05)

Consequence of ADR-0001 (no transactional store). Booking flow:
1. Postgres advisory lock keyed on Resource (serialises our own requests).
2. GCal free/busy check → insert event **without attendee, `sendUpdates=none`**.
3. Re-list overlapping events; if an earlier-created blocking event exists, delete ours → "slot just taken". The losing racer is never emailed.
4. Patch event to add the customer as attendee with `sendUpdates=all` (ADR-0003).

Step 3 catches races with edits made directly in GCal. Non-blocking Bookings are written `transparency: transparent`; GCal free/busy is expected to ignore them (verify in the fake-calendar tests against real API behaviour once).
