import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loader } from "../../app/routes/proxy.slots";
import { loader as setup } from "../../app/routes/app._index";
import { loader as admin } from "../../app/routes/app";
import { loader as callback } from "../../app/routes/google.callback";
import { action as saveSettings } from "../../app/routes/app.settings";
import { action as changeService } from "../../app/routes/app.services";
import { defaultSlotRules } from "../../app/slot-rules";
import { fakeGoogle } from "../fakes/google";
import { fakeShopify } from "../fakes/shopify";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import {
  adminRequest,
  callbackRequest,
  consentState,
  installShop,
  proxyRequest,
  resourceForShop,
  routeArgs,
  SHOP,
} from "../helpers";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T16:00:00Z"));
  await installShop();
});
afterEach(() => vi.useRealTimers());

async function offering(
  overrides: Record<string, string> = {},
  openingHours = [{ dayOfWeek: 1, start: "09:00", end: "10:00" }],
) {
  const resource = await resourceForShop();
  await saveSettings(
    routeArgs(
      adminRequest("/app/settings", {
        method: "POST",
        body: new URLSearchParams({
          settings: JSON.stringify({
            resourceId: resource.id,
            openingHours,
            slotRules: defaultSlotRules,
          }),
        }),
      }),
    ),
  );
  const created = await changeService(
    routeArgs(
      adminRequest("/app/services", {
        method: "POST",
        body: new URLSearchParams({
          intent: "create",
          name: "Lesson",
          resource_id: resource.id,
          ...overrides,
        }),
      }),
    ),
  );
  const { metaobject } = await created.json();
  await changeService(
    routeArgs(
      adminRequest("/app/services", {
        method: "POST",
        body: new URLSearchParams({ intent: "publish", id: metaobject.id }),
      }),
    ),
  );
  return { ...metaobject, resource };
}

function slots(service: string, query: Record<string, string> = {}) {
  return loader(
    routeArgs(
      proxyRequest("/proxy/slots", {
        service,
        from: "2026-11-09T08:00:00Z",
        to: "2026-11-10T08:00:00Z",
        ...query,
      }),
    ),
  );
}

test("unsigned proxy requests cannot read Slots", async () => {
  await expect(
    loader(
      routeArgs(new Request("https://app.test/proxy/slots?service=lesson")),
    ),
  ).rejects.toMatchObject({ status: 400 });
});

