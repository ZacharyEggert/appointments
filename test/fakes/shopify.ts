import { http, HttpResponse } from "msw";

export const fakeShopify = {
  shop: { name: "Test guitar shop", ianaTimezone: "America/Los_Angeles" },
  serviceDefinitions: new Map<string, { id: string; type: string }>(),
  reset() {
    this.serviceDefinitions.clear();
    this.shop = {
      name: "Test guitar shop",
      ianaTimezone: "America/Los_Angeles",
    };
  },
};

export const shopifyHandlers = [
  http.post("https://:shop/admin/oauth/access_token", () =>
    HttpResponse.json({ error: "invalid_subject_token" }, { status: 400 }),
  ),
  http.post(
    "https://:shop/admin/api/:version/graphql.json",
    async ({ request, params }) => {
      if (
        request.headers.get("x-shopify-access-token") !== "shopify_test_token"
      ) {
        return new HttpResponse(null, { status: 401 });
      }
      const { query } = (await request.json()) as { query: string };
      if (query.includes("query ShopSetup")) {
        return HttpResponse.json({
          data: {
            shop: fakeShopify.shop,
            ...(query.includes(
              'metaobjectDefinitionByType(type: "$app:service")',
            )
              ? {
                  metaobjectDefinitionByType:
                    fakeShopify.serviceDefinitions.get(String(params.shop)) ??
                    null,
                }
              : {}),
          },
        });
      }
      return HttpResponse.json(
        { errors: [{ message: "Unimplemented fake GraphQL operation" }] },
        { status: 500 },
      );
    },
  ),
];
