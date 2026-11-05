import { afterEach, expect, test, vi } from "vitest";
import { action as redact } from "../../app/routes/webhooks.customers.redact";
import { action as dataRequest } from "../../app/routes/webhooks.customers.data_request";
import {
  installShop,
  resourceForShop,
  routeArgs,
  webhookRequest,
  SHOP,
} from "../helpers";
import { fakeGoogle } from "../fakes/google";
import { action as uninstall } from "../../app/routes/webhooks.app.uninstalled";
import { http, HttpResponse } from "msw";
import { server } from "../setup";

afterEach(() => vi.restoreAllMocks());

const webhooks = [
  { topic: "customers/redact", action: redact },
  { topic: "customers/data_request", action: dataRequest },
];

test.each(webhooks)(
  "$topic verifies the raw webhook HMAC",
  async ({ topic, action }) => {
    for (const kind of ["missing", "invalid", "tampered"]) {
      let request = webhookRequest(topic);
      if (kind === "missing") request.headers.delete("X-Shopify-Hmac-Sha256");
      if (kind === "invalid")
        request.headers.set(
          "X-Shopify-Hmac-Sha256",
          Buffer.alloc(32).toString("base64"),
        );
      if (kind === "tampered")
        request = new Request(request, { body: '{"changed":true}' });
      await expect(action(routeArgs(request))).rejects.toMatchObject({
        status: kind === "missing" ? 400 : 401,
      });
    }
  },
);

const janeHash =
  "8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d";
function booking(
  id: string,
  properties: Record<string, string> = {},
  transparency: "opaque" | "transparent" = "opaque",
) {
  return {
    id,
    calendarId: "merchant@example.com",
    summary: "Lesson – Jane Doe",
    description:
      "Customer: Jane Doe; Phone: 555-1234; Notes: private; Manage: secret",
    location: "",
    attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
    start: "2020-01-01T17:00:00Z",
    end: "2020-01-01T18:00:00Z",
    transparency,
    status: "confirmed" as const,
    extendedProperties: {
      private: {
        app: "appointments",
        shop: SHOP,
        serviceId: "service-1",
        emailHash: janeHash,
        ...properties,
      },
    },
  };
}

test("redaction finds past Bookings by normalized email hash, scrubs PII, and keeps the busy block", async () => {
  await installShop();
  await resourceForShop();
  const original = booking("past", {
    customerId: "gid://shopify/Customer/42",
    customerName: "Jane Doe",
    phone: "555-1234",
  });
  const unrelated = [
    booking("other-customer", {
      emailHash: "different",
      customerId: "gid://shopify/Customer/99",
    }),
    booking("other-shop", { shop: "other.myshopify.com" }),
    booking("other-app", { app: "other" }),
  ];
  fakeGoogle.events.push(
    structuredClone(original),
    ...structuredClone(unrelated),
  );

  expect(
    (
      await redact(
        routeArgs(
          webhookRequest("customers/redact", {
            customer: { email: "  JANE@Example.com " },
          }),
        ),
      )
    ).status,
  ).toBe(200);
  expect(fakeGoogle.events[0]).toEqual({
    ...original,
    summary: "Redacted booking",
    description: "",
    attendees: [],
    extendedProperties: {
      private: { app: "appointments", shop: SHOP, serviceId: "service-1" },
    },
  });
  expect(fakeGoogle.events.slice(1)).toEqual(unrelated);
  expect(fakeGoogle.writes).toMatchObject([
    { method: "PATCH", sendUpdates: "none" },
  ]);
  expect(fakeGoogle.writes[0].body).not.toHaveProperty("start");
  expect(fakeGoogle.writes[0].body).not.toHaveProperty("end");
});

