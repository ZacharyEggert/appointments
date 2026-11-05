import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  GoogleDisconnectedError,
  upcomingAppEvents,
} from "../google-calendar.server";

interface BookingRow {
  id: string;
  start: string;
  service: string;
  customer: string;
  product: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const headers = { "Cache-Control": "no-store" };
  const resource = await prisma.resource.findFirst({
    where: { shop: session.shop },
    orderBy: { id: "asc" },
  });
  if (!resource)
    return Response.json({ disconnected: false, bookings: [] }, { headers });
  try {
    const events = await upcomingAppEvents(
      session.shop,
      resource.calendarId,
      new Date(),
    );
    const bookings: BookingRow[] = events
      .filter((e) => e.status !== "cancelled")
      .map((e) => ({
        id: e.id,
        start: e.start.dateTime ?? e.start.date ?? "",
        service: /^Service: (.*)$/m.exec(e.description ?? "")?.[1] ?? "",
        customer:
          e.attendees?.[0]?.displayName ??
          /^Customer: (.*)$/m.exec(e.description ?? "")?.[1] ??
          "",
        // ponytail: product title read from ext prop; #5 decides what it writes
        product: e.extendedProperties?.private?.productTitle ?? null,
      }));
    return Response.json({ disconnected: false, bookings }, { headers });
  } catch (error) {
    if (!(error instanceof GoogleDisconnectedError)) throw error;
    return Response.json({ disconnected: true, bookings: [] }, { headers });
  }
}

export default function Bookings() {
  const { disconnected, bookings } = useLoaderData<{
    disconnected: boolean;
    bookings: BookingRow[];
  }>();
  if (disconnected)
    return (
      <s-page heading="Bookings">
        <s-banner tone="warning" heading="Reconnect Google">
          <s-link href="/app">Reconnect Google</s-link> to see Bookings.
        </s-banner>
      </s-page>
    );
  return (
    <s-page heading="Bookings">
      <s-section>
        {bookings.length === 0 ? (
          <s-paragraph>No upcoming Bookings.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Time</s-table-header>
              <s-table-header>Service</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Product</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {bookings.map((b) => (
                <s-table-row key={b.id}>
                  <s-table-cell>
                    {new Date(b.start).toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>{b.service}</s-table-cell>
                  <s-table-cell>{b.customer}</s-table-cell>
                  <s-table-cell>{b.product ?? "—"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
