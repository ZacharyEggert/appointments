import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { storefrontService } from "../services.server";
import { invalid, shopSlotRules } from "../settings.server";
import { availableSlots } from "../availability";
import type { OpeningHours } from "../slot-rules";
import { googleBusy } from "../google-calendar.server";

function rangeDate(value: string | null) {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    invalid("Provide from/to timestamps with an explicit offset");
  const date = new Date(value);
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    invalid("Invalid availability date");
  return date;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session)
    throw new Response("Booking unavailable", { status: 503 });
  const query = new URL(request.url).searchParams;
  for (const key of ["service", "from", "to", "timezone"]) {
    if (query.getAll(key).length > 1) invalid(`Provide one ${key}`);
  }
  const handle = query.get("service");
  if (!handle || handle.length > 255) invalid("Provide a Service handle");
  const from = rangeDate(query.get("from"));
  const to = rangeDate(query.get("to"));
  if (from >= to || to.getTime() - from.getTime() > 31 * 86_400_000)
    invalid("Availability ranges must be positive and at most 31 days");
  const requestedTimeZone = query.get("timezone");
  if (requestedTimeZone !== null) {
    try {
      if (/^[+-]/.test(requestedTimeZone)) invalid("Provide an IANA timezone");
      new Intl.DateTimeFormat("en-US", { timeZone: requestedTimeZone });
    } catch {
      invalid("Provide an IANA timezone");
    }
  }
  const { service, shopTimeZone } = await storefrontService(
    admin,
    handle,
    await shopSlotRules(session.shop),
  );
  const resource = await prisma.resource.findFirst({
    where: { id: service.resourceId, shop: session.shop },
  });
  if (!resource) throw new Response("Booking unavailable", { status: 503 });
  let busy;
  try {
    busy = await googleBusy(
      session.shop,
      resource.calendarId,
      new Date(from.getTime() - service.slotRules.bufferBeforeMinutes * 60_000),
      new Date(to.getTime() + service.slotRules.bufferAfterMinutes * 60_000),
    );
  } catch {
    throw new Response("Booking unavailable", { status: 503 });
  }
  return Response.json(
    {
      timeZone:
        service.location === "remote"
          ? (requestedTimeZone ?? shopTimeZone)
          : shopTimeZone,
      slots: availableSlots({
        openingHours: resource.openingHours as unknown as OpeningHours[],
        timeZone: resource.timeZone,
        rules: service.slotRules,
        from,
        to,
        busy,
        now: new Date(),
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
