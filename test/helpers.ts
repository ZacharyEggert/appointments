import { action as saveSettings } from "../app/routes/app.settings";
import { action as changeService } from "../app/routes/app.services";
import { defaultSlotRules } from "../app/slot-rules";
import { action as connect } from "../app/routes/app.google.connect";
import { loader as callback } from "../app/routes/google.callback";
import { action as selectCalendar } from "../app/routes/app.google.calendars";
import { fakeGoogle } from "./fakes/google";
import { createHmac, randomUUID } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { Session } from "@shopify/shopify-app-react-router/server";
import { sessionStorage } from "../app/shopify.server";

export const SHOP = "test-shop.myshopify.com";

export async function installShop(shop = SHOP) {
  await sessionStorage.storeSession(
    new Session({
      id: `offline_${shop}`,
      shop,
      state: "test",
      isOnline: false,
      accessToken: "shopify_test_token",
      scope: process.env.SCOPES,
    }),
  );
}

export function sessionToken(shop = SHOP) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: "test_key",
      sub: "1",
      exp: now + 60,
      nbf: now - 5,
      iat: now,
      jti: randomUUID(),
      sid: "s1",
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", "test_secret")
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function adminRequest(
  path: string,
  init: RequestInit = {},
  shop = SHOP,
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${sessionToken(shop)}`);
  return new Request(new URL(path, "https://app.test"), { ...init, headers });
}

export function routeArgs(request: Request): LoaderFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: new URL(request.url).pathname,
    params: {},
    context: {},
  };
}

export async function resourceForShop() {
  const response = await connect(
    routeArgs(adminRequest("/app/google/connect", { method: "POST" })),
  );
  const { authorizationUrl } = await response.json();
  fakeGoogle.grant();
  const state = new URL(authorizationUrl).searchParams.get("state")!;
  await callback(
    routeArgs(
      new Request(
        `https://app.test/google/callback?state=${state}&code=google_code`,
      ),
    ),
  );
  const selected = await selectCalendar(
    routeArgs(
      adminRequest("/app/google/calendars", {
        method: "POST",
        body: new URLSearchParams({ calendarId: "merchant@example.com" }),
      }),
    ),
  );
  return (await selected.json()).resource;
}

export async function consentState(shop = SHOP) {
  const response = await connect(
    routeArgs(adminRequest("/app/google/connect", { method: "POST" }, shop)),
  );
  const { authorizationUrl } = await response.json();
  return new URL(authorizationUrl).searchParams.get("state")!;
}

export function callbackRequest(state: string, code = "google_code") {
  return routeArgs(
    new Request(
      `https://app.test/google/callback?${new URLSearchParams({ state, code })}`,
    ),
  );
}

export function webhookRequest(
  topic: string,
  payload: unknown = {},
  shop = SHOP,
) {
  const body = JSON.stringify(payload);
  return new Request(`https://app.test/webhooks/${topic}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": randomUUID(),
      "X-Shopify-Hmac-Sha256": createHmac("sha256", "test_secret")
        .update(body)
        .digest("base64"),
    },
  });
}

export function proxyRequest(
  path: string,
  query: Record<string, string> = {},
  shop = SHOP,
) {
  const url = new URL(path, "https://app.test");
  url.search = new URLSearchParams({
    path_prefix: "/apps/appointments",
    logged_in_customer_id: "",
    ...query,
    shop,
    timestamp: String(Math.floor(Date.now() / 1000)),
  }).toString();
  const message = [...url.searchParams.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${url.searchParams.getAll(key).join(",")}`)
    .join("");
  url.searchParams.set(
    "signature",
    createHmac("sha256", "test_secret").update(message).digest("hex"),
  );
  return new Request(url);
}

export async function serviceForShop(
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
