import { afterEach, expect, test, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { action as uninstall } from "../../app/routes/webhooks.app.uninstalled";
import { action as redactShop } from "../../app/routes/webhooks.shop.redact";
import { loader as callback } from "../../app/routes/google.callback";
import { loader as setup } from "../../app/routes/app._index";
import { action as selectCalendar } from "../../app/routes/app.google.calendars";
import { fakeGoogle } from "../fakes/google";
import { fakeShopify } from "../fakes/shopify";
import { server } from "../setup";
import {
  callbackRequest,
  adminRequest,
  consentState,
  installShop,
  routeArgs,
  webhookRequest,
  SHOP,
} from "../helpers";

afterEach(() => vi.restoreAllMocks());

test("reinstall re-finds the current Service definition by type on admin setup", async () => {
  await installShop();
  fakeShopify.serviceDefinitions.set(SHOP, {
    id: "gid://shopify/MetaobjectDefinition/41",
    type: "app--12345--service",
  });
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    serviceDefinition: {
      id: "gid://shopify/MetaobjectDefinition/41",
      type: "app--12345--service",
    },
  });

  await uninstall(routeArgs(webhookRequest("app/uninstalled")));
  fakeShopify.serviceDefinitions.set(SHOP, {
    id: "gid://shopify/MetaobjectDefinition/99",
    type: "app--12345--service",
  });
  await installShop();

  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({
    serviceDefinition: {
      id: "gid://shopify/MetaobjectDefinition/99",
      type: "app--12345--service",
    },
  });
});

const webhooks = [
  { topic: "app/uninstalled", action: uninstall },
  { topic: "shop/redact", action: redactShop },
];

test.each(webhooks)(
  "$topic rejects missing, invalid, and tampered HMAC before erasing data",
  async ({ topic, action }) => {
    await installShop();
    const state = await consentState();
    fakeGoogle.grant();
    await callback(callbackRequest(state));
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
    expect(fakeGoogle.revocations).toEqual([]);
    expect(
      await (await setup(routeArgs(adminRequest("/app")))).json(),
    ).toMatchObject({ google: { status: "connected" } });
  },
);

test.each(webhooks)(
  "$topic removes the Shopify session and tolerates duplicate deliveries without changing calendar events",
  async ({ topic, action }) => {
    await installShop();
    const state = await consentState();
    fakeGoogle.grant();
    await callback(callbackRequest(state));
    const events = [
      {
        id: "existing-booking",
        summary: "Setup with customer",
        attendees: [{ email: "customer@example.com" }],
      },
    ];
    const originalEvents = structuredClone(events);
    const calendarRequests: string[] = [];
    server.use(
      http.all("https://www.googleapis.com/calendar/v3/*", ({ request }) => {
        calendarRequests.push(request.method);
        events.length = 0;
        return HttpResponse.json({});
      }),
    );
    const request = webhookRequest(topic);
    expect((await action(routeArgs(request.clone()))).status).toBe(200);
    expect((await action(routeArgs(request.clone()))).status).toBe(200);
    await expect(setup(routeArgs(adminRequest("/app")))).rejects.toMatchObject({
      status: 401,
    });
    expect(fakeGoogle.revocations).toEqual(["google_refresh_token"]);
    expect(calendarRequests).toEqual([]);
    expect(events).toEqual(originalEvents);
  },
);

test("uninstall revokes the Shop's Google refresh token", async () => {
  await installShop();
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));

  const response = await uninstall(
    routeArgs(webhookRequest("app/uninstalled")),
  );

  expect(response.status).toBe(200);
  expect(fakeGoogle.revocations).toEqual(["google_refresh_token"]);
  expect(fakeGoogle.refreshTokens.has("google_refresh_token")).toBe(false);
});

test.each(webhooks)(
  "$topic erases only the authenticated Shop's data even without a Shopify session",
  async ({ topic, action }) => {
    await installShop();
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
    const pendingState = await consentState();
    // Shopify may have removed the session before delivering lifecycle webhooks.
    const { sessionStorage } = await import("../../app/shopify.server");
    await sessionStorage.deleteSession("offline_test-shop.myshopify.com");

    const otherShop = "other-shop.myshopify.com";
    await installShop(otherShop);
    const otherState = await consentState(otherShop);
    fakeGoogle.grant("other", { refreshToken: "other_refresh_token" });
    await callback(callbackRequest(otherState, "other"));

    const response = await action(
      routeArgs(webhookRequest(topic, { shop_domain: otherShop })),
    );
    expect(response.status).toBe(200);
    await installShop();
    expect(
      await (await setup(routeArgs(adminRequest("/app")))).json(),
    ).toMatchObject({ google: null, resource: null });
    await expect(callback(callbackRequest(pendingState))).rejects.toMatchObject(
      { status: 400 },
    );
    expect(
      await (
        await setup(routeArgs(adminRequest("/app", {}, otherShop)))
      ).json(),
    ).toMatchObject({ google: { status: "connected" } });
    expect(fakeGoogle.revocations).toEqual(["google_refresh_token"]);
  },
);

test("uninstall accepts an already revoked Google token and still erases credentials", async () => {
  await installShop();
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  fakeGoogle.refreshTokens.clear();
  fakeGoogle.tokens.clear();

  expect(
    (await uninstall(routeArgs(webhookRequest("app/uninstalled")))).status,
  ).toBe(200);
  await installShop();
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({ google: null });
  expect(fakeGoogle.revocations).toEqual(["google_refresh_token"]);
});

test.each(["http", "network"])(
  "uninstall still erases Shop data when Google revocation fails (%s)",
  async (failure) => {
    await installShop();
    const state = await consentState();
    fakeGoogle.grant();
    await callback(callbackRequest(state));
    server.use(
      http.post("https://oauth2.googleapis.com/revoke", () =>
        failure === "network"
          ? HttpResponse.error()
          : new HttpResponse(null, { status: 503 }),
      ),
    );
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      (await uninstall(routeArgs(webhookRequest("app/uninstalled")))).status,
    ).toBe(200);
    await installShop();
    expect(
      await (await setup(routeArgs(adminRequest("/app")))).json(),
    ).toMatchObject({ google: null });
    expect(log).toHaveBeenCalledWith({
      event: "google-revoke-failed",
      shop: "test-shop.myshopify.com",
    });
  },
);

test("a stalled Google revocation does not hold up uninstall cleanup", async () => {
  await installShop();
  const state = await consentState();
  fakeGoogle.grant();
  await callback(callbackRequest(state));
  server.use(
    http.post("https://oauth2.googleapis.com/revoke", async () => {
      await delay(3000);
      return new HttpResponse(null, { status: 200 });
    }),
  );
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const started = Date.now();

  expect(
    (await uninstall(routeArgs(webhookRequest("app/uninstalled")))).status,
  ).toBe(200);
  expect(Date.now() - started).toBeLessThan(2500);
  await installShop();
  expect(
    await (await setup(routeArgs(adminRequest("/app")))).json(),
  ).toMatchObject({ google: null });
  expect(log).toHaveBeenCalledWith({
    event: "google-revoke-failed",
    shop: SHOP,
  });
});

test("uninstall clears Google credentials, Resources, and pending consent before reinstall", async () => {
  await installShop();
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
  const pendingState = await consentState();

  await uninstall(routeArgs(webhookRequest("app/uninstalled")));
  await installShop();

  const response = await setup(routeArgs(adminRequest("/app")));
  expect(await response.json()).toMatchObject({ google: null, resource: null });
  await expect(callback(callbackRequest(pendingState))).rejects.toMatchObject({
    status: 400,
  });
});
