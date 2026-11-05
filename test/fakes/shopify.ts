import { http, HttpResponse } from "msw";

export const fakeShopify = {
  shop: { name: "Test guitar shop", ianaTimezone: "America/Los_Angeles" },
  reset() {
    this.shop = {
      name: "Test guitar shop",
      ianaTimezone: "America/Los_Angeles",
    };
  },
};

export const shopifyHandlers = [
  http.post(
    "https://:shop/admin/api/:version/graphql.json",
    async ({ request }) => {
      if (
        request.headers.get("x-shopify-access-token") !== "shopify_test_token"
      ) {
        return new HttpResponse(null, { status: 401 });
      }
      const { query } = (await request.json()) as { query: string };
      if (query.includes("query ShopSetup")) {
        return HttpResponse.json({ data: { shop: fakeShopify.shop } });
      }
      return HttpResponse.json(
        { errors: [{ message: "Unimplemented fake GraphQL operation" }] },
        { status: 500 },
      );
    },
  ),
];
