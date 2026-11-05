import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { action as connect } from "../../app/routes/app.google.connect";
import { loader as callback } from "../../app/routes/google.callback";
import { loader as setup } from "../../app/routes/app._index";
import { loader as admin } from "../../app/routes/app";
import {
  loader as calendars,
  action as selectCalendar,
} from "../../app/routes/app.google.calendars";
import { fakeGoogle } from "../fakes/google";
import {
  adminRequest,
  installShop,
  routeArgs,
  consentState,
  callbackRequest,
  resourceForShop,
} from "../helpers";

beforeEach(() => installShop());
afterEach(() => vi.useRealTimers());

test("a Shop can start top-level Google consent with the three ADR scopes and offline access", async () => {
  const response = await connect(
    routeArgs(adminRequest("/app/google/connect", { method: "POST" })),
  );
  const { authorizationUrl } = await response.json();
  const url = new URL(authorizationUrl);
  expect(url.origin + url.pathname).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: "google_test_client",
    redirect_uri: "https://app.test/google/callback",
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope:
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  });
  expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("Google callback connects the authenticated Shop and never returns its credentials", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  const response = await callback(callbackRequest(state));
  expect(response.status).toBe(302);
  const result = await setup(routeArgs(adminRequest("/app")));
  expect(await result.json()).toMatchObject({
    google: { status: "connected" },
  });
  expect(await response.text()).not.toContain("google_refresh_token");
});

test("opening the admin detects revoked Google access before any customer requests Slots", async () => {
  fakeGoogle.grant();
  await callback(callbackRequest(await consentState()));
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.clear();
  expect(await admin(routeArgs(adminRequest("/app/services")))).toMatchObject({
    googleStatus: "disconnected",
  });
});

test("calendar loading returns a reconnect state instead of breaking admin setup after revocation", async () => {
  fakeGoogle.grant();
  await callback(callbackRequest(await consentState()));
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.clear();
  const load = () =>
    calendars(routeArgs(adminRequest("/app/google/calendars")));
  expect(await (await load()).json()).toEqual({
    calendars: [],
    disconnected: true,
  });
  expect(await (await load()).json()).toEqual({
    calendars: [],
    disconnected: true,
  });
});

test("revocation during Resource selection returns reconnect state and preserves the Resource", async () => {
  const resource = await resourceForShop();
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.clear();
  const response = await selectCalendar(
    routeArgs(
      adminRequest("/app/google/calendars", {
        method: "POST",
        body: new URLSearchParams({ calendarId: "merchant@example.com" }),
      }),
    ),
  );
  expect(await response.json()).toEqual({ disconnected: true });
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({ resource });
});

test("partial Google consent does not connect a Shop", async () => {
  const state = await consentState();
  fakeGoogle.grant("partial", {
    scope: "https://www.googleapis.com/auth/calendar.events",
  });
  await expect(
    callback(callbackRequest(state, "partial")),
  ).rejects.toMatchObject({ status: 400 });
  const result = await setup(routeArgs(adminRequest("/app")));
  expect(await result.json()).toMatchObject({ google: null });
});

test("Google consent requires a valid Shopify session token", async () => {
  const request = new Request("https://app.test/app/google/connect", {
    method: "POST",
    headers: { authorization: "Bearer invalid" },
  });
  await expect(connect(routeArgs(request))).rejects.toMatchObject({
    status: 401,
  });
});

test("tampered OAuth state is rejected without consuming a valid consent flow", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  await expect(
    callback(callbackRequest(`${state}tampered`)),
  ).rejects.toMatchObject({ status: 400 });
  expect((await callback(callbackRequest(state))).status).toBe(302);
});

test("OAuth state expires after ten minutes", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 601_000);
  await expect(callback(callbackRequest(state))).rejects.toMatchObject({
    status: 400,
  });
});

test("OAuth state cannot be replayed to replace an existing connection", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  fakeGoogle.grant("replay", { refreshToken: "attacker_token", calendars: [] });
  await expect(
    callback(callbackRequest(state, "replay")),
  ).rejects.toMatchObject({ status: 400 });
  const result = await calendars(
    routeArgs(adminRequest("/app/google/calendars")),
  );
  expect(await result.json()).toMatchObject({
    calendars: [{ id: "merchant@example.com" }],
  });
});

