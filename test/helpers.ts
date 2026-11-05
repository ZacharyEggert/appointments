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
