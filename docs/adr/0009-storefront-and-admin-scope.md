# 9. Storefront + admin v1 scope

Status: accepted (2026-11-05)

Storefront:
- Service metaobject is renderable (online store, ADR-0007) → each Service gets `/pages/services/<handle>`. The theme's `metaobject/<type>` template starts empty: merchant must create it in the theme editor and add the booking block. Admin onboarding deep-links there.
- Pick-a-service block: all published Services, optional list setting to narrow.
- Product-page block: Services chosen in theme editor; current product auto-attached as Subject product; hidden when out of stock.
- Widget is vanilla JS, ≤10 KB compressed per file (Shopify's theme app extension guidance; theme-check flags overages). Fixed form: name, email, phone?, notes.
- Abuse: per-IP (from `X-Forwarded-For` on the proxied request) + per-email rate limit, honeypot. No CAPTCHA.
- Google disconnected → widget shows "Booking unavailable".

Admin (embedded): Google connect (+ reconnect banner), Resource Opening hours, Service CRUD, Bookings list (read from GCal `events.list` filtered by private extended props, per ADR-0001).

Uninstall: revoke Google token, delete shop's Postgres rows, leave GCal events. Shopify deletes app-owned metaobject definitions; entries are retained for a period and reattach on reinstall.

Deferred: paid bookings, approval flow, custom form questions, capacity > 1, multi-Resource UI, branded email, in-app reschedule.

Implementation detail (#16): limits are 10 attempts per IP and 3 per normalized email per Shop in fixed 15-minute windows. Hashed counters live in the operational `BookingRateLimit` Postgres table, extending ADR-0007's table inventory so limits work across app processes. Short transaction advisory locks serialize counter consumption per Shop, before external API calls. Counters expire logically after 15 minutes and are deleted on the Shop's next check or lifecycle cleanup. A filled `website` honeypot returns a synthetic confirmation without writing a Booking.
