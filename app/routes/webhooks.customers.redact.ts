import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { customerPrivacyWebhook } from "../customer-gdpr.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, webhookId } = await authenticate.webhook(request);
  return customerPrivacyWebhook(shop, "customers/redact", payload, webhookId);
}
