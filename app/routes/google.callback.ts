import type { LoaderFunctionArgs } from "react-router";
import { completeGoogleConnection } from "../google-calendar.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await completeGoogleConnection(new URL(request.url));
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
