# 4. Storefront = theme app extension blocks + App Proxy

Status: accepted (2026-11-05)

Booking UI ships as theme app extension app blocks (product page, per-service page, pick-a-service). Blocks call the backend via Shopify App Proxy (`/apps/appointments/...`): same-origin on the shop domain, requests HMAC-signed by Shopify.
