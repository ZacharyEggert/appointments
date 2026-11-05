import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { action as book } from "../../app/routes/proxy.book";
import { action, loader } from "../../app/routes/proxy.manage";
import { loader as slots } from "../../app/routes/proxy.slots";
import { fakeGoogle } from "../fakes/google";
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

async function bookingLink(proxyPath = "/apps/appointments") {
  const service = await serviceForShop();
  const response = await book(
    routeArgs(
      new Request(proxyRequest("/proxy/book", { path_prefix: proxyPath }), {
        method: "POST",
        body: JSON.stringify({
          service: service.handle,
          slotStart: "2026-11-09T17:00:00Z",
          name: "Jane Doe",
          email: "jane@example.com",
        }),
      }),
    ),
  );
  expect(response.status).toBe(201);
  const description = fakeGoogle.events[0].description!;
  return { link: new URL(description.split("Manage Booking: ")[1]), service };
}

test("a valid Manage link shows the current Booking details and a Cancel form", async () => {
  const { link } = await bookingLink();
  const response = await loader(
    routeArgs(
      proxyRequest("/proxy/manage", {
        token: link.searchParams.get("token")!,
      }),
    ),
  );
  expect(response.headers.get("Content-Type")).toContain("application/liquid");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const page = await response.text();
  expect(page).toContain("Lesson – Jane Doe");
  expect(page).toContain("2026-11-09T17:00:00.000Z");
  expect(page).toContain("2026-11-09T17:30:00.000Z");
  expect(page).toContain('method="post"');
  expect(page).toContain("Cancel Booking");
  expect(page).toContain("/apps/appointments/manage");
});

