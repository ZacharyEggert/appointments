# 7. Services live in app-owned Shopify metaobjects

Status: accepted (2026-11-05)

Services (+ per-Service Slot rules) are app-owned metaobjects, so Liquid renders service lists/pages without a proxy round-trip. Postgres holds sessions, Google tokens, Resources (+ Opening hours), and shop-level Slot rule defaults.

Details:
- Definition created via Admin GraphQL (`metaobjectDefinitionCreate`), with `publishable` and `onlineStore { urlHandle: "services" }` capabilities — the online-store capability cannot be set in TOML. Look the definition up by type, never by stored GID.
- "Active" = metaobject `publishable` status (no separate flag).
- Resource reference = Postgres Resource id stored as a text field.
