import { createHmac, timingSafeEqual } from "node:crypto";

function signature(payload: string) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Missing SHOPIFY_API_SECRET");
  return createHmac("sha256", secret)
    .update(`manage:v1:${payload}`)
    .digest("hex");
}

export function manageLink(
  shop: string,
  calendarId: string,
  eventId: string,
  proxyPath: string,
) {
  const payload = Buffer.from(
    JSON.stringify({ shop, calendarId, eventId }),
  ).toString("base64url");
  return `https://${shop}${proxyPath}/manage?token=${payload}.${signature(payload)}`;
}

export function verifyManageToken(token: string | null, shop: string) {
  try {
    if (!token || token.length > 8192) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1]))
      throw new Error();
    if (
      !timingSafeEqual(
        Buffer.from(parts[1], "hex"),
        Buffer.from(signature(parts[0]), "hex"),
      )
    )
      throw new Error();
    const identity = JSON.parse(
      Buffer.from(parts[0], "base64url").toString(),
    ) as {
      shop: string;
      calendarId: string;
      eventId: string;
    };
    if (
      identity.shop !== shop ||
      typeof identity.calendarId !== "string" ||
      !identity.calendarId ||
      typeof identity.eventId !== "string" ||
      !identity.eventId
    )
      throw new Error();
    return identity;
  } catch {
    throw new Response("Invalid Manage link", { status: 403 });
  }
}
