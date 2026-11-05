import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { Resource } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { CalendarEntry } from "../google-calendar.server";
import type { loader as appLoader } from "./app";

interface SetupData {
  shop: { name: string; ianaTimezone: string };
  google: { status: string } | null;
  resource: Resource | null;
  serviceDefinition: { id: string; type: string } | null;
  themeEditorUrl: string | null;
  templateSetupUrl: string | null;
}
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(
    `query ShopSetup {
      shop { name ianaTimezone }
      metaobjectDefinitionByType(type: "$app:service") { id type }
      metaobjects(type: "$app:service", first: 1) { nodes { handle } }
    }`,
  );
  const result = (await response.json()) as {
    data?: {
      shop: SetupData["shop"];
      metaobjectDefinitionByType: SetupData["serviceDefinition"];
      metaobjects?: { nodes: { handle: string }[] };
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
  const editor = `https://${session.shop}/admin/themes/current/editor`;
  // Apps can't create theme templates, so the merchant creates it first by
  // previewing a Service page in the editor; only then can a block be deep-linked.
  const firstService = result.data.metaobjects?.nodes[0]?.handle;
  const templateSetupUrl = firstService
    ? `${editor}?` +
      new URLSearchParams({ previewPath: `/pages/services/${firstService}` })
    : null;
  const themeEditorUrl = definition
    ? `${editor}?` +
      new URLSearchParams({
        template: `metaobject/${definition.type}`,
        addAppBlockId: `${process.env.SHOPIFY_API_KEY}/book_service`,
        target: "newAppsSection",
      })
    : null;
  return Response.json(
    {
      themeEditorUrl,
      templateSetupUrl,
      shop: result.data.shop,
      google,
      resource,
      serviceDefinition: result.data.metaobjectDefinitionByType,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export default function Index() {
  const { shop, google, resource, themeEditorUrl, templateSetupUrl } =
    useLoaderData<SetupData>();
  const app = useRouteLoaderData<typeof appLoader>("routes/app");
  const connect = useFetcher<{ authorizationUrl: string }>();
  const calendarList = useFetcher<{
    calendars: CalendarEntry[];
    disconnected?: boolean;
  }>();
  const selection = useFetcher<{
    resource?: Resource;
    disconnected?: boolean;
  }>();
  const [calendarId, setCalendarId] = useState(resource?.calendarId ?? "");
  const disconnected =
    calendarList.data?.disconnected || selection.data?.disconnected;
  const googleStatus = disconnected
    ? "disconnected"
    : (app?.googleStatus ?? google?.status);
  const loadCalendars = calendarList.load;
  useEffect(() => {
    if (googleStatus === "connected")
      void loadCalendars("/app/google/calendars");
  }, [googleStatus, loadCalendars]);

  const badge =
    googleStatus === "connected" ? (
      <s-badge tone="success">Connected</s-badge>
    ) : googleStatus === "disconnected" ? (
      <s-badge tone="warning">Disconnected</s-badge>
    ) : (
      <s-badge>Not connected</s-badge>
    );

  return (
    <s-page heading="Setup">
      <s-section heading="Google account">
        <s-stack gap="base">
          {disconnected && app?.googleStatus !== "disconnected" && (
            <s-banner heading="Reconnect Google" tone="warning">
              Booking unavailable. Reconnect Google to restore Bookings.
            </s-banner>
          )}
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Google Calendar</s-text>
                {badge}
              </s-stack>
              <s-text color="subdued">
                {googleStatus === "connected"
                  ? "Bookings are written to your Google Calendar."
                  : "Connect Google to check availability and write Bookings."}
              </s-text>
            </s-stack>
            <connect.Form method="post" action="/app/google/connect">
              <s-button
                type="submit"
                variant={google ? "secondary" : "primary"}
                loading={connect.state !== "idle"}
              >
                {google ? "Reconnect Google" : "Connect Google"}
              </s-button>
            </connect.Form>
          </s-stack>
          {connect.data && (
            <s-banner tone="info">
              <s-link href={connect.data.authorizationUrl} target="_top">
                Continue to Google
              </s-link>{" "}
              to finish connecting.
            </s-banner>
          )}
        </s-stack>
      </s-section>
      {googleStatus === "connected" && (
        <s-section heading="Resource">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              The calendar customers book against; its busy times block Slots.
              In-person times show in the shop timezone ({shop.ianaTimezone}).
            </s-paragraph>
            {calendarList.data ? (
              calendarList.data.calendars.length ? (
                <selection.Form method="post" action="/app/google/calendars">
                  <s-grid
                    gridTemplateColumns="@container (inline-size > 480px) 1fr auto, 1fr"
                    gap="base"
                    alignItems="end"
                  >
                    <s-select
                      label="Calendar"
                      name="calendarId"
                      value={calendarId}
                      onChange={(event) =>
                        setCalendarId(event.currentTarget.value)
                      }
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
                      loading={selection.state !== "idle"}
                    >
                      Save Resource
                    </s-button>
                  </s-grid>
                </selection.Form>
              ) : (
                <s-banner tone="warning" heading="No writable calendars">
                  Add a calendar in Google, then reconnect.
                </s-banner>
              )
            ) : (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-spinner size="base" accessibilityLabel="Loading calendars" />
                <s-text color="subdued">Loading calendars…</s-text>
              </s-stack>
            )}
            {selection.data?.resource ? (
              <s-text tone="success">
                Resource saved: {selection.data.resource.name} (
                {selection.data.resource.timeZone})
              </s-text>
            ) : (
              resource && (
                <s-text color="subdued">
                  Current: {resource.name} ({resource.timeZone})
                </s-text>
              )
            )}
          </s-stack>
        </s-section>
      )}
      {themeEditorUrl && (
        <s-section heading="Service pages">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              One-time setup. Each Service gets its own storefront page once
              your theme has a Service page template.
            </s-paragraph>
            <s-ordered-list>
              <s-list-item>
                {templateSetupUrl ? (
                  <s-link href={templateSetupUrl} target="_blank">
                    Create the Service page template
                  </s-link>
                ) : (
                  "Create a Service first, then come back to create the template"
                )}
                : in the theme editor, choose Create template, then Save.
              </s-list-item>
              <s-list-item>
                <s-link href={themeEditorUrl} target="_blank">
                  Add the booking block
                </s-link>{" "}
                to that template, then Save.
              </s-list-item>
            </s-ordered-list>
            <s-paragraph color="subdued">
              Colors, corners, spacing and which customer fields show are set
              per block in the theme editor.
            </s-paragraph>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
