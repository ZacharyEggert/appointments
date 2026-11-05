import type { ActionFunctionArgs } from "react-router";
import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import { storefrontService } from "../services.server";
import { invalid, shopSlotRules } from "../settings.server";
import { book, type SubjectProduct } from "../booking.server";
import { timestamp } from "../timestamp.server";
import { bookingRetryAfter } from "../booking-abuse.server";

function text(
  input: Record<string, unknown>,
  key: string,
  max: number,
  optional = false,
) {
  const value = input[key] ?? (optional ? "" : null);
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!optional && !value.trim())
  )
    invalid(`Invalid ${key}`);
  return value.trim();
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session)
    throw new Response("Booking unavailable", { status: 503 });
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  let input: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 16_384) invalid("Booking input too large");
    input = JSON.parse(body);
  } catch {
    invalid("Invalid Booking JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("Provide Booking details");
  if (input.website)
    return Response.json(
      { status: "confirmed", eventId: randomUUID().replaceAll("-", "") },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  const handle = text(input, "service", 255);
  const slotStart = timestamp(text(input, "slotStart", 40));
  const customer = {
    name: text(input, "name", 200),
    email: text(input, "email", 254),
    phone: text(input, "phone", 100, true),
    notes: text(input, "notes", 4000, true),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
    invalid("Invalid email");
  const retryAfter = await bookingRetryAfter(
    session.shop,
    request.headers.get("X-Forwarded-For"),
    customer.email,
  );
  if (retryAfter)
    return Response.json(
      { status: "rate-limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  let subject: SubjectProduct | undefined;
  if (input.subjectProduct !== undefined) {
    const sp = input.subjectProduct;
    if (!sp || typeof sp !== "object" || Array.isArray(sp))
      invalid("Invalid subjectProduct");
    const fields = sp as Record<string, unknown>;
    subject = {
      id: text(fields, "id", 100),
      title: text(fields, "title", 500),
    };
  }
  const { service } = await storefrontService(
    admin,
    handle,
    await shopSlotRules(session.shop),
  );
  const proxyPath =
    new URL(request.url).searchParams.get("path_prefix") ??
    "/apps/appointments";
  // Signed by the app proxy; empty for guests.
  const customerId =
    new URL(request.url).searchParams.get("logged_in_customer_id") || undefined;

  const result = await book(
    session.shop,
    service,
    slotStart,
    customer,
    proxyPath,
    customerId,
    subject,
  );
  return Response.json(result, {
    status:
      result.status === "confirmed"
        ? 201
        : result.status === "slot-taken"
          ? 409
          : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