test("redaction matches Shopify customer id independently of email and tolerates duplicate deliveries", async () => {
  await installShop();
  await resourceForShop();
  const events = [
    booking("email-only"),
    booking(
      "id-only",
      { emailHash: "old-email", customerId: "gid://shopify/Customer/42" },
      "transparent",
    ),
    booking("both", { customerId: "gid://shopify/Customer/42" }),
  ];
  fakeGoogle.events.push(...structuredClone(events));
  const request = webhookRequest("customers/redact", {
    customer: { email: "jane@example.com", id: 42 },
  });
  expect((await redact(routeArgs(request.clone()))).status).toBe(200);
  expect(
    fakeGoogle.events.map((e) => ({
      id: e.id,
      summary: e.summary,
      transparency: e.transparency,
    })),
  ).toEqual([
    { id: "email-only", summary: "Redacted booking", transparency: "opaque" },
    { id: "id-only", summary: "Redacted booking", transparency: "transparent" },
    { id: "both", summary: "Redacted booking", transparency: "opaque" },
  ]);
  expect(fakeGoogle.writes).toHaveLength(3);
  expect((await redact(routeArgs(request.clone()))).status).toBe(200);
  expect(fakeGoogle.writes).toHaveLength(3);

  fakeGoogle.events.push(
    booking("no-email", {
      emailHash: "another",
      customerId: "gid://shopify/Customer/42",
    }),
  );
  expect(
    (
      await redact(
        routeArgs(
          webhookRequest("customers/redact", {
            customer: { id: 42, email: null },
          }),
        ),
      )
    ).status,
  ).toBe(200);
  expect(fakeGoogle.events.at(-1)?.summary).toBe("Redacted booking");
});

test("data requests collect the union of matching Bookings into a structured log without returning customer data", async () => {
  await installShop();
  await resourceForShop();
  const events = [
    booking("email"),
    booking("id", {
      emailHash: "old",
      customerId: "gid://shopify/Customer/42",
    }),
    booking("both", { customerId: "gid://shopify/Customer/42" }),
  ];
  fakeGoogle.events.push(
    ...structuredClone(events),
    booking("other", { emailHash: "different" }),
  );
  const original = structuredClone(fakeGoogle.events);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const request = webhookRequest("customers/data_request", {
    customer: { email: "jane@example.com", id: 42 },
    data_request: { id: 9999 },
  });

  const response = await dataRequest(routeArgs(request));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "customer-data-request",
      shop: SHOP,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      requestId: 9999,
      bookings: ["email", "both", "id"].map((id) => {
        const event = events.find((e) => e.id === id)!;
        return {
          calendarId: event.calendarId,
          event: {
            ...event,
            start: { dateTime: event.start },
            end: { dateTime: event.end },
          },
        };
      }),
    }),
  );
  expect(fakeGoogle.events).toEqual(original);
  expect(fakeGoogle.writes).toEqual([]);
});

test.each(webhooks)(
  "$topic acknowledges and logs disconnected Google without logging customer PII",
  async ({ topic, action }) => {
    await installShop();
    await resourceForShop();
    fakeGoogle.events.push(booking("keep"));
    const original = structuredClone(fakeGoogle.events);
    fakeGoogle.tokens.clear();
    fakeGoogle.refreshTokens.clear();
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = webhookRequest(topic, {
      customer: { email: "jane@example.com", id: 42 },
    });
    expect((await action(routeArgs(request))).status).toBe(200);
    expect(log).toHaveBeenCalledWith({
      event: "customer-gdpr-failed",
      topic,
      shop: SHOP,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      reason: "google-disconnected",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /jane|example\.com|Customer\/42/,
    );
    expect(fakeGoogle.events).toEqual(original);
  },
);

test.each(webhooks)(
  "$topic acknowledges and logs missing Google credentials after uninstall",
  async ({ topic, action }) => {
    await installShop();
    await resourceForShop();
    await uninstall(routeArgs(webhookRequest("app/uninstalled")));
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = webhookRequest(topic, {
      customer: { email: "jane@example.com" },
    });
    expect((await action(routeArgs(request))).status).toBe(200);
    expect(log).toHaveBeenCalledWith({
      event: "customer-gdpr-failed",
      topic,
      shop: SHOP,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      reason: "google-disconnected",
    });
  },
);

test.each([429, 503, "network"])(
  "redaction asks Shopify to retry temporary Google lookup failure (%s)",
  async (failure) => {
    await installShop();
    await resourceForShop();
    fakeGoogle.events.push(booking("retry"));
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get(
        "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events",
        () =>
          failure === "network"
            ? HttpResponse.error()
            : new HttpResponse(null, { status: Number(failure) }),
      ),
    );
    const request = webhookRequest("customers/redact", {
      customer: { email: "jane@example.com" },
    });
    expect((await redact(routeArgs(request.clone()))).status).toBe(500);
    expect(fakeGoogle.events[0].summary).toBe("Lesson – Jane Doe");
    expect(log).toHaveBeenCalledWith({
      event: "customer-gdpr-failed",
      topic: "customers/redact",
      shop: SHOP,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      reason: "google-unavailable",
    });
    server.resetHandlers();
    expect((await redact(routeArgs(request.clone()))).status).toBe(200);
    expect(fakeGoogle.events[0].summary).toBe("Redacted booking");
  },
);

