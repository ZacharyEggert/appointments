# 9. Storefront + admin v1 scope

Status: accepted (2026-11-05)

Storefront:
- Service metaobject is renderable (online store) → per-Service pages without merchant page setup.
- Pick-a-service block: all active Services, optional list setting to narrow.
- Product-page block: Services chosen in theme editor; current product auto-attached as Subject product; hidden when out of stock.
- Widget is vanilla JS (theme extension perf budget). Fixed form: name, email, phone?, notes.
- Abuse: per-IP + per-email rate limit, honeypot. No CAPTCHA.
- Google disconnected → widget shows "Booking unavailable".

Admin (embedded): Google connect (+ reconnect banner), Resource Opening hours, Service CRUD, Bookings list view (read from GCal `events.list` filtered by private extended props, per ADR-0001).

Uninstall: revoke Google token, delete shop's Postgres rows, leave GCal events. Shopify removes app-owned metaobjects.

Deferred: paid bookings, approval flow, custom form questions, capacity > 1, multi-Resource UI, branded email, in-app reschedule.
