import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { action } from "../../app/routes/proxy.book";
import { action as uninstall } from "../../app/routes/webhooks.app.uninstalled";
import { action as redactShop } from "../../app/routes/webhooks.shop.redact";
import { loader as slotsLoader } from "../../app/routes/proxy.slots";
import { fakeGoogle } from "../fakes/google";
import { fakeShopify } from "../fakes/shopify";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import {
  installShop,
  proxyRequest,
  routeArgs,
  serviceForShop,
  webhookRequest,
  SHOP,
} from "../helpers";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T16:00:00Z"));
  await installShop();
});

afterEach(() => vi.useRealTimers());

test("an external Google event appearing after the free/busy check wins without an orphan or guest invite", async () => {
  const service = await serviceForShop();
  fakeGoogle.beforeList = () => {
    fakeGoogle.beforeList = undefined;
    fakeGoogle.events.push({
      id: "external",
      calendarId: service.resource.calendarId,
      created: "2026-11-09T16:00:01Z",
      start: "2026-11-09T17:00:00Z",
      end: "2026-11-09T17:30:00Z",
    });
  };
  const response = await book(service.handle);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ status: "slot-taken" });
  expect(fakeGoogle.events.map((e) => e.id)).toEqual(["external"]);
  expect(fakeGoogle.writes.every((w) => !w.body.attendees)).toBe(true);
});

function book(
  service: string,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  shop = SHOP,
  query: Record<string, string> = {},
) {
  return action(
    routeArgs(
      new Request(proxyRequest("/proxy/book", query, shop), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.10",
          ...headers,
        },
        body: JSON.stringify({
          service,
          slotStart: "2026-11-09T17:00:00Z",
          name: "Jane Doe",
          email: " Jane@Example.com ",
          phone: "555-1234",
          notes: "Bring guitar",
          ...overrides,
        }),
      }),
    ),
  );
}

test("remote Bookings request Meet by default and confirm gracefully while creation is pending", async () => {
  const service = await serviceForShop({ location: "remote" });
  fakeGoogle.conferenceStatus = "pending";
  const response = await book(service.handle);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    status: "confirmed",
    eventId: "event1",
  });
  expect(
    fakeGoogle.writes.find((write) => write.method === "POST"),
  ).toMatchObject({
    sendUpdates: "none",
    conferenceDataVersion: "1",
    body: {
      conferenceData: {
        createRequest: {
          requestId: expect.any(String),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });
  expect(fakeGoogle.events[0].hangoutLink).toBeUndefined();
  expect(fakeGoogle.events[0].conferenceData?.createRequest.status).toEqual({
    statusCode: "pending",
  });
  expect(fakeGoogle.events[0].attendees).toEqual([
    { email: "jane@example.com", displayName: "Jane Doe" },
  ]);
});

test("a ready Meet link remains on the remote Booking when the customer is invited", async () => {
  const service = await serviceForShop({
    location: "remote",
    meet_enabled: "true",
  });
  expect((await book(service.handle)).status).toBe(201);
  expect(
    fakeGoogle.writes.find((write) => write.method === "PATCH"),
  ).toMatchObject({
    sendUpdates: "all",
    conferenceDataVersion: "1",
    body: {
      attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
    },
  });
  expect(fakeGoogle.events[0]).toMatchObject({
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    conferenceData: {
      createRequest: { status: { statusCode: "success" } },
      entryPoints: [
        {
          entryPointType: "video",
          uri: "https://meet.google.com/abc-defg-hij",
        },
      ],
    },
    attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
  });
  expect(
    fakeGoogle.writes.find((write) => write.method === "PATCH")!.body,
  ).not.toHaveProperty("conferenceData");
});

test.each([
  { location: "remote", meet_enabled: "false" },
  { location: "in-person", meet_enabled: "true" },
])("Bookings omit conference data for %j", async (settings) => {
  const service = await serviceForShop(settings);
  expect((await book(service.handle)).status).toBe(201);
  for (const write of fakeGoogle.writes) {
    expect(write.conferenceDataVersion).toBeNull();
    expect(write.body).not.toHaveProperty("conferenceData");
  }
  expect(fakeGoogle.events[0]).not.toHaveProperty("conferenceData");
  expect(fakeGoogle.events[0]).not.toHaveProperty("hangoutLink");
});

test("each remote Booking requests its own conference, including non-blocking Services", async () => {
  const service = await serviceForShop({
    location: "remote",
    blocking: "false",
  });
  expect((await book(service.handle)).status).toBe(201);
  expect(
    (await book(service.handle, { email: "another@example.com" })).status,
  ).toBe(201);
  const requests = fakeGoogle.events.map(
    (event) => event.conferenceData?.createRequest.requestId,
  );
  expect(requests).toEqual([expect.any(String), expect.any(String)]);
  expect(requests[0]).not.toBe("");
  expect(requests[1]).not.toBe("");
  expect(requests[0]).not.toBe(requests[1]);
});

test("a guest receives a confirmed Booking with customer context and only a hashed email in private properties", async () => {
  const service = await serviceForShop();
  const response = await book(service.handle);
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ status: "confirmed" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fakeGoogle.events).toHaveLength(1);
  expect(fakeGoogle.events[0]).toMatchObject({
    calendarId: service.resource.calendarId,
    start: "2026-11-09T17:00:00.000Z",
    end: "2026-11-09T17:30:00.000Z",
    description: expect.stringContaining(
      "Service: Lesson\nCustomer: Jane Doe\nPhone: 555-1234\nNotes: Bring guitar",
    ),
    attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
  });
  expect(fakeGoogle.events[0].extendedProperties).toEqual({
    private: {
      app: "appointments",
      shop: SHOP,
      serviceId: service.id,
      emailHash:
        "8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d",
    },
  });
  expect(JSON.stringify(fakeGoogle.events[0].extendedProperties)).not.toContain(
    "jane@example.com",
  );
});

