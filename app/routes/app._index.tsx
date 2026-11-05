import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { Resource } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { CalendarEntry } from "../google-calendar.server";

interface SetupData {
  shop: { name: string; ianaTimezone: string };
  google: { status: string } | null;
  resource: Resource | null;
  serviceDefinition: { id: string; type: string } | null;
  themeEditorUrl: string | null;
}
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(
    `query ShopSetup {
      shop { name ianaTimezone }
      metaobjectDefinitionByType(type: "$app:service") { id type }
    }`,
  );
  const result = (await response.json()) as {
    data?: {
      shop: SetupData["shop"];
      metaobjectDefinitionByType: SetupData["serviceDefinition"];
    };
    errors?: unknown;
  };
  if (!result.data?.shop || result.errors) {
    throw new Response("Could not load Shop setup", { status: 502 });
  }
  const google = await prisma.googleConnection.findUnique({
    where: { shop: session.shop },
    select: { status: true },
  });
  const resource = await prisma.resource.findFirst({
    where: { shop: session.shop },
    orderBy: { id: "asc" },
  });
  const definition = result.data.metaobjectDefinitionByType;
  const themeEditorUrl = definition
    ? `https://${session.shop}/admin/themes/current/editor?` +
      new URLSearchParams({
        template: `metaobject/${definition.type}`,
        addAppBlockId: `${process.env.SHOPIFY_API_KEY}/book_service`,
        target: "newAppsSection",
      })
    : null;
  return Response.json(
    {
      themeEditorUrl,
      shop: result.data.shop,
      google,
      resource,
      serviceDefinition: result.data.metaobjectDefinitionByType,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export default function Index() {
  const { shop, google, resource, themeEditorUrl } = useLoaderData<SetupData>();
  const connect = useFetcher<{ authorizationUrl: string }>();
  const calendarList = useFetcher<{ calendars: CalendarEntry[] }>();
  const selection = useFetcher<{ resource: Resource }>();
  const [calendarId, setCalendarId] = useState(resource?.calendarId ?? "");
  const loadCalendars = calendarList.load;
  useEffect(() => {
    if (google?.status === "connected")
      void loadCalendars("/app/google/calendars");
  }, [google?.status, loadCalendars]);

  return (
    <s-page heading="Appointments">
      <s-section heading={shop.name}>
        <s-paragraph>
          Connect Google and choose the calendar for your Resource.
        </s-paragraph>
        <s-paragraph>Shop timezone: {shop.ianaTimezone}</s-paragraph>
      </s-section>
      <s-section heading="Google account">
        <s-paragraph>
          {google?.status === "connected"
            ? "Google is connected."
            : "Connect Google to get started."}
        </s-paragraph>
        <connect.Form method="post" action="/app/google/connect">
          <s-button type="submit" loading={connect.state !== "idle"}>
            {google ? "Reconnect Google" : "Connect Google"}
          </s-button>
        </connect.Form>
        {connect.data && (
          <s-link href={connect.data.authorizationUrl} target="_top">
            Continue to Google
          </s-link>
        )}
      </s-section>
      {google?.status === "connected" && (
        <s-section heading="Resource">
          {resource && (
            <s-paragraph>
              Selected calendar: {resource.name} ({resource.timeZone})
            </s-paragraph>
          )}
          {calendarList.data ? (
            calendarList.data.calendars.length ? (
              <selection.Form method="post" action="/app/google/calendars">
                <s-select
                  label="Calendar"
                  name="calendarId"
                  value={calendarId}
                  onChange={(event) => setCalendarId(event.currentTarget.value)}
                  required
                >
                  <s-option value="">Choose a calendar</s-option>
                  {calendarList.data.calendars.map((calendar) => (
                    <s-option key={calendar.id} value={calendar.id}>
                      {calendar.summaryOverride || calendar.summary}
                    </s-option>
                  ))}
                </s-select>
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={!calendarId}
                  loading={selection.state !== "idle"}
                >
                  Save Resource
                </s-button>
              </selection.Form>
            ) : (
              <s-paragraph>
                No writable calendars found. Add a calendar in Google, then
                reconnect.
              </s-paragraph>
            )
          ) : (
            <s-paragraph>Loading calendars…</s-paragraph>
          )}
          {selection.data && <s-paragraph>Resource saved.</s-paragraph>}
        </s-section>
      )}
      {themeEditorUrl && (
        <s-section heading="Service pages">
          <s-paragraph>
            One-time setup: create the Service page template and add the booking
            block to it.
          </s-paragraph>
          <s-link href={themeEditorUrl} target="_blank">
            Open theme editor
          </s-link>
        </s-section>
      )}
    </s-page>
  );
}
