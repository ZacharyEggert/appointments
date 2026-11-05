import { beforeEach, expect, test } from "vitest";
import { loader } from "../../app/routes/app._index";
import { action as changeService } from "../../app/routes/app.services";
import {
  adminRequest,
  installShop,
  resourceForShop,
  routeArgs,
} from "../helpers";

beforeEach(() => installShop());

test("an installed Shop sees its setup through authenticated Admin GraphQL", async () => {
  const response = await loader(routeArgs(adminRequest("/app")));
  expect(await response.json()).toMatchObject({
    shop: { name: "Test guitar shop", ianaTimezone: "America/Los_Angeles" },
  });
});

test("setup deep-links the theme editor to the Service page template with the booking block", async () => {
  const resource = await resourceForShop();
  await changeService(
    routeArgs(
      adminRequest("/app/services", {
        method: "POST",
        body: new URLSearchParams({
          intent: "create",
          resource_id: resource.id,
          name: "Lesson",
        }),
      }),
    ),
  );
  const response = await loader(routeArgs(adminRequest("/app")));
  const { themeEditorUrl } = await response.json();
  const url = new URL(themeEditorUrl);
  expect(url.origin + url.pathname).toBe(
    "https://test-shop.myshopify.com/admin/themes/current/editor",
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    template: "metaobject/app--12345--service",
    addAppBlockId: `${process.env.SHOPIFY_API_KEY}/book_service`,
    target: "newAppsSection",
  });
});