test("every confirmed Booking includes a Manage link in the customer invite", async () => {
  const service = await serviceForShop();
  expect((await book(service.handle)).status).toBe(201);
  const invite = fakeGoogle.writes.find((write) => write.method === "PATCH")!;
  expect(invite.body.description).toEqual(
    expect.stringContaining(
      `Manage Booking: https://${SHOP}/apps/appointments/manage?token=`,
    ),
  );
  expect(fakeGoogle.events[0].description).toBe(invite.body.description);
});

test("a filled honeypot appears confirmed without writing an event or inviting a guest", async () => {
  const service = await serviceForShop();
  const response = await book(service.handle, {
    website: "https://spam.example",
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    status: "confirmed",
    eventId: expect.any(String),
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fakeGoogle.events).toEqual([]);
  expect(fakeGoogle.writes).toEqual([]);
});

test("the eleventh attempt from the same forwarded client IP is rate limited without a calendar write", async () => {
  const service = await serviceForShop({ blocking: "false" });
  for (let i = 0; i < 10; i++) {
    expect(
      (
        await book(
          service.handle,
          { email: `guest${i}@example.com` },
          {
            "X-Forwarded-For": ` 203.0.113.10, 192.0.2.${i + 1}`,
          },
        )
      ).status,
    ).toBe(201);
  }
  const writes = structuredClone(fakeGoogle.writes);
  const response = await book(service.handle, { email: "new@example.com" });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ status: "rate-limited" });
  expect(response.headers.get("Retry-After")).toBe("900");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fakeGoogle.events).toHaveLength(10);
  expect(fakeGoogle.writes).toEqual(writes);
});

test("the fourth attempt for a normalized email is rate limited even from a different IP", async () => {
  const service = await serviceForShop({ blocking: "false" });
  for (const [i, email] of [
    " Jane@Example.com ",
    "jane@example.com",
    "JANE@EXAMPLE.COM",
  ].entries()) {
    expect(
      (
        await book(
          service.handle,
          { email },
          { "X-Forwarded-For": `203.0.113.${i + 1}` },
        )
      ).status,
    ).toBe(201);
  }
  const writes = structuredClone(fakeGoogle.writes);
  const response = await book(service.handle, { email: "jane@example.com" });
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("900");
  expect(fakeGoogle.events).toHaveLength(3);
  expect(fakeGoogle.writes).toEqual(writes);
});

