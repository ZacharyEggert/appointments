import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { googleAuthorizationUrl } from "../google-calendar.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return Response.json(
    { authorizationUrl: await googleAuthorizationUrl(session.shop) },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
