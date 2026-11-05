# 7. Services live in app-owned Shopify metaobjects

Status: accepted (2026-11-05)

Services (+ Slot rules) are app-owned metaobjects, so Liquid renders service lists/pages without a proxy round-trip. Postgres holds only sessions, Google tokens, Resources (+ Opening hours).
