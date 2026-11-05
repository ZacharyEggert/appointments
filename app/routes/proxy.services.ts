import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listServices } from "../services.server";
import { shopSlotRules } from "../settings.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session)
    throw new Response("Booking unavailable", { status: 503 });
  const handles = (new URL(request.url).searchParams.get("services") ?? "")
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean);
  const services = await listServices(
    admin,
    await shopSlotRules(session.shop),
  ).catch(() => {
    throw new Response("Could not load Services from Shopify", { status: 502 });
  });
  return Response.json(
    {
      services: services
        .filter(
          (service) =>
            service.status === "ACTIVE" &&
            (!handles.length || handles.includes(service.handle)),
        )
        .map(({ handle, name, description, priceNote }) => ({
          handle,
          name,
          description,
          priceNote,
        })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