test.each([
  ["2001:db8::1", "2001:0DB8:0000:0000:0000:0000:0000:0001"],
  ["", "not-an-ip"],
])(
  "IP limits cannot be bypassed by equivalent or unusable forwarded addresses (%s)",
  async (first, next) => {
    const service = await serviceForShop({ blocking: "false" });
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await book(
            service.handle,
            { email: `guest${i}@example.com` },
            { "X-Forwarded-For": first },
          )
        ).status,
      ).toBe(201);
    }
    const writes = structuredClone(fakeGoogle.writes);
    expect(
      (
        await book(
          service.handle,
          { email: "new@example.com" },
          { "X-Forwarded-For": next },
        )
      ).status,
    ).toBe(429);
    expect(fakeGoogle.writes).toEqual(writes);
  },
);

test.each([
  { topic: "app/uninstalled", cleanup: uninstall },
  { topic: "shop/redact", cleanup: redactShop },
])(
  "$topic clears abuse limits before a reinstall",
  async ({ topic, cleanup }) => {
    const service = await serviceForShop({ blocking: "false" });
    for (let i = 0; i < 3; i++)
      expect((await book(service.handle)).status).toBe(201);
    expect((await book(service.handle)).status).toBe(429);
    expect((await cleanup(routeArgs(webhookRequest(topic)))).status).toBe(200);
    await installShop();
    const reinstalled = await serviceForShop({ blocking: "false" });
    expect((await book(reinstalled.handle)).status).toBe(201);
    expect(fakeGoogle.events).toHaveLength(4);
  },
);

