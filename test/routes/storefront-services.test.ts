import { beforeEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { loader } from "../../app/routes/proxy.services";
import { action as changeService } from "../../app/routes/app.services";
import {
  adminRequest,
  installShop,
  proxyRequest,
  resourceForShop,
  routeArgs,
} from "../helpers";

beforeEach(() => installShop());

async function offering(resourceId: string, name: string, published = true) {
  const response = await changeService(
    routeArgs(
      adminRequest("/app/services", {
        method: "POST",
        body: new URLSearchParams({
          intent: "create",
          resource_id: resourceId,
          name,
          description: `About ${name}`,
          price_note: "$40, paid in store",
        }),
      }),
    ),
  );
  const { metaobject } = await response.json();
  if (published)
    await changeService(
      routeArgs(
        adminRequest("/app/services", {
          method: "POST",
          body: new URLSearchParams({ intent: "publish", id: metaobject.id }),
        }),
      ),
    );
  return metaobject;
}

test("the storefront lists all published Services across pages with only public display fields", async () => {
  const resource = await resourceForShop();
  const lesson = await offering(resource.id, "Lesson");
  await offering(resource.id, "Unpublished", false);
  const setup = await offering(resource.id, "Setup");
  const dropoff = await offering(resource.id, "Drop-off");
  const response = await loader(routeArgs(proxyRequest("/proxy/services")));
  expect(await response.json()).toEqual({
    services: [
      {
        handle: lesson.handle,
        name: "Lesson",
        description: "About Lesson",
        priceNote: "$40, paid in store",
        durationMinutes: 30,
      },
      {
        handle: setup.handle,
        name: "Setup",
        description: "About Setup",
        priceNote: "$40, paid in store",
        durationMinutes: 30,
      },
      {
        handle: dropoff.handle,
        name: "Drop-off",
        description: "About Drop-off",
        priceNote: "$40, paid in store",
        durationMinutes: 30,
      },
    ],
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("a block's handle list narrows published Services with exact matches", async () => {
  const resource = await resourceForShop();
  const lesson = await offering(resource.id, "Lesson");
  await offering(resource.id, "Setup");
  const draft = await offering(resource.id, "Draft", false);
  const response = await loader(
    routeArgs(
      proxyRequest("/proxy/services", {
        services: ` ${lesson.handle}, ${draft.handle}, ${lesson.handle}-extra, missing `,
      }),
    ),
  );
  expect(await response.json()).toEqual({
    services: [
      {
        handle: lesson.handle,
        name: "Lesson",
        description: "About Lesson",
        priceNote: "$40, paid in store",
        durationMinutes: 30,
      },
    ],
  });
});

test("an unmatched handle list stays empty rather than showing other Services", async () => {
  const resource = await resourceForShop();
  await offering(resource.id, "Lesson");
  const response = await loader(
    routeArgs(proxyRequest("/proxy/services", { services: "missing" })),
  );
  expect(await response.json()).toEqual({ services: [] });
});

test("unsigned and tampered requests cannot list Services", async () => {
  await expect(
    loader(routeArgs(new Request("https://app.test/proxy/services"))),
  ).rejects.toMatchObject({ status: 400 });
  const tampered = new URL(proxyRequest("/proxy/services").url);
  tampered.searchParams.set("services", "lesson");
  await expect(loader(routeArgs(new Request(tampered)))).rejects.toMatchObject({
    status: 400,
  });
});

test("a signed Shop only lists its own Services and needs an installation", async () => {
  const resource = await resourceForShop();
  await offering(resource.id, "Lesson");
  const other = "other.myshopify.com";
  await installShop(other);
  const response = await loader(
    routeArgs(proxyRequest("/proxy/services", {}, other)),
  );
  expect(await response.json()).toEqual({ services: [] });
  await expect(
    loader(
      routeArgs(
        proxyRequest("/proxy/services", {}, "uninstalled.myshopify.com"),
      ),
    ),
  ).rejects.toMatchObject({ status: 503 });
});

test("a Shopify failure is not presented as an empty Service list", async () => {
  server.use(
    http.post("https://:shop/admin/api/:version/graphql.json", () =>
      HttpResponse.json({ errors: [{ message: "Unavailable" }] }),
    ),
  );
  await expect(
    loader(routeArgs(proxyRequest("/proxy/services"))),
  ).rejects.toMatchObject({ status: 502 });
});
