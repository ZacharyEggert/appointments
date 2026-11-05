import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  GoogleDisconnectedError,
  listGoogleCalendars,
} from "../google-calendar.server";

export const shouldRevalidate = () => true;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const google = await prisma.googleConnection.findUnique({
    where: { shop: session.shop },
    select: { status: true },
  });
  if (google?.status === "connected") {
    try {
      await listGoogleCalendars(session.shop);
    } catch (error) {
      if (error instanceof GoogleDisconnectedError)
        google.status = "disconnected";
      // A temporary Google failure must not prevent access to app settings.
      else if (!(error instanceof Response) && !(error instanceof TypeError))
        throw error;
    }
  }

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    googleStatus: google?.status ?? null,
  };
};

export default function App() {
  const { apiKey, googleStatus } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Setup
        </Link>
        <Link to="/app/settings">Opening hours and Slot rules</Link>
        <Link to="/app/services">Services</Link>
        <Link to="/app/bookings">Bookings</Link>
      </NavMenu>
      {googleStatus === "disconnected" && (
        <s-banner heading="Reconnect Google" tone="warning">
          Booking unavailable. Reconnect Google to restore Bookings.
          <s-link href="/app">Reconnect Google</s-link>
        </s-banner>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
