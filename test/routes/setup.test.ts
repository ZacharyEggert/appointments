import { beforeEach, expect, test } from "vitest";
import { loader } from "../../app/routes/app._index";
import { adminRequest, installShop, routeArgs } from "../helpers";

beforeEach(() => installShop());

test("an installed Shop sees its setup through authenticated Admin GraphQL", async () => {
  const response = await loader(routeArgs(adminRequest("/app")));
  expect(await response.json()).toMatchObject({
    shop: { name: "Test guitar shop", ianaTimezone: "America/Los_Angeles" },
  });
});