test("a Shop cannot access another Shop's Google connection or Resource", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  await selectCalendar(
    routeArgs(
      adminRequest("/app/google/calendars", {
        method: "POST",
        body: new URLSearchParams({ calendarId: "merchant@example.com" }),
      }),
    ),
  );
  const otherShop = "other-shop.myshopify.com";
  await installShop(otherShop);
  await expect(
    calendars(routeArgs(adminRequest("/app/google/calendars", {}, otherShop))),
  ).rejects.toMatchObject({ status: 409 });
  const result = await setup(routeArgs(adminRequest("/app", {}, otherShop)));
  expect(await result.json()).toMatchObject({ google: null, resource: null });
});

test("a calendar outside the connected account cannot be selected as a Resource", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  await expect(
    selectCalendar(
      routeArgs(
        adminRequest("/app/google/calendars", {
          method: "POST",
          body: new URLSearchParams({ calendarId: "someone-elses-calendar" }),
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 400 });
  const result = await setup(routeArgs(adminRequest("/app")));
  expect(await result.json()).toMatchObject({ resource: null });
});

test("simultaneous calendar selections keep a single v1 Resource", async () => {
  const state = await consentState();
  fakeGoogle.grant("selection", {
    calendars: [
      {
        id: "bench-a",
        summary: "Bench A",
        timeZone: "UTC",
        accessRole: "owner",
      },
      {
        id: "bench-b",
        summary: "Bench B",
        timeZone: "UTC",
        accessRole: "writer",
      },
    ],
  });
  await callback(callbackRequest(state, "selection"));
  const results = await Promise.all(
    ["bench-a", "bench-b"].map(async (calendarId) => {
      const response = await selectCalendar(
        routeArgs(
          adminRequest("/app/google/calendars", {
            method: "POST",
            body: new URLSearchParams({ calendarId }),
          }),
        ),
      );
      return response.json();
    }),
  );
  expect(results[0].resource.id).toBe(results[1].resource.id);
});

test("a connected Shop lists all its writable calendars using the route harness", async () => {
  const state = await consentState();
  fakeGoogle.grant("calendars", {
    calendars: [
      {
        id: "merchant@example.com",
        summary: "Bookings",
        timeZone: "America/Los_Angeles",
        accessRole: "owner",
        primary: true,
      },
      {
        id: "bench",
        summary: "Repair bench",
        timeZone: "America/New_York",
        accessRole: "writer",
      },
      {
        id: "readonly",
        summary: "Holidays",
        timeZone: "UTC",
        accessRole: "reader",
      },
    ],
  });
  await callback(callbackRequest(state, "calendars"));
  const response = await calendars(
    routeArgs(adminRequest("/app/google/calendars")),
  );
  expect(await response.json()).toMatchObject({
    calendars: [
      {
        id: "merchant@example.com",
        summary: "Bookings",
        timeZone: "America/Los_Angeles",
      },
      { id: "bench", summary: "Repair bench", timeZone: "America/New_York" },
    ],
  });
  const result = await setup(routeArgs(adminRequest("/app")));
  expect(await result.json()).toMatchObject({
    shop: { name: "Test guitar shop", ianaTimezone: "America/Los_Angeles" },
    google: { status: "connected" },
  });
});

test("selecting a Google calendar saves the Shop's Resource and its calendar timezone", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  const selected = await selectCalendar(
    routeArgs(
      adminRequest("/app/google/calendars", {
        method: "POST",
        body: new URLSearchParams({ calendarId: "merchant@example.com" }),
      }),
    ),
  );
  const { resource } = await selected.json();
  expect(resource).toMatchObject({
    id: expect.any(String),
    calendarId: "merchant@example.com",
    name: "Bookings",
    timeZone: "America/Los_Angeles",
  });
  const result = await setup(routeArgs(adminRequest("/app")));
  expect(await result.json()).toMatchObject({ resource });
});

test("reconnect replaces the persisted refresh token without losing the Resource", async () => {
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  const selection = await selectCalendar(
    routeArgs(
      adminRequest("/app/google/calendars", {
        method: "POST",
        body: new URLSearchParams({ calendarId: "merchant@example.com" }),
      }),
    ),
  );
  const { resource } = await selection.json();
  fakeGoogle.grant("reconnect", {
    refreshToken: "replacement_refresh_token",
    calendars: [
      {
        id: "new-account",
        summary: "New account calendar",
        timeZone: "UTC",
        accessRole: "owner",
      },
    ],
  });
  await callback(callbackRequest(await consentState(), "reconnect"));
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.delete("google_refresh_token");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 3_601_000);
  const response = await calendars(
    routeArgs(adminRequest("/app/google/calendars")),
  );
  expect(await response.json()).toMatchObject({
    calendars: [{ id: "new-account" }],
  });
  const result = await setup(routeArgs(adminRequest("/app")));
  expect(await result.json()).toMatchObject({
    google: { status: "connected" },
    resource,
  });
});
