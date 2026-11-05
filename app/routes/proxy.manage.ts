import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteGoogleEvent, getGoogleEvent } from "../google-calendar.server";
import { verifyManageToken } from "../manage-link.server";

function escape(value: string) {
  // Liquid is evaluated by Shopify after this HTML leaves the app.
  return value.replace(
    /[&<>"'{}]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

const cancelledPage =
  "<h1>Booking cancelled</h1><p>To reschedule, return to the Service and book again.</p>";

export async function loader({ request }: LoaderFunctionArgs) {
  return manage(request, false);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  return manage(request, true);
}

async function manage(request: Request, cancel: boolean) {
  const { session, liquid } = await authenticate.public.appProxy(request);
  if (!session) throw new Response("Booking unavailable", { status: 503 });
  const query = new URL(request.url).searchParams;
  const token = query.get("token");
  if (query.getAll("token").length !== 1)
    throw new Response("Invalid Manage link", { status: 403 });
  const { calendarId, eventId } = verifyManageToken(token, session.shop);
  const event = await getGoogleEvent(session.shop, calendarId, eventId).catch(
    () => {
      throw new Response("Booking unavailable. Please try again later.", {
        status: 503,
      });
    },
  );
  if (!event)
    return liquid(cancelledPage, { headers: { "Cache-Control": "no-store" } });
  if (
    event.extendedProperties?.private?.app !== "appointments" ||
    event.extendedProperties.private.shop !== session.shop
  )
    throw new Response("Invalid Manage link", { status: 403 });
  if (cancel) {
    await deleteGoogleEvent(session.shop, calendarId, eventId, "all").catch(
      () => {
        throw new Response("Booking unavailable. Please try again later.", {
          status: 503,
        });
      },
    );
    return liquid(cancelledPage, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const prefix = query.get("path_prefix") ?? "/apps/appointments";
  return liquid(
    `<h1>Manage Booking</h1>
    <h2>${escape(event.summary ?? "Booking")}</h2>
    <p>Starts: ${escape(event.start.dateTime ?? event.start.date ?? "")}</p>
    <p>Ends: ${escape(event.end.dateTime ?? event.end.date ?? "")}</p>
    <form method="post" action="${escape(prefix)}/manage?token=${escape(token!)}">
      <button type="submit">Cancel Booking</button>
    </form>`,
    { headers: { "Cache-Control": "no-store" } },
  );
}