test("a signed proxy request returns Slots within Opening hours and the in-person display timezone", async () => {
  const service = await offering();
  const response = await slots(service.handle);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    timeZone: "America/Los_Angeles",
    slots: [
      { start: "2026-11-09T17:00:00.000Z", end: "2026-11-09T17:30:00.000Z" },
      { start: "2026-11-09T17:15:00.000Z", end: "2026-11-09T17:45:00.000Z" },
      { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
    ],
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("Google busy removes overlapping Slots while transparent and cancelled events leave availability", async () => {
  const service = await offering();
  fakeGoogle.events.push(
    {
      calendarId: service.resource.calendarId,
      start: "2026-11-09T17:15:00Z",
      end: "2026-11-09T17:30:00Z",
    },
    {
      calendarId: service.resource.calendarId,
      start: "2026-11-09T17:30:00Z",
      end: "2026-11-09T18:00:00Z",
      transparency: "transparent",
    },
    {
      calendarId: service.resource.calendarId,
      start: "2026-11-09T17:30:00Z",
      end: "2026-11-09T18:00:00Z",
      status: "cancelled",
    },
    {
      calendarId: "another-calendar",
      start: "2026-11-09T17:30:00Z",
      end: "2026-11-09T18:00:00Z",
    },
  );
  expect((await (await slots(service.handle)).json()).slots).toEqual([
    { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
  ]);
});

test("Service buffers fit inside Opening hours and start intervals stay anchored to opening time", async () => {
  const service = await offering({
    start_interval_minutes: "20",
    buffer_before_minutes: "5",
    buffer_after_minutes: "5",
  });
  expect((await (await slots(service.handle)).json()).slots).toEqual([
    { start: "2026-11-09T17:20:00.000Z", end: "2026-11-09T17:50:00.000Z" },
  ]);
});

test("busy outside the requested range still blocks a Slot buffer", async () => {
  const service = await offering({
    buffer_before_minutes: "5",
    buffer_after_minutes: "5",
  });
  fakeGoogle.events.push({
    calendarId: service.resource.calendarId,
    start: "2026-11-09T17:45:00Z",
    end: "2026-11-09T17:50:00Z",
  });
  expect(
    (
      await (
        await slots(service.handle, {
          from: "2026-11-09T17:15:00Z",
          to: "2026-11-09T17:45:00Z",
        })
      ).json()
    ).slots,
  ).toEqual([]);
});

test("minimum notice includes its boundary and excludes earlier Slots", async () => {
  const service = await offering({ min_notice_minutes: "75" });
  expect((await (await slots(service.handle)).json()).slots).toEqual([
    { start: "2026-11-09T17:15:00.000Z", end: "2026-11-09T17:45:00.000Z" },
    { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
  ]);
});

test("maximum advance includes its boundary and excludes later starts", async () => {
  const service = await offering({ max_advance_days: "7" });
  vi.setSystemTime(new Date("2026-11-09T17:15:00Z"));
  expect(
    (
      await (
        await slots(service.handle, {
          from: "2026-11-16T08:00:00Z",
          to: "2026-11-17T08:00:00Z",
        })
      ).json()
    ).slots,
  ).toEqual([
    { start: "2026-11-16T17:00:00.000Z", end: "2026-11-16T17:30:00.000Z" },
    { start: "2026-11-16T17:15:00.000Z", end: "2026-11-16T17:45:00.000Z" },
  ]);
});

test("remote Slots carry the browser display timezone while Opening hours stay in the Resource timezone", async () => {
  const service = await offering({ location: "remote" });
  fakeShopify.shop.ianaTimezone = "America/New_York";
  const result = await (
    await slots(service.handle, { timezone: "Asia/Tokyo" })
  ).json();
  expect(result.timeZone).toBe("Asia/Tokyo");
  expect(result.slots[0]).toEqual({
    start: "2026-11-09T17:00:00.000Z",
    end: "2026-11-09T17:30:00.000Z",
  });
});

test("spring DST skips nonexistent starts and keeps elapsed duration inside local Opening hours", async () => {
  vi.setSystemTime(new Date("2026-03-07T16:00:00Z"));
  const service = await offering(
    { duration_minutes: "60", start_interval_minutes: "30" },
    [{ dayOfWeek: 0, start: "01:00", end: "03:00" }],
  );
  expect(
    (
      await (
        await slots(service.handle, {
          from: "2026-03-08T08:00:00Z",
          to: "2026-03-09T07:00:00Z",
        })
      ).json()
    ).slots,
  ).toEqual([
    { start: "2026-03-08T09:00:00.000Z", end: "2026-03-08T10:00:00.000Z" },
  ]);
});

test("fall DST offers both occurrences of a repeated hour as distinct Slots", async () => {
  vi.setSystemTime(new Date("2026-10-31T16:00:00Z"));
  const service = await offering(
    { duration_minutes: "60", start_interval_minutes: "30" },
    [{ dayOfWeek: 0, start: "01:00", end: "02:00" }],
  );
  expect(
    (
      await (
        await slots(service.handle, {
          from: "2026-11-01T07:00:00Z",
          to: "2026-11-02T08:00:00Z",
        })
      ).json()
    ).slots,
  ).toEqual([
    { start: "2026-11-01T08:00:00.000Z", end: "2026-11-01T09:00:00.000Z" },
    { start: "2026-11-01T08:30:00.000Z", end: "2026-11-01T09:30:00.000Z" },
    { start: "2026-11-01T09:00:00.000Z", end: "2026-11-01T10:00:00.000Z" },
  ]);
});

test("unpublished, missing, and non-Service metaobjects return 404", async () => {
  const service = await offering();
  const object = fakeShopify.services.get(SHOP)![0];
  object.capabilities.publishable.status = "DRAFT";
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 404 });
  await expect(slots("missing")).rejects.toMatchObject({ status: 404 });
  object.capabilities.publishable.status = "ACTIVE";
  object.type = "another_type";
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 404 });
});

const invalidQueries: Record<string, string>[] = [
  { service: "" },
  { from: "" },
  { to: "not-a-date" },
  { from: "2026-11-09" },
  { from: "2026-11-09T17:00:00" },
  { from: "2026-02-30T17:00:00Z" },
  { from: "2026-11-10T08:00:00Z" },
  { from: "2026-11-11T08:00:00Z" },
  { to: "2027-11-10T08:00:00Z" },
  { timezone: "not/a-timezone" },
];
test.each(invalidQueries)(
  "malformed or excessive availability ranges return 400: %j",
  async (query) => {
    const service = await offering({ location: "remote" });
    await expect(slots(service.handle, query)).rejects.toMatchObject({
      status: 400,
    });
  },
);

test("failed Google refresh returns booking unavailable instead of an empty or open calendar", async () => {
  const service = await offering();
  fakeGoogle.refreshTokens.clear();
  vi.setSystemTime(new Date("2026-11-09T17:01:00Z"));
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
});

test("revoked Google refresh keeps Slots unavailable and tells the admin to reconnect", async () => {
  const service = await offering();
  fakeGoogle.refreshTokens.clear();
  vi.setSystemTime(new Date("2026-11-09T17:01:00Z"));
  const response = await slots(service.handle).catch(
    (error: Response) => error,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("Booking unavailable");
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    google: { status: "disconnected" },
  });
});