test.each(["IP", "email"])(
  "concurrent attempts cannot exceed the %s limit",
  async (kind) => {
    const service = await serviceForShop({ blocking: "false" });
    const responses = await Promise.all(
      Array.from({ length: kind === "IP" ? 11 : 4 }, (_, i) =>
        book(
          service.handle,
          {
            email:
              kind === "IP" ? `guest${i}@example.com` : "guest@example.com",
          },
          {
            "X-Forwarded-For":
              kind === "IP" ? "203.0.113.10" : `203.0.113.${i + 1}`,
          },
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual(
      kind === "IP"
        ? [201, 201, 201, 201, 201, 201, 201, 201, 201, 201, 429]
        : [201, 201, 201, 429],
    );
    expect(fakeGoogle.events).toHaveLength(kind === "IP" ? 10 : 3);
    expect(fakeGoogle.writes).toHaveLength(kind === "IP" ? 20 : 6);
  },
);

test.each(["IP", "email"])(
  "the %s limit resets at fifteen minutes without extending on rejection",
  async (kind) => {
    const service = await serviceForShop({ blocking: "false" });
    for (let i = 0; i < (kind === "IP" ? 10 : 3); i++)
      expect(
        (
          await book(service.handle, {
            email:
              kind === "IP" ? `guest${i}@example.com` : "guest@example.com",
          })
        ).status,
      ).toBe(201);
    vi.setSystemTime(new Date("2026-11-09T16:14:59.500Z"));
    const blocked = await book(service.handle, { email: "guest@example.com" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("1");
    vi.setSystemTime(new Date("2026-11-09T16:15:00Z"));
    expect(
      (await book(service.handle, { email: "guest@example.com" })).status,
    ).toBe(201);
  },
);

test("Slot conflicts still count as Booking attempts", async () => {
  const service = await serviceForShop();
  for (let i = 0; i < 3; i++)
    expect(
      (await book(service.handle, { slotStart: "2026-11-09T18:00:00Z" }))
        .status,
    ).toBe(409);
  expect((await book(service.handle)).status).toBe(429);
  expect(fakeGoogle.events).toEqual([]);
  expect(fakeGoogle.writes).toEqual([]);
});

test("one Shop's email limit does not block another Shop and cleanup leaves its limit intact", async () => {
  const service = await serviceForShop({ blocking: "false" });
  for (let i = 0; i < 3; i++)
    expect((await book(service.handle)).status).toBe(201);
  expect((await book(service.handle)).status).toBe(429);

  const otherShop = "other.myshopify.com";
  await installShop(otherShop);
  // This Shop has no Service: reaching its lookup means the shared IP/email is allowed.
  for (let i = 0; i < 3; i++)
    await expect(book("missing", {}, {}, otherShop)).rejects.toMatchObject({
      status: 404,
    });
  expect((await book("missing", {}, {}, otherShop)).status).toBe(429);
  await uninstall(routeArgs(webhookRequest("app/uninstalled")));
  expect((await book("missing", {}, {}, otherShop)).status).toBe(429);
  expect(fakeGoogle.events).toHaveLength(3);
});

test("two concurrent guests for one Slot produce one Booking and never invite the losing guest", async () => {
  const service = await serviceForShop();
  const responses = await Promise.all([
    book(service.handle, { email: "first@example.com" }),
    book(service.handle, { email: "second@example.com" }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const loser =
    responses[0].status === 409 ? "first@example.com" : "second@example.com";
  expect(await responses.find((r) => r.status === 409)!.json()).toEqual({
    status: "slot-taken",
  });
  expect(fakeGoogle.events).toHaveLength(1);
  expect(fakeGoogle.writes.filter((w) => w.method === "POST")).toEqual([
    expect.objectContaining({
      sendUpdates: "none",
      body: expect.not.objectContaining({ attendees: expect.anything() }),
    }),
  ]);
  expect(fakeGoogle.writes.filter((w) => w.method === "PATCH")).toEqual([
    expect.objectContaining({ sendUpdates: "all" }),
  ]);
  for (const write of fakeGoogle.writes) {
    expect(write.body.attendees ?? []).not.toContainEqual(
      expect.objectContaining({ email: loser }),
    );
  }
});

test("disconnected Google returns unavailable without writing an event", async () => {
  const service = await serviceForShop();
  fakeGoogle.refreshTokens.clear();
  vi.setSystemTime(new Date("2026-11-09T17:01:00Z"));
  const response = await book(service.handle, {
    slotStart: "2026-11-09T17:15:00Z",
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(fakeGoogle.events).toEqual([]);
  expect(fakeGoogle.writes).toEqual([]);
});

test("failed overlap verification removes the provisional event without inviting the guest", async () => {
  const service = await serviceForShop();
  server.use(
    http.get(
      "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events",
      () => HttpResponse.json({ error: { code: 500 } }, { status: 500 }),
    ),
  );
  const response = await book(service.handle);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(fakeGoogle.events).toEqual([]);
  expect(fakeGoogle.writes.every((w) => !w.body.attendees)).toBe(true);
});

test("a non-blocking Service writes transparent Bookings and leaves the Slot bookable", async () => {
  const service = await serviceForShop({ blocking: "false" });
  expect((await book(service.handle)).status).toBe(201);
  expect(
    (await book(service.handle, { email: "another@example.com" })).status,
  ).toBe(201);
  expect(fakeGoogle.events).toHaveLength(2);
  expect(fakeGoogle.events.every((e) => e.transparency === "transparent")).toBe(
    true,
  );
  const slots = await (
    await slotsLoader(
      routeArgs(
        proxyRequest("/proxy/slots", {
          service: service.handle,
          from: "2026-11-09T08:00:00Z",
          to: "2026-11-10T08:00:00Z",
        }),
      ),
    )
  ).json();
  expect(slots.slots[0].start).toBe("2026-11-09T17:00:00.000Z");
});

test("a blocking Booking removes its Slot", async () => {
  const service = await serviceForShop();
  expect((await book(service.handle)).status).toBe(201);
  const slots = await (
    await slotsLoader(
      routeArgs(
        proxyRequest("/proxy/slots", {
          service: service.handle,
          from: "2026-11-09T08:00:00Z",
          to: "2026-11-10T08:00:00Z",
        }),
      ),
    )
  ).json();
  expect(slots.slots.map((x: { start: string }) => x.start)).toEqual([
    "2026-11-09T17:30:00.000Z",
  ]);
});

test("a guest can omit optional contact fields", async () => {
  const service = await serviceForShop();
  expect(
    (await book(service.handle, { phone: undefined, notes: undefined })).status,
  ).toBe(201);
  expect(fakeGoogle.events[0].description).toContain(
    "Service: Lesson\nCustomer: Jane Doe\nPhone: \nNotes: ",
  );
});

test.each([
  { name: "" },
  { name: 42 },
  { email: "invalid" },
  { email: "x\ny@example.com" },
  { slotStart: "2026-11-09T17:00:00" },
  { slotStart: "2026-02-30T17:00:00Z" },
  { service: "" },
  { phone: {} },
  { notes: "x".repeat(4001) },
])("invalid Booking input cannot write an event (case %#)", async (input) => {
  const service = await serviceForShop();
  await expect(book(service.handle, input)).rejects.toMatchObject({
    status: 400,
  });
  expect(fakeGoogle.writes).toEqual([]);
});

test.each([
  "2026-11-09T17:01:00Z",
  "2026-11-09T18:00:00Z",
  "2026-11-02T17:00:00Z",
])(
  "a start outside the current offered Slots cannot book: %s",
  async (slotStart) => {
    const service = await serviceForShop();
    expect((await book(service.handle, { slotStart })).status).toBe(409);
    expect(fakeGoogle.writes).toEqual([]);
  },
);

test("busy time touching a Slot buffer prevents Booking before an event is inserted", async () => {
  const service = await serviceForShop({
    buffer_before_minutes: "5",
    buffer_after_minutes: "5",
  });
  fakeGoogle.events.push({
    calendarId: service.resource.calendarId,
    start: "2026-11-09T17:05:00Z",
    end: "2026-11-09T17:11:00Z",
  });
  expect(
    (await book(service.handle, { slotStart: "2026-11-09T17:15:00Z" })).status,
  ).toBe(409);
  expect(fakeGoogle.writes).toEqual([]);
});

test.each([401, 403, 429, 500])(
  "Google free/busy HTTP %i returns unavailable without writing",
  async (status) => {
    const service = await serviceForShop();
    server.use(
      http.post(
        "https://www.googleapis.com/calendar/v3/freeBusy",
        () => new HttpResponse(null, { status }),
      ),
    );
    const response = await book(service.handle);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(fakeGoogle.writes).toEqual([]);
  },
);

test("unverified requests cannot create Bookings", async () => {
  await expect(
    action(
      routeArgs(
        new Request("https://app.test/proxy/book", {
          method: "POST",
          body: "{}",
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(fakeGoogle.writes).toEqual([]);
});

test("missing, unpublished, and foreign Services cannot create Bookings", async () => {
  const service = await serviceForShop();
  await expect(book("missing")).rejects.toMatchObject({ status: 404 });
  fakeShopify.services.get(SHOP)![0].capabilities.publishable.status = "DRAFT";
  await expect(book(service.handle)).rejects.toMatchObject({ status: 404 });
  await installShop("other.myshopify.com");
  await expect(
    action(
      routeArgs(
        new Request(proxyRequest("/proxy/book", {}, "other.myshopify.com"), {
          method: "POST",
          body: JSON.stringify({
            service: service.handle,
            slotStart: "2026-11-09T17:00:00Z",
            name: "Guest",
            email: "guest@example.com",
          }),
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(fakeGoogle.writes).toEqual([]);
});

test("a logged-in customer's Booking stores the signed Shopify customer id; a body-supplied id is ignored", async () => {
  const service = await serviceForShop();
  const response = await book(
    service.handle,
    { customerId: "999" },
    {},
    SHOP,
    { logged_in_customer_id: "123" },
  );
  expect(response.status).toBe(201);
  expect(fakeGoogle.events[0].extendedProperties?.private.customerId).toBe(
    "123",
  );
});

test("a guest Booking has no customer id", async () => {
  const service = await serviceForShop();
  await book(service.handle, { customerId: "999" });
  expect(fakeGoogle.events[0].extendedProperties?.private).not.toHaveProperty(
    "customerId",
  );
});

test("a Booking from a product page records the Subject product id and title in the event", async () => {
  const service = await serviceForShop();
  const response = await book(service.handle, {
    subjectProduct: { id: "7890", title: "1962 Strat" },
  });
  expect(response.status).toBe(201);
  const event = fakeGoogle.events[0];
  expect(event.description).toMatch(
    /^Service: Lesson\nCustomer: Jane Doe\nPhone: 555-1234\nNotes: Bring guitar\nProduct: 1962 Strat\n\nManage Booking: /,
  );
  expect(event.extendedProperties?.private.subjectProductId).toBe("7890");
});

test.each([{ id: "", title: "x" }, { id: "1", title: "x".repeat(501) }, "bad"])(
  "invalid Subject product cannot write an event (case %#)",
  async (subjectProduct) => {
    const service = await serviceForShop();
    await expect(
      book(service.handle, { subjectProduct }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fakeGoogle.writes).toEqual([]);
  },
);
