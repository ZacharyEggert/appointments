import db from "./db.server";
import { emailHash } from "./customer-email.server";
import {
  GoogleDisconnectedError,
  googleEventsByProperty,
  writeGoogleEvent,
  type GoogleEvent,
} from "./google-calendar.server";

export interface CustomerPayload {
  customer?: { email?: string | null; id?: number | string | null };
  data_request?: { id?: number | string };
}

async function collectCustomerData(
  shop: string,
  payload: CustomerPayload,
  webhookId: string,
) {
  const bookings = await customerBookings(shop, payload);
  console.info(
    JSON.stringify({
      event: "customer-data-request",
      shop,
      webhookId,
      requestId: payload.data_request?.id,
      bookings,
    }),
  );
}

async function customerBookings(shop: string, payload: CustomerPayload) {
  const email = payload.customer?.email;
  const filters: [string, string][] = [];
  if (email?.trim()) filters.push(["emailHash", emailHash(email)]);
  if (payload.customer?.id != null)
    filters.push([
      "customerId",
      `gid://shopify/Customer/${payload.customer.id}`,
    ]);
  if (!filters.length) return [];
  const connection = await db.googleConnection.findUnique({ where: { shop } });
  if (!connection || connection.status !== "connected")
    throw new GoogleDisconnectedError();
  const resources = await db.resource.findMany({ where: { shop } });
  const bookings = [];
  for (const calendarId of new Set(
    resources.map((resource) => resource.calendarId),
  )) {
    const events = new Map<string, GoogleEvent>();
    for (const [key, value] of filters) {
      for (const event of await googleEventsByProperty(
        shop,
        calendarId,
        key,
        value,
      ))
        events.set(event.id, event);
    }
    for (const event of events.values()) {
      const properties = event.extendedProperties?.private;
      if (properties?.app === "appointments" && properties.shop === shop)
        bookings.push({ calendarId, event });
    }
  }
  return bookings;
}

async function redactCustomer(shop: string, payload: CustomerPayload) {
  const bookings = await customerBookings(shop, payload);
  let failed = false;
  for (const { calendarId, event } of bookings) {
    const properties = Object.fromEntries(
      Object.entries(event.extendedProperties?.private ?? {}).map(
        ([key, value]) => [
          key,
          [
            "app",
            "shop",
            "serviceId",
            "productId",
            "subjectProductId",
          ].includes(key)
            ? value
            : null,
        ],
      ),
    );
    try {
      await writeGoogleEvent(
        shop,
        calendarId,
        {
          summary: "Redacted booking",
          description: "",
          location: "",
          attendees: [],
          extendedProperties: { private: properties },
        },
        event.id,
        false,
        { sendUpdates: "none" },
      );
    } catch (error) {
      if (error instanceof GoogleDisconnectedError) throw error;
      failed = true;
    }
  }
  if (failed) throw new Error("Google redaction incomplete");
}

export async function customerPrivacyWebhook(
  shop: string,
  topic: "customers/redact" | "customers/data_request",
  payload: CustomerPayload,
  webhookId: string,
) {
  try {
    if (topic === "customers/redact") await redactCustomer(shop, payload);
    else await collectCustomerData(shop, payload, webhookId);
  } catch (error) {
    const disconnected = error instanceof GoogleDisconnectedError;
    console.warn({
      event: "customer-gdpr-failed",
      topic,
      shop,
      webhookId,
      reason: disconnected ? "google-disconnected" : "google-unavailable",
    });
    if (!disconnected && topic === "customers/redact")
      return new Response(null, { status: 500 });
  }
  return new Response();
}
