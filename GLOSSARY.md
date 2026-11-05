# Glossary

- **Shop** — a Shopify store that installed the app. Connects exactly one Google account.
- **Resource** — a bookable thing (staff member, room, bench). Maps 1:1 to a Google Calendar in the Shop's Google account. v1 ships one Resource per Shop.
- **Service** — a bookable offering with its own duration; performed on a Resource. Either *blocking* or *non-blocking*.
- **Blocking service** — a Booking of it occupies its Resource; no overlapping Bookings allowed.
- **Non-blocking service** — a Booking of it is written to the calendar but does not consume availability.
- **Booking** — one customer appointment. Stored as a Google Calendar event (no DB row). See ADR-0001.
- **Subject product** — a Shopify product a Booking is *about* (e.g. "test-play this guitar"). Reference only; no payment.
- **Customer** — person booking. Guest (name, email, optional phone) or linked Shopify customer when logged in.
- _Avoid_: "appointment" in code (use Booking), "staff"/"calendar" for the bookable thing (use Resource).
- **Opening hours** — weekly hours set in-app per Resource. Availability = Opening hours − GCal busy.
- **Slot rules** — per-Service (shop defaults): duration, start interval, buffer before/after, min notice, max advance days.
- **Slot** — a candidate start time satisfying Opening hours, Slot rules, and GCal free/busy.
- **Manage link** — signed URL in the event description → app-proxy page where Customer can cancel. Reschedule = cancel + rebook (v1).
- **Location** — per-Service: `in-person` (times shown in shop tz) or `remote` (customer tz; Google Meet link auto-added, toggle default on).
- **Service page** — auto URL `/pages/services/<handle>` from the renderable Service metaobject.
- **Price note** — optional plain text on a Service ("$40, paid in store"). Display only.
