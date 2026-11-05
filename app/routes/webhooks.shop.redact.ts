import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../shop-lifecycle.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);
  // shop/redact arrives ~48h after uninstall; a live Session means a reinstall.
  if (await db.session.findFirst({ where: { shop } })) {
    console.info({ event: "shop-redact-skipped-reinstalled", shop });
    return new Response();
  }
  await deleteShopData(shop);
  return new Response();
}
