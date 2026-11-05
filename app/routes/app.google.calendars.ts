import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listGoogleCalendars } from "../google-calendar.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return Response.json(
    { calendars: await listGoogleCalendars(session.shop) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const calendarId = form.get("calendarId");
  const calendar = (await listGoogleCalendars(session.shop)).find(
    (item) => item.id === calendarId,
  );
  if (!calendar)
    throw new Response("Choose a writable calendar from your Google account", {
      status: 400,
    });
  const data = {
    calendarId: calendar.id,
    timeZone: calendar.timeZone,
    name: calendar.summaryOverride || calendar.summary,
  };
  const resource = await prisma.$transaction(async (tx) => {
    // Serialise v1 setup so simultaneous selections cannot create two Resources.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${session.shop}, 0))`;
    const existing = await tx.resource.findFirst({
      where: { shop: session.shop },
      orderBy: { id: "asc" },
    });
    return existing
      ? tx.resource.update({ where: { id: existing.id }, data })
      : tx.resource.create({ data: { shop: session.shop, ...data } });
  });
  return Response.json(
    { resource },
    { headers: { "Cache-Control": "no-store" } },
  );
}
