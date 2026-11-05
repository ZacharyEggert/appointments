# Appointments

Shopify embedded app backed by Google Calendar. Vocabulary is in [GLOSSARY.md](GLOSSARY.md); architectural decisions are in [docs/adr](docs/adr).

The scaffold comes from the [official Shopify React Router template](https://github.com/Shopify/shopify-app-template-react-router/tree/81eb98b6ca095eb0b92657f6007939a418f61955), retaining React Router 7, React 18, Shopify app library 3, Prisma 6, and Polaris web components. It uses Node 26, pnpm 11.25.0, and Postgres 18. The package identifier is `llc.ex-nihilo.appointments`.

## Local setup

Use Homebrew Postgres, already running on the implementation machine. No Docker database is needed:

```sh
brew services start postgresql@18
createdb appointments_dev
createdb appointments_test_2
pnpm install --frozen-lockfile
cp .env.example .env
```

Skip `createdb` for databases that already exist. Set `DATABASE_URL` in `.env` to your local user and `appointments_dev`. Run `pnpm setup` to generate Prisma Client and apply committed migrations.

Link a Shopify app with `pnpm config:link`, then run `pnpm dev`. Shopify CLI supplies the Shopify credentials and development app URL. The checked-in `shopify.app.toml` has an empty client ID and example URL until linking. Use a dev store for installation; no credentials or real store are needed to run tests.

Create a Google OAuth **Web application** client. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, and register the exact callback URL `https://<app-host>/google/callback` in Google Cloud. The default callback derives from `SHOPIFY_APP_URL`; set `GOOGLE_REDIRECT_URI` only when an explicit override is needed. Update Google's registered callback when your development tunnel changes.

Enable Calendar API and configure the three consent scopes from ADR-0008:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.freebusy`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

Set `TOKEN_ENCRYPTION_KEY` to a stable random 32-byte base64 value:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
```

Both Google tokens are encrypted with AES-256-GCM. Keep this key with the application's secrets; changing or losing it requires merchants to reconnect. Consent requests offline access with `prompt=consent`, checks all three granted scopes, and uses a ten-minute, single-use state stored in Postgres. Credentials never go to the admin browser. Reconnect updates the Shop's credentials without modifying its Resource.

In the embedded admin, choose **Connect Google**, then **Continue to Google** to authorize in the top-level window. Choose a writable calendar and save the Resource. The model supports multiple Resources; this v1 UI updates a single Resource per Shop. Its timezone comes from the selected calendar. Reconnecting a different account preserves the old selection; choose a calendar accessible to that account before using it for Bookings.

Use **Opening hours and Slot rules** in the app navigation to save weekly intervals for the Resource and shop defaults. Sunday is day `0`; an omitted day is closed. Split shifts can have multiple non-overlapping intervals. Times use the Resource timezone; `24:00` is allowed only as an interval end. Split overnight hours across two days. New Resources start closed.

Initial Slot rule defaults are 30 minutes duration, 15 minutes start interval, no buffers or minimum notice, and 30 days maximum advance. Saving defaults persists them in Postgres (`ShopSettings`); Opening hours live on `Resource.openingHours` as `[{ dayOfWeek, start, end }]`. Duration and start interval accept 5–1440 minutes; buffers accept 0–1440 minutes; maximum advance accepts 1–3650 days.

Use **Services** to create drafts, edit, publish/unpublish, or delete offerings. Empty per-Service Slot rules inherit the current shop defaults, including duration; explicit zero buffers/notice remain zero. Blocking and Google Meet default on; location defaults to in-person, and Meet applies to remote Services. Price note is display text only. Each Service references the selected Resource. Services are stored only in Shopify's `$app:service` metaobjects. The app finds the definition by type on each Services load/action and creates it if missing, with publishable, renderable, onlineStore (`services`), and public storefront access. Concurrent setup tolerates a type-already-exists response. API definition errors (including a conflicting `services` URL handle) surface in the admin.

Service edits use the Admin API's full-replacement `values` input so clearing overrides restores inheritance ([Shopify reference](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/MetaobjectUpdateInput)). Publish/unpublish changes only the publishable status. Theme template setup and storefront blocks are subsequent work (#4); no production Shopify calls are needed for tests.

## Tests

```sh
pnpm test
pnpm typecheck
pnpm build
```

Tests use real local Postgres, defaulting to `postgresql://zachary@localhost:5432/appointments_test_2`. Ticket worktrees **must have separate databases**. To use another ticket database, create it, then run:

```sh
TEST_DATABASE_URL=postgresql://your_user@localhost:5432/appointments_test_3 pnpm test
```

Issue #3 uses `appointments_test_3`; issue #12 uses `appointments_test_12` with that override. Generate Prisma Client after installing dependencies or changing the schema. In a restricted workspace, use `XDG_CACHE_HOME="$PWD/node_modules/.cache" pnpm prisma generate`.

The harness accepts only database names matching `appointments_test` or `appointments_test_<number>` and ignores the development `DATABASE_URL`. It applies migrations once per run and truncates application tables before each test. Do not put non-test data there. Test files run serially; separate worktrees can run in parallel with separate databases. Prisma's test migration process uses `node_modules/.cache` if `XDG_CACHE_HOME` is unset, keeping the engine cache writable in restricted workspaces.

The agreed seam is the route loader/action called with real HTTP Requests. Tests use real Shopify JWT/HMAC verification and Prisma session storage. MSW intercepts Shopify Admin GraphQL and Google's token/revocation/calendar-list/free-busy endpoints, with stateful grants, issued access/refresh tokens, account calendar lists, events, and pagination. Unhandled network traffic fails. MSW starts before importing the Shopify adapter, which captures `fetch` during initialization. Extend these same fakes and `test/helpers.ts` for later tickets rather than adding another harness. The same fake now covers event insert, paginated overlap listing, attendee patch, and deletion for guest Bookings (#13).

The route scenarios cover consent, scope rejection, callback persistence, calendar pagination/filtering, Resource selection, refresh after reconnect, expired/tampered/replayed state, Shop isolation, and concurrent selection. They do not query database state for assertions.

Opening hours/Services scenarios cover weekly split shifts, closed days, validation, shop defaults and clearing overrides, all Service fields and lifecycle operations, definition reinstall/concurrency, pagination, Shopify errors, and Shop/type isolation. They extend the same stateful Shopify MSW fake and authenticated route helpers.
Lifecycle scenarios also cover invalid/missing/tampered webhook HMACs, duplicate deliveries, sessionless cleanup, Shop isolation, Google revocation failures/timeouts, unchanged calendar events, and Service definition lookup after reinstall. Issue #11 uses `TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_11`.

## Storefront Slots API

Shopify forwards `/apps/appointments/slots` to `GET /proxy/slots`. Use `service=<Service handle>`, `from=<RFC3339 timestamp>`, and `to=<RFC3339 timestamp>` (URL-encode values). Both timestamps require an explicit `Z` or offset. A request may span at most 31 × 24 hours; fetch longer ranges in batches. For remote Services, pass `timezone=<browser IANA timezone>` (for example, `Intl.DateTimeFormat().resolvedOptions().timeZone`). Without it, display falls back to the shop timezone. In-person Services always return the shop timezone.

The response is `{ "timeZone": "America/Los_Angeles", "slots": [{ "start": "2026-11-09T17:00:00.000Z", "end": "2026-11-09T17:30:00.000Z" }] }`, with `Cache-Control: no-store`. Slot times are UTC instants; `timeZone` is the display timezone. Only complete Slots contained in the requested range are returned. Opening hours use the saved Resource timezone, independently of display timezone, matching the settings UI.

Start intervals are anchored to each Opening hours interval's local start. Duration and buffers use elapsed minutes, and the entire buffered Slot must fit within continuous Opening hours without overlapping Google busy time. Adjacent busy/buffer endpoints may touch. Nonexistent DST starts are omitted; repeated local times are distinct UTC Slots. Minimum notice includes its exact boundary. Maximum advance is an inclusive start-time limit of `now + maxAdvanceDays × 24 hours`; this rolling horizon is independent of DST. Service overrides inherit current shop defaults when empty.

The route uses Shopify's proxy signature/timestamp verifier and the installed Shop's offline session. Unsigned, tampered, stale, malformed, or excessive requests return 400. Unpublished, missing, or wrong-type Services return 404. A missing installation/Resource or failed Google availability lookup returns 503 (`Booking unavailable`); Shopify lookup failures return 502. Google free/busy queries include buffers outside the requested range and check per-calendar errors. Google failures never become an empty busy list.

Tests cover these responses at the route seam, extending the existing network fakes. Pure Availability tests cover split shifts, closed days, midnight, touching busy boundaries, DST gaps, and a half-hour DST jump. The fake excludes transparent/cancelled events from free/busy; a live Google smoke check of transparent-event semantics remains unperformed (ADR-0006). No storefront UI is part of #3.

## Pick-a-Service block (#15)

The `extensions/booking` theme app extension provides **Pick a Service**. After deploying the app extension, add that block to a compatible theme section. It lists all published Services by default. To narrow it, enter exact Service handles separated by commas in **Service handles**; a handle is the last segment of the Service page URL. Draft, deleted, or unmatched handles never make other Services appear. The heading is configurable. If the merchant customizes Shopify's app proxy URL, update **App proxy path** from its default `/apps/appointments`.

The shared vanilla-JS `appt-widget.js` initializes each `<appointments-widget>` independently, including blocks inserted/reloaded in the theme editor. Customers choose a Service, date, and available Slot. Guest Booking submission and outcome states are added by #13 (below). Service descriptions and Price notes render as text. Loading, empty, and unavailable states are announced to assistive technology, and Slot buttons work with the keyboard.

`GET /proxy/services` uses the same Shopify proxy authentication and offline session as Slots. It returns `{ services: [{ handle, name, description, priceNote }] }`, excludes drafts, follows every Shopify page, and sends `Cache-Control: no-store`. Optional `services=<comma-separated handles>` narrows the published list by exact match; blank means all. Missing installation returns 503, invalid signature returns 400, and Shopify lookup failures return 502. Resource IDs and internal Slot rules are not exposed. **Deviation from ADR-0007's rendering approach:** the list loads via the proxy rather than a Liquid metaobject loop, avoiding the loop's page-size limit and exercising publication/filtering at the agreed HTTP test seam. Metaobjects remain the source of truth.

The widget requests Slots with the browser IANA timezone, then uses only the returned `timeZone` for display and date filtering. The chosen date refers to that display timezone (shop timezone for in-person; browser timezone for remote). The request spans the previous UTC day through three days after the chosen UTC midnight, covering every IANA offset, DST changes, and full-day Slot ends. Results are filtered to starts on the chosen local date. Each displayed time includes its UTC offset, distinguishing repeated DST hours; the IANA timezone is also labelled above the Slots. Stale requests are aborted on selection changes and block removal.

Remote Services (#8) request Google Meet by default. Each provisional Booking insert sends a unique `conferenceData.createRequest` for `hangoutsMeet` with `conferenceDataVersion=1`; the attendee patch also sends version 1 to preserve conference support ([Google event reference](https://developers.google.com/workspace/calendar/api/v3/reference/events)). Turning Meet off, or choosing an in-person Service, omits both the conference body and version parameter. Conference creation can be asynchronous: a pending request still confirms the Booking and invites the guest, without requiring a ready link. Google owns conference generation on the event; the Booking response contains no Meet link and the app does not poll or run a background job.

Issue #8 verification uses `TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_8 pnpm test` and `pnpm typecheck`, extending the existing fake for pending/ready conference responses. Existing Slots route tests cover remote browser timezone and in-person shop timezone. Live Google Meet generation/invite delivery and storefront timezone rendering remain manual dev-store checks and have not been performed. No dependencies or migrations were added.

Local verification (no Shopify login required):

```sh
TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_15 pnpm test
pnpm typecheck
pnpm shopify theme check --path extensions/booking --config theme-check:theme-app-extension --no-input --fail-level warning
gzip -c extensions/booking/assets/appt-widget.js | wc -c
```

The single JS asset must stay at most 10 KB compressed. The route tests reuse the existing MSW/real-Postgres harness. Per the confirmed test seams, Liquid/client behavior remains a manual dev-store check: add the block, verify all/narrowed published Services, select a Service/date, compare in-person/remote timezone labels and local dates (including DST), exercise empty/disconnected states, and reload multiple blocks in the theme editor. These manual checks have not been performed. No new dependencies or migrations are required.

## Google disconnection (#14)

Revoked or expired refresh credentials (`invalid_grant`), repeated Calendar API 401s after one refresh, and `insufficientPermissions` mark only that Shop's Google connection as disconnected. Slots continues to return HTTP 503 with `Booking unavailable`; the existing widget clears Slot choices and displays `Booking unavailable. Please try again later.` A cached access token rejected with 401 is refreshed once before requiring reconnect. Rate limits, server errors, network failures, and lost access to a selected calendar fail closed without changing the connection status.

The admin layout checks Google calendar access on load/revalidation, including navigation between admin pages, and shows a persistent **Reconnect Google** banner linking to Setup. Temporary Google failures leave app settings accessible. Calendar loading and Resource selection handle revocation as a reconnect state instead of an error page. Starting consent or granting incomplete permissions does not clear the warning. Successful consent replaces credentials and clears the warning, preserving the Resource, Opening hours, Slot rules, and Services. Reconnecting the same Google account restores Slots; a different account must have access to the selected calendar or the merchant must choose another.

Verification uses `TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_14 pnpm test` and `pnpm typecheck`, with the existing route/MSW/Postgres harness. No dependencies or migrations were added. Per the confirmed seams, dev-store checks remain manual: revoke Google access, verify the widget's unavailable message and the embedded admin banner, then reconnect and verify the banner disappears and Slots return. Those UI/live OAuth checks have not been performed.

## Guest Bookings (#13)

`POST /proxy/book` (storefront `/apps/appointments/book`) accepts JSON with `service` (published Service handle), `slotStart` (RFC3339 timestamp with an explicit offset), `name`, `email`, and optional `phone`/`notes`. Shopify's signed proxy query and an installed Shop session are required. Name/email are required; limits are 200/254 characters, phone 100, notes 4000. Invalid input returns 400, missing/unpublished/foreign Services return 404. Successful responses are HTTP 201 `{ "status": "confirmed", "eventId": "..." }`; an invalidated Slot returns 409 `{ "status": "slot-taken" }`; Google failures or missing configuration return 503 `{ "status": "unavailable" }`. Outcome responses use `Cache-Control: no-store`.

The Booking service holds a Postgres transaction advisory lock keyed by Resource across free/busy, current Slot validation (including Opening hours and buffers), provisional insert, paginated overlap verification, and attendee patch. The insert has no attendee and uses `sendUpdates=none`; only after verification does the patch add the normalized customer email with `sendUpdates=all`. The event description includes Service name, guest name, phone, and notes. Private properties contain `app`, `shop`, `serviceId`, and SHA-256 `emailHash`; raw email is only used for the attendee. `app/customer-email.server.ts` exports the shared normalizer/hash for later redaction work. Non-blocking Bookings are transparent and leave Slots available.

**Conservative deviation from ADR-0006:** any observed blocking overlap wins, even an external event created later than ours. This satisfies the external-insertion race criterion without relying on Google creation timestamp precision. The provisional event is deleted before returning slot-taken. Verification/attendee-patch errors also attempt provisional cleanup and return unavailable. If Google rejects cleanup or an insert response is lost after Google accepts it, a provisional event can remain; Google and Postgres cannot commit atomically. External edits after the final overlap check remain an inherent race. No Booking table, dependency, or migration is added. Logged-in customer/product context, Meet creation, and spam controls remain their separate tickets.

The shared widget now opens the guest form after Slot selection and submits once per pending request. It announces confirmation, slot-taken, and unavailable states; a taken Slot is removed, and customer input is preserved for another selection. Selecting another Service/date resets Slot selection. The widget does not automatically retry writes.

Verification uses the existing route/MSW/real-Postgres harness, with shared Service setup extracted into `test/helpers.ts`. Issue #13 uses `TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_13 pnpm test`. Its scenarios cover guest context/hash privacy, concurrent callers with no loser invite, a mid-flow external event on a later overlap page, disconnected/erroring Google, verification cleanup, optional/invalid input, unavailable Slots/buffers, non-blocking Bookings, signatures, publication, and Shop isolation.

Manual dev-store checks are skipped per the agreed seams: select a Slot, submit guest details, verify confirmation and actual Google invite delivery, race another customer/external event for the slot-taken state, disconnect Google for unavailable, and reload multiple blocks in the theme editor. Live Google transparent-event/free-busy semantics also remain unverified.

## Manage links and cancellation (#9)

Every confirmed Booking's description includes a **Manage Booking** URL in the same Google patch that invites the customer. It uses the Shop's myshopify domain and Shopify's signed `path_prefix`, including customized app proxy paths. `GET /proxy/manage?token=...` renders the current Google event's summary and start/end times with a Cancel form; viewing the page never cancels. Reschedule means cancel and book again from the Service.

The bearer token is HMAC-SHA256 signed with `SHOPIFY_API_SECRET`, with a separate Manage-link signing context and constant-time verification. It signs Shop and event ID plus calendar ID, so a later Resource calendar change does not redirect an old link to another calendar. Tokens do not expire; rotating the API secret invalidates existing links. Both viewing and cancelling require Shopify proxy authentication, the installed Shop's session, a token for that Shop, and matching app/Shop event properties. Google text is escaped for HTML and Liquid. Responses are not cached.

`POST /proxy/manage?token=...` deletes the event with `sendUpdates=all`, letting Google notify attendees and restoring availability. Race cleanup still uses `sendUpdates=none`. Missing/deleted/cancelled events show the cancelled state; revisiting or repeating cancellation sends no additional notification. Invalid tokens and foreign events return 403; unsigned proxy requests return 400; Google lookup/deletion failures return 503 without a success page.

Verified at the existing route/MSW/Postgres seam with `TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_9 pnpm test` and `pnpm typecheck`. No dependencies or migrations added. Manual dev-store checks remain unperformed: follow the invite's Manage link through the live Shopify proxy (including a custom path), check the theme-rendered details/form, cancel, and verify Google's cancellation email and the reopened Slot.

## Booking abuse protection (#16)

Authenticated `POST /proxy/book` requests allow **10 attempts per IP and 3 per email per Shop in 15 minutes**. These defaults were chosen because #16 specifies no thresholds. Each counter's fixed window starts with its first attempt. Valid Booking input consumes both counters before any Service lookup or Google call, including attempts that later return slot-taken or unavailable. Rejected attempts do not consume counters or extend windows. HTTP 429 returns `{ "status": "rate-limited" }`, `Retry-After` in seconds (rounded up), and `Cache-Control: no-store`, without calendar writes. The widget currently shows its existing unavailable message for 429.

The IP is the trimmed first `X-Forwarded-For` entry from Shopify's proxied request. IPv6 spelling is canonicalized; missing, empty, or invalid entries share an `unknown` bucket per Shop. This is best-effort protection that depends on the hosting proxy preserving Shopify's client-IP header. Email uses the same trim/lowercase normalization as Bookings. Neither raw IP nor raw email is stored in the counters: keys contain SHA-256 hashes.

`BookingRateLimit` is a new operational Postgres table (an addition to ADR-0007's configuration-only inventory; Bookings still live only in Google). A short transaction advisory lock per Shop makes checking and consuming both counters atomic across processes; it is released before external API calls. The migration must be applied before serving traffic. Expired counters are deleted on that Shop's next rate-limit check; dormant Shops retain expired hashes until another attempt or lifecycle cleanup. No background job or dependency was added. Uninstall and shop redaction delete the Shop's counters.

Both existing theme blocks include an optional `website` honeypot, visually hidden and excluded from keyboard/screen-reader navigation. The shared widget already submits it with the form. A filled field returns the normal 201 confirmed response shape with a synthetic event ID, before normal field validation or rate-limit checks, without an event, invite, or counter consumption. An empty or omitted field follows normal Booking behavior.

Verification: `TEST_DATABASE_URL=postgresql://zachary@localhost:5432/appointments_test_16 pnpm test` and `pnpm typecheck`. Tests extend the existing route/MSW/real-Postgres harness and cover both limits, forwarded chains, IPv6, unusable headers, email normalization, concurrent requests, exact expiry, Slot conflicts, Shop isolation, lifecycle cleanup, and the honeypot. #16 has no manual-only acceptance criteria. Dev-store checks of hidden-field accessibility/autofill and live proxy IP headers remain skipped under the agreed seams.

## Shop lifecycle

`app/uninstalled` and `shop/redact` use Shopify's webhook authentication, then revoke any saved Google refresh token and delete that Shop's Google connection, pending OAuth states, Resources, and Shopify sessions in one transaction. No Google Calendar event API is called. Revocation is best-effort with a 1.5-second timeout; failures are logged without credentials, and local deletion continues. Already-invalid tokens are accepted. Database deletion failures propagate so Shopify can retry instead of acknowledging incomplete cleanup. When adding Shop-owned tables, extend `app/shop-lifecycle.server.ts` and its route scenarios to delete those rows too.

Admin setup queries `metaobjectDefinitionByType(type: "$app:service")` each time and returns the current definition ID/type (or null); no definition GID is persisted. Definition creation belongs to #12. Google must be reconnected after reinstall.

Cleanup follows the authenticated Shop domain, without the research notes' optional session-presence guard: an existing session alone does not identify a new installation. A delayed lifecycle delivery after reinstall can therefore clear the new local configuration; installation-generation tracking is outside this ticket.

## Runtime

The Dockerfile builds with Node 26 and the frozen pnpm lockfile. Its start command generates Prisma Client, applies migrations, then serves the React Router build on `PORT` (default 3000). Supply `DATABASE_URL` for production Postgres and all secrets in `.env.example` as runtime environment variables. Configure the real app URL and callback URLs before installing. No production deployment is performed by this ticket.

## Remaining verification

Issue #2's manual criterion is installation on a Shopify dev store and loading the embedded admin. Also verify the top-level Google consent round trip using real credentials. Shopify app linking, Google consent setup/verification, and production hosting require account access. Lifecycle subscriptions are configured in `shopify.app.toml` and take effect when the app configuration is deployed. Customer compliance subscriptions/handlers belong to #17. Issue #11 has no manual-only acceptance criteria; live webhook delivery and Shopify's retention/reattachment of Service entries on reinstall remain dev-store smoke checks.
