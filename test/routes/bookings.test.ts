import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loader } from "../../app/routes/app.bookings";
import { fakeGoogle } from "../fakes/google";
import {
  adminRequest,
  installShop,
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

const load = async () =>
  (await loader(routeArgs(adminRequest("/app/bookings")))).json();

function addEvent(calendarId: string, id: string, start: string, extra = {}) {
  fakeGoogle.events.push({
    id,
    calendarId,
    start,
    end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    summary: "Lesson – Jane Doe",
    description: "Service: Lesson\nCustomer: Jane Doe\nProduct: PRS Custom 24",
    attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
    extendedProperties: {
      private: {
        app: "appointments",
        shop: SHOP,
        subjectProductId: "7890",
      },
    },
    ...extra,
  });
}

test("lists upcoming Bookings by start with Service, customer and Subject product, excluding non-app and past events", async () => {
  const { resource } = await serviceForShop();
  const cal = resource.calendarId;
  addEvent(cal, "later", "2026-11-11T17:00:00Z");
  addEvent(cal, "sooner", "2026-11-10T17:00:00Z");
  addEvent(cal, "past", "2026-11-01T17:00:00Z");
  addEvent(cal, "dentist", "2026-11-10T20:00:00Z", {
    extendedProperties: undefined,
  });
  addEvent(cal, "other-shop", "2026-11-10T21:00:00Z", {
    extendedProperties: {
      private: { app: "appointments", shop: "x.myshopify.com" },
    },
  });
  expect(await load()).toEqual({
    disconnected: false,
    bookings: [
      {
        id: "sooner",
        start: "2026-11-10T17:00:00Z",
        service: "Lesson",
        customer: "Jane Doe",
        product: "PRS Custom 24",
      },
      {
        id: "later",
        start: "2026-11-11T17:00:00Z",
        service: "Lesson",
        customer: "Jane Doe",
        product: "PRS Custom 24",
      },
    ],
  });
});

test("edits and deletes made directly in Google show up", async () => {
  const { resource } = await serviceForShop();
  addEvent(resource.calendarId, "a", "2026-11-10T17:00:00Z");
  addEvent(resource.calendarId, "b", "2026-11-11T17:00:00Z");
  fakeGoogle.events.find((e) => e.id === "a")!.start = "2026-11-12T17:00:00Z";
  fakeGoogle.events.find((e) => e.id === "a")!.end = "2026-11-12T17:30:00Z";
  fakeGoogle.events.splice(
    fakeGoogle.events.findIndex((e) => e.id === "b"),
    1,
  );
  const { bookings } = await load();
  expect(
    bookings.map((b: { id: string; start: string }) => [b.id, b.start]),
  ).toEqual([["a", "2026-11-12T17:00:00Z"]]);
});

test("revoked Google returns a reconnect state, not a crash", async () => {
  await serviceForShop();
  fakeGoogle.tokens.clear();
  fakeGoogle.refreshTokens.clear();
  expect(await load()).toEqual({ disconnected: true, bookings: [] });
});

test("a Shop with no Resource has no Bookings", async () => {
  expect(await load()).toEqual({ disconnected: false, bookings: [] });
});