test("redaction continues after one event fails and retries the remaining PII on redelivery", async () => {
  await installShop();
  await resourceForShop();
  fakeGoogle.events.push(booking("retry"), booking("scrub-now"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  server.use(
    http.patch(
      "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events/retry",
      () => new HttpResponse(null, { status: 503 }),
    ),
  );
  const request = webhookRequest("customers/redact", {
    customer: { email: "jane@example.com" },
  });
  expect((await redact(routeArgs(request.clone()))).status).toBe(500);
  expect(fakeGoogle.events.map((e) => e.summary)).toEqual([
    "Lesson – Jane Doe",
    "Redacted booking",
  ]);
  server.resetHandlers();
  expect((await redact(routeArgs(request.clone()))).status).toBe(200);
  expect(fakeGoogle.events.map((e) => e.summary)).toEqual([
    "Redacted booking",
    "Redacted booking",
  ]);
});

test("redaction also removes a customer address from the event location", async () => {
  await installShop();
  await resourceForShop();
  fakeGoogle.events.push({
    ...booking("address"),
    location: "Jane's private address",
  });
  expect(
    (
      await redact(
        routeArgs(
          webhookRequest("customers/redact", {
            customer: { email: "jane@example.com" },
          }),
        ),
      )
    ).status,
  ).toBe(200);
  expect(fakeGoogle.events[0]).toHaveProperty("location", "");
});

test("data requests acknowledge temporary Google errors and log a failure without a partial export", async () => {
  await installShop();
  await resourceForShop();
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const exportLog = vi.spyOn(console, "info").mockImplementation(() => {});
  server.use(
    http.get(
      "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events",
      () => new HttpResponse(null, { status: 503 }),
    ),
  );
  const request = webhookRequest("customers/data_request", {
    customer: { id: 42 },
  });
  expect((await dataRequest(routeArgs(request))).status).toBe(200);
  expect(log).toHaveBeenCalledWith({
    event: "customer-gdpr-failed",
    topic: "customers/data_request",
    shop: SHOP,
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    reason: "google-unavailable",
  });
  expect(exportLog).not.toHaveBeenCalled();
});

test.each(webhooks)(
  "$topic with no customer identifier never reads or changes calendar events",
  async ({ topic, action }) => {
    await installShop();
    await resourceForShop();
    fakeGoogle.events.push(booking("keep"));
    const original = structuredClone(fakeGoogle.events);
    let listed = false;
    fakeGoogle.beforeList = () => {
      listed = true;
    };
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      (
        await action(
          routeArgs(
            webhookRequest(topic, { customer: { email: null, id: null } }),
          ),
        )
      ).status,
    ).toBe(200);
    expect(listed).toBe(false);
    expect(fakeGoogle.events).toEqual(original);
  },
);