test("revoking a still-cached Google token makes Slots unavailable and persists disconnection", async () => {
  const service = await offering();
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.clear();
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    google: { status: "disconnected" },
  });
});

test("admin keeps the reconnect warning until successful consent restores Slots and configuration", async () => {
  const service = await offering();
  const available = await (await slots(service.handle)).json();
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.clear();
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
  expect(await admin(routeArgs(adminRequest("/app/services")))).toMatchObject({
    googleStatus: "disconnected",
  });
  const state = await consentState();
  expect(await admin(routeArgs(adminRequest("/app/settings")))).toMatchObject({
    googleStatus: "disconnected",
  });
  fakeGoogle.grant("partial-reconnect", {
    scope: "https://www.googleapis.com/auth/calendar.events",
  });
  await expect(
    callback(callbackRequest(state, "partial-reconnect")),
  ).rejects.toMatchObject({
    status: 400,
  });
  expect(await admin(routeArgs(adminRequest("/app/settings")))).toMatchObject({
    googleStatus: "disconnected",
  });
  fakeGoogle.grant("reconnect", { refreshToken: "replacement_refresh_token" });
  await callback(callbackRequest(await consentState(), "reconnect"));
  expect(await admin(routeArgs(adminRequest("/app")))).toMatchObject({
    googleStatus: "connected",
  });
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    resource: {
      ...service.resource,
      openingHours: [{ dayOfWeek: 1, start: "09:00", end: "10:00" }],
    },
  });
  expect(await (await slots(service.handle)).json()).toEqual(available);
});

test.each([
  ["insufficientPermissions", "disconnected"],
  ["rateLimitExceeded", "connected"],
  ["userRateLimitExceeded", "connected"],
])("Google 403 %s leaves the connection %s", async (reason, status) => {
  const service = await offering();
  server.use(
    http.post("https://www.googleapis.com/calendar/v3/freeBusy", () =>
      HttpResponse.json({ error: { errors: [{ reason }] } }, { status: 403 }),
    ),
  );
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    google: { status },
  });
});

test("a rejected fresh Google token still disconnects when refresh rotates the credentials", async () => {
  const service = await offering();
  server.use(
    http.post("https://oauth2.googleapis.com/token", () =>
      HttpResponse.json({
        access_token: "rejected_fresh_token",
        refresh_token: "rotated_refresh_token",
        expires_in: 3600,
      }),
    ),
    http.post("https://www.googleapis.com/calendar/v3/freeBusy", () =>
      HttpResponse.json({ error: { code: 401 } }, { status: 401 }),
    ),
  );
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    google: { status: "disconnected" },
  });
});

test("malformed Google busy intervals fail closed", async () => {
  const service = await offering();
  server.use(
    http.post("https://www.googleapis.com/calendar/v3/freeBusy", () =>
      HttpResponse.json({
        calendars: {
          [service.resource.calendarId]: {
            busy: [{ start: "unknown", end: "2026-11-09T18:00:00Z" }],
          },
        },
      }),
    ),
  );
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
});

test.each([401, 403, 429, 500])(
  "Google HTTP %i never produces available Slots",
  async (status) => {
    const service = await offering();
    server.use(
      http.post("https://www.googleapis.com/calendar/v3/freeBusy", () =>
        HttpResponse.json({ error: { code: status } }, { status }),
      ),
    );
    await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
    expect(
      await (await setup(routeArgs(adminRequest("/app")))).json(),
    ).toMatchObject({
      google: { status: status === 401 ? "disconnected" : "connected" },
    });
  },
);