test("tampering with the signed Booking identity is rejected before reading Google", async () => {
  const { link } = await bookingLink();
  const [payload, signature] = link.searchParams.get("token")!.split(".");
  const identity = JSON.parse(Buffer.from(payload, "base64url").toString());
  identity.eventId = "another-booking";
  const read = vi.fn(() => new HttpResponse(null, { status: 500 }));
  server.use(
    http.get(
      "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events/:eventId",
      read,
    ),
  );
  const altered = Buffer.from(JSON.stringify(identity)).toString("base64url");
  await expect(
    loader(
      routeArgs(
        proxyRequest("/proxy/manage", {
          token: `${altered}.${signature}`,
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    action(
      routeArgs(
        new Request(
          proxyRequest("/proxy/manage", {
            token: `${altered}.${signature}`,
          }),
          { method: "POST" },
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(read).not.toHaveBeenCalled();
});

test("Cancel notifies attendees through Google and makes the Slot available for rebooking", async () => {
  const { link, service } = await bookingLink();
  const query = {
    service: service.handle,
    from: "2026-11-09T17:00:00Z",
    to: "2026-11-09T17:30:00Z",
  };
  const before = await slots(routeArgs(proxyRequest("/proxy/slots", query)));
  expect((await before.json()).slots).toEqual([]);
  const response = await action(
    routeArgs(
      new Request(
        proxyRequest("/proxy/manage", {
          token: link.searchParams.get("token")!,
        }),
        { method: "POST" },
      ),
    ),
  );
  expect(response.status).toBe(200);
  const page = await response.text();
  expect(page).toContain("Booking cancelled");
  expect(page).toContain("book again");
  expect(fakeGoogle.writes.filter((w) => w.method === "DELETE")).toEqual([
    expect.objectContaining({ sendUpdates: "all" }),
  ]);
  const after = await slots(routeArgs(proxyRequest("/proxy/slots", query)));
  expect((await after.json()).slots).toEqual([
    { start: "2026-11-09T17:00:00.000Z", end: "2026-11-09T17:30:00.000Z" },
  ]);
});

test.each(["view", "cancel"])(
  "a foreign Shop cannot use a valid Manage link to %s a Booking",
  async (operation) => {
    const { link } = await bookingLink();
    const otherShop = "other.myshopify.com";
    await installShop(otherShop);
    const request = proxyRequest(
      "/proxy/manage",
      { token: link.searchParams.get("token")! },
      otherShop,
    );
    await expect(
      operation === "view"
        ? loader(routeArgs(request))
        : action(routeArgs(new Request(request, { method: "POST" }))),
    ).rejects.toMatchObject({ status: 403 });
    expect(fakeGoogle.events).toHaveLength(1);
  },
);

test.each(["", "broken", "abc.00", "abc." + "0".repeat(64)])(
  "malformed Manage token is rejected: %s",
  async (token) => {
    await expect(
      loader(routeArgs(proxyRequest("/proxy/manage", { token }))),
    ).rejects.toMatchObject({ status: 403 });
  },
);

test.each([
  { app: "appointments", shop: "foreign.myshopify.com" },
  { app: "another-app", shop: SHOP },
])(
  "Manage links cannot expose or delete an event owned by another Shop or app: %j",
  async (privateProperties) => {
    const { link } = await bookingLink();
    fakeGoogle.events[0].extendedProperties = { private: privateProperties };
    const request = () =>
      proxyRequest("/proxy/manage", { token: link.searchParams.get("token")! });
    await expect(loader(routeArgs(request()))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      action(routeArgs(new Request(request(), { method: "POST" }))),
    ).rejects.toMatchObject({ status: 403 });
    expect(fakeGoogle.events).toHaveLength(1);
    expect(fakeGoogle.writes.filter((w) => w.method === "DELETE")).toEqual([]);
  },
);

test("Booking details render as text without running HTML or Liquid from Google", async () => {
  const { link } = await bookingLink();
  fakeGoogle.events[0].summary = '<script>alert("x")</script>{{ shop.email }}';
  const response = await loader(
    routeArgs(
      proxyRequest("/proxy/manage", {
        token: link.searchParams.get("token")!,
      }),
    ),
  );
  const page = await response.text();
  expect(page).toContain("&#60;script&#62;");
  expect(page).not.toContain("<script>");
  expect(page).not.toContain("{{ shop.email }}");
});

test.each(["lookup", "delete"])(
  "a Google %s failure leaves the Booking intact and reports unavailable",
  async (failure) => {
    const { link } = await bookingLink();
    const handler = failure === "lookup" ? http.get : http.delete;
    server.use(
      handler(
        "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events/:eventId",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await expect(
      action(
        routeArgs(
          new Request(
            proxyRequest("/proxy/manage", {
              token: link.searchParams.get("token")!,
            }),
            { method: "POST" },
          ),
        ),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(fakeGoogle.events).toHaveLength(1);
  },
);

test("a cancelled Booking can be revisited or cancelled again without another notification", async () => {
  const { link } = await bookingLink();
  const request = () =>
    proxyRequest("/proxy/manage", { token: link.searchParams.get("token")! });
  await action(routeArgs(new Request(request(), { method: "POST" })));
  const revisited = await loader(routeArgs(request()));
  expect(await revisited.text()).toContain("Booking cancelled");
  const repeated = await action(
    routeArgs(new Request(request(), { method: "POST" })),
  );
  expect(await repeated.text()).toContain("Booking cancelled");
  expect(fakeGoogle.writes.filter((w) => w.method === "DELETE")).toHaveLength(
    1,
  );
});

test("Manage links and Cancel forms use the Shop's customized app proxy path", async () => {
  const { link } = await bookingLink("/tools/bookings");
  expect(link.pathname).toBe("/tools/bookings/manage");
  const response = await loader(
    routeArgs(
      proxyRequest("/proxy/manage", {
        token: link.searchParams.get("token")!,
        path_prefix: "/tools/bookings",
      }),
    ),
  );
  expect(await response.text()).toContain(
    'action="/tools/bookings/manage/?token=',
  );
});

test("unsigned proxy requests cannot view or cancel Bookings", async () => {
  const { link } = await bookingLink();
  const request = new Request(`https://app.test/proxy/manage${link.search}`);
  await expect(loader(routeArgs(request))).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    action(routeArgs(new Request(request, { method: "POST" }))),
  ).rejects.toMatchObject({ status: 400 });
  expect(fakeGoogle.events).toHaveLength(1);
});
