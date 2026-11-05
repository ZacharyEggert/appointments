import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { action } from "../../app/routes/proxy.book";
import { fakeGoogle } from "../fakes/google";
import { fakeShopify } from "../fakes/shopify";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import {
  installShop,
  proxyRequest,
  routeArgs,
  serviceForShop,
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

function book(service: string, overrides: Record<string, unknown> = {}) {
  return action(
    routeArgs(
      new Request(proxyRequest("/proxy/book"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    description:
      "Service: Lesson\nCustomer: Jane Doe\nPhone: 555-1234\nNotes: Bring guitar",
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
});

test("a guest can omit optional contact fields", async () => {
  const service = await serviceForShop();
  expect(
    (await book(service.handle, { phone: undefined, notes: undefined })).status,
  ).toBe(201);
  expect(fakeGoogle.events[0].description).toBe(
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

test("a Booking from a product page records the Subject product id and title in the event", async () => {
  const service = await serviceForShop();
  const response = await book(service.handle, {
    subjectProduct: { id: "7890", title: "1962 Strat" },
  });
  expect(response.status).toBe(201);
  const event = fakeGoogle.events[0];
  expect(event.description).toBe(
    "Service: Lesson\nCustomer: Jane Doe\nPhone: 555-1234\nNotes: Bring guitar\nProduct: 1962 Strat",
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
