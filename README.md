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

Issue #12 uses `appointments_test_12` with that override. Generate Prisma Client after installing dependencies or changing the schema. In a restricted workspace, use `XDG_CACHE_HOME="$PWD/node_modules/.cache" pnpm prisma generate`.

The harness accepts only database names matching `appointments_test` or `appointments_test_<number>` and ignores the development `DATABASE_URL`. It applies migrations once per run and truncates application tables before each test. Do not put non-test data there. Test files run serially; separate worktrees can run in parallel with separate databases. Prisma's test migration process uses `node_modules/.cache` if `XDG_CACHE_HOME` is unset, keeping the engine cache writable in restricted workspaces.

The agreed seam is the route loader/action called with real HTTP Requests. Tests use real Shopify JWT verification and Prisma session storage. MSW intercepts Shopify Admin GraphQL and Google's token/calendar-list endpoints, with stateful grants, issued access/refresh tokens, account calendar lists, and pagination. Unhandled network traffic fails. MSW starts before importing the Shopify adapter, which captures `fetch` during initialization. Extend these same fakes and `test/helpers.ts` for later tickets rather than adding another harness. Event operations and the remaining Google client are subsequent work.

The route scenarios cover consent, scope rejection, callback persistence, calendar pagination/filtering, Resource selection, refresh after reconnect, expired/tampered/replayed state, Shop isolation, and concurrent selection. They do not query database state for assertions.

Opening hours/Services scenarios cover weekly split shifts, closed days, validation, shop defaults and clearing overrides, all Service fields and lifecycle operations, definition reinstall/concurrency, pagination, Shopify errors, and Shop/type isolation. They extend the same stateful Shopify MSW fake and authenticated route helpers.

## Runtime

The Dockerfile builds with Node 26 and the frozen pnpm lockfile. Its start command generates Prisma Client, applies migrations, then serves the React Router build on `PORT` (default 3000). Supply `DATABASE_URL` for production Postgres and all secrets in `.env.example` as runtime environment variables. Configure the real app URL and callback URLs before installing. No production deployment is performed by this ticket.

## Remaining verification

Issue #2's manual criterion is installation on a Shopify dev store and loading the embedded admin. Also verify the top-level Google consent round trip using real credentials. Shopify app linking, Google consent setup/verification, and production hosting require account access. Compliance subscriptions/full uninstall cleanup belong to #11/#17; the retained template uninstall handler currently deletes Shopify sessions only.