test.each([400, 401, 429, 500, "network"])(
  "Google token endpoint failure %s leaves admin access and the connection recoverable",
  async (failure) => {
    const service = await offering();
    vi.setSystemTime(new Date("2026-11-09T17:01:00Z"));
    server.use(
      http.post("https://oauth2.googleapis.com/token", () =>
        failure === "network"
          ? HttpResponse.error()
          : HttpResponse.json(
              { error: "temporarily_unavailable" },
              { status: Number(failure) },
            ),
      ),
    );
    await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
    expect(await admin(routeArgs(adminRequest("/app/settings")))).toMatchObject(
      {
        googleStatus: "connected",
      },
    );
  },
);

test("Google per-calendar errors and lost access return booking unavailable", async () => {
  const service = await offering();
  for (const grant of fakeGoogle.tokens.values()) grant.calendars = [];
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
});

test("expired Google access refreshes before reading availability", async () => {
  const service = await offering();
  fakeGoogle.tokens.clear();
  vi.setSystemTime(new Date("2026-11-09T17:01:00Z"));
  expect((await (await slots(service.handle)).json()).slots).toEqual([
    { start: "2026-11-09T17:15:00.000Z", end: "2026-11-09T17:45:00.000Z" },
    { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
  ]);
});

test("a Google 401 refreshes cached access once and restores Slots without reconnecting", async () => {
  const service = await offering();
  fakeGoogle.tokens.clear();
  expect((await (await slots(service.handle)).json()).slots).toEqual([
    { start: "2026-11-09T17:00:00.000Z", end: "2026-11-09T17:30:00.000Z" },
    { start: "2026-11-09T17:15:00.000Z", end: "2026-11-09T17:45:00.000Z" },
    { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
  ]);
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    google: { status: "connected" },
  });
});

test("tampered proxy queries and stale signatures are rejected", async () => {
  const request = proxyRequest("/proxy/slots", { service: "lesson" });
  const tampered = new URL(request.url);
  tampered.searchParams.set("service", "another-service");
  await expect(loader(routeArgs(new Request(tampered)))).rejects.toMatchObject({
    status: 400,
  });
  vi.setSystemTime(new Date("2026-11-09T16:02:00Z"));
  await expect(loader(routeArgs(request))).rejects.toMatchObject({
    status: 400,
  });
});

test("signed proxy requests without an installed Shop return booking unavailable", async () => {
  await expect(
    loader(
      routeArgs(proxyRequest("/proxy/slots", {}, "uninstalled.myshopify.com")),
    ),
  ).rejects.toMatchObject({ status: 503 });
});

test("a signed Shop cannot read another Shop's Service", async () => {
  const service = await offering();
  const other = "other.myshopify.com";
  await installShop(other);
  await expect(
    loader(
      routeArgs(
        proxyRequest(
          "/proxy/slots",
          {
            service: service.handle,
            from: "2026-11-09T08:00:00Z",
            to: "2026-11-10T08:00:00Z",
          },
          other,
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 404 });
});

test("a Service without its own Shop's Resource returns booking unavailable", async () => {
  const service = await offering();
  fakeShopify.services
    .get(SHOP)![0]
    .fields.find((f) => f.key === "resource_id")!.value = "foreign-resource";
  await expect(slots(service.handle)).rejects.toMatchObject({ status: 503 });
});

test("current shop defaults apply to a Service while explicit zero buffers remain zero", async () => {
  const service = await offering({ buffer_before_minutes: "0" });
  await saveSettings(
    routeArgs(
      adminRequest("/app/settings", {
        method: "POST",
        body: new URLSearchParams({
          settings: JSON.stringify({
            slotRules: {
              durationMinutes: 20,
              startIntervalMinutes: 20,
              bufferBeforeMinutes: 10,
              bufferAfterMinutes: 5,
              minNoticeMinutes: 0,
              maxAdvanceDays: 30,
            },
          }),
        }),
      }),
    ),
  );
  expect((await (await slots(service.handle)).json()).slots).toEqual([
    { start: "2026-11-09T17:00:00.000Z", end: "2026-11-09T17:20:00.000Z" },
    { start: "2026-11-09T17:20:00.000Z", end: "2026-11-09T17:40:00.000Z" },
  ]);
});

test("in-person display uses shop timezone even when its Resource and browser use other timezones", async () => {
  const service = await offering();
  fakeShopify.shop.ianaTimezone = "America/New_York";
  expect(
    (await (await slots(service.handle, { timezone: "Asia/Tokyo" })).json())
      .timeZone,
  ).toBe("America/New_York");
});
