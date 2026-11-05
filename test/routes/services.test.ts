import { beforeEach, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { loader, action } from "../../app/routes/app.services";
import { action as saveSettings } from "../../app/routes/app.settings";
import { fakeShopify } from "../fakes/shopify";
import {
  adminRequest,
  installShop,
  routeArgs,
  SHOP,
  resourceForShop,
} from "../helpers";

beforeEach(() => installShop());

test("Services setup creates a storefront-readable app definition once and finds it again after reinstall", async () => {
  await loader(routeArgs(adminRequest("/app/services")));
  const definition = fakeShopify.definitions.get(SHOP);
  expect(definition).toMatchObject({
    type: "$app:service",
    displayNameKey: "name",
    access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
    capabilities: {
      publishable: { enabled: true },
      renderable: {
        enabled: true,
        data: { metaTitleKey: "name", metaDescriptionKey: "description" },
      },
      onlineStore: { enabled: true, data: { urlHandle: "services" } },
    },
  });
  expect(definition?.fieldDefinitions.map((f) => f.key)).toEqual([
    "name",
    "description",
    "duration_minutes",
    "start_interval_minutes",
    "buffer_before_minutes",
    "buffer_after_minutes",
    "min_notice_minutes",
    "max_advance_days",
    "blocking",
    "location",
    "meet_enabled",
    "price_note",
    "resource_id",
  ]);
  await installShop();
  await loader(routeArgs(adminRequest("/app/services")));
  expect(fakeShopify.definitionCreates).toBe(1);
});

test("editing a Service clears overrides back to current shop defaults while preserving draft status", async () => {
  const resource = await resourceForShop();
  await change("create", {
    name: "Lesson",
    resource_id: resource.id,
    duration_minutes: "60",
    min_notice_minutes: "180",
    price_note: "$40",
  });
  const {
    services: [original],
  } = await services();
  await saveSettings(
    routeArgs(
      adminRequest("/app/settings", {
        method: "POST",
        body: new URLSearchParams({
          settings: JSON.stringify({
            slotRules: {
              durationMinutes: 45,
              startIntervalMinutes: 20,
              bufferBeforeMinutes: 5,
              bufferAfterMinutes: 10,
              minNoticeMinutes: 60,
              maxAdvanceDays: 90,
            },
          }),
        }),
      }),
    ),
  );
  expect(
    (
      await change("edit", {
        id: original.id,
        name: "New lesson",
        description: "Updated",
        resource_id: resource.id,
        start_interval_minutes: "30",
        buffer_before_minutes: "0",
        location: "remote",
      })
    ).status,
  ).toBe(200);
  expect((await services()).services).toEqual([
    expect.objectContaining({
      id: original.id,
      name: "New lesson",
      description: "Updated",
      priceNote: "",
      status: "DRAFT",
      blocking: true,
      meetEnabled: true,
      slotRules: {
        durationMinutes: 45,
        startIntervalMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 10,
        minNoticeMinutes: 60,
        maxAdvanceDays: 90,
      },
    }),
  ]);
});

async function services(shop = SHOP) {
  return (
    await loader(routeArgs(adminRequest("/app/services", {}, shop)))
  ).json();
}

function change(intent: string, fields: Record<string, string>, shop = SHOP) {
  return action(
    routeArgs(
      adminRequest(
        "/app/services",
        {
          method: "POST",
          body: new URLSearchParams({ intent, ...fields }),
        },
        shop,
      ),
    ),
  );
}

test("a merchant creates a draft Service with all offering fields and reads it back", async () => {
  const resource = await resourceForShop();
  const response = await change("create", {
    name: "Guitar lesson",
    description: "Bring your guitar",
    resource_id: resource.id,
    duration_minutes: "60",
    start_interval_minutes: "30",
    buffer_before_minutes: "10",
    buffer_after_minutes: "15",
    min_notice_minutes: "1440",
    max_advance_days: "90",
    blocking: "false",
    location: "remote",
    meet_enabled: "false",
    price_note: "$40, paid in store",
  });
  expect(response.status).toBe(200);
  expect((await services()).services).toEqual([
    expect.objectContaining({
      name: "Guitar lesson",
      description: "Bring your guitar",
      resourceId: resource.id,
      status: "DRAFT",
      blocking: false,
      location: "remote",
      meetEnabled: false,
      priceNote: "$40, paid in store",
      slotRules: {
        durationMinutes: 60,
        startIntervalMinutes: 30,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 15,
        minNoticeMinutes: 1440,
        maxAdvanceDays: 90,
      },
    }),
  ]);
});

test("publishing and unpublishing a Service changes only its published status", async () => {
  const resource = await resourceForShop();
  await change("create", {
    name: "Lesson",
    resource_id: resource.id,
    duration_minutes: "60",
    blocking: "false",
  });
  const {
    services: [original],
  } = await services();
  await change("publish", { id: original.id });
  expect((await services()).services).toEqual([
    { ...original, status: "ACTIVE" },
  ]);
  await change("unpublish", { id: original.id });
  expect((await services()).services).toEqual([original]);
});

test("deleting a Service removes it from the merchant's list", async () => {
  const resource = await resourceForShop();
  await change("create", { name: "Lesson", resource_id: resource.id });
  const {
    services: [original],
  } = await services();
  expect((await change("delete", { id: original.id })).status).toBe(200);
  expect((await services()).services).toEqual([]);
});

test("the Service list includes every page from Shopify", async () => {
  const resource = await resourceForShop();
  for (const name of ["Lesson", "Setup", "Drop-off"])
    await change("create", { name, resource_id: resource.id });
  expect(
    (await services()).services.map((s: { name: string }) => s.name),
  ).toEqual(["Lesson", "Setup", "Drop-off"]);
});

test("simultaneous first admin loads reuse the definition when Shopify reports TAKEN", async () => {
  let reads = 0;
  server.use(
    http.post(
      "https://:shop/admin/api/:version/graphql.json",
      async ({ request }) => {
        const { query } = (await request.clone().json()) as { query: string };
        if (query.includes("query ServiceDefinition") && ++reads <= 2)
          return HttpResponse.json({
            data: { metaobjectDefinitionByType: null },
          });
      },
    ),
  );
  const results = await Promise.all([services(), services()]);
  expect(results.map((r) => r.definition.type)).toEqual([
    "app--12345--service",
    "app--12345--service",
  ]);
});

test("another Shop cannot read or mutate a Service or use its Resource", async () => {
  const resource = await resourceForShop();
  await change("create", { name: "Lesson", resource_id: resource.id });
  const {
    services: [original],
  } = await services();
  const other = "other.myshopify.com";
  await installShop(other);
  expect((await services(other)).services).toEqual([]);
  for (const intent of ["edit", "publish", "unpublish", "delete"]) {
    await expect(
      change(
        intent,
        { id: original.id, name: "Stolen", resource_id: resource.id },
        other,
      ),
    ).rejects.toMatchObject({ status: 404 });
  }
  await expect(
    change("create", { name: "Stolen", resource_id: resource.id }, other),
  ).rejects.toMatchObject({ status: 400 });
  expect((await services()).services).toEqual([original]);
});

test("a non-Service metaobject cannot be edited, published or deleted through Services", async () => {
  const resource = await resourceForShop();
  await change("create", { name: "Lesson", resource_id: resource.id });
  const object = fakeShopify.services.get(SHOP)![0];
  object.type = "some_other_type";
  for (const intent of ["edit", "publish", "delete"]) {
    await expect(
      change(intent, {
        id: object.id,
        name: "Wrong type",
        resource_id: resource.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  }
  expect(object.fields.find((f) => f.key === "name")?.value).toBe("Lesson");
});

test("invalid Service edits are rejected without changing the saved offering", async () => {
  const resource = await resourceForShop();
  await change("create", { name: "Lesson", resource_id: resource.id });
  const {
    services: [original],
  } = await services();
  const invalidEdits: Record<string, string>[] = [
    { duration_minutes: "0" },
    { min_notice_minutes: "-1" },
    { max_advance_days: "1.5" },
    { blocking: "yes" },
    { location: "anywhere" },
    { name: " " },
  ];
  for (const invalid of invalidEdits) {
    await expect(
      change("edit", {
        id: original.id,
        name: "Lesson",
        resource_id: resource.id,
        ...invalid,
      }),
    ).rejects.toMatchObject({ status: 400 });
  }
  await expect(change("unknown", { id: original.id })).rejects.toMatchObject({
    status: 400,
  });
  expect((await services()).services).toEqual([original]);
});

test("Shopify definition errors are shown without retrying an unavailable services URL handle", async () => {
  server.use(
    http.post(
      "https://:shop/admin/api/:version/graphql.json",
      async ({ request }) => {
        const { query } = (await request.clone().json()) as { query: string };
        if (query.includes("mutation CreateServiceDefinition"))
          return HttpResponse.json({
            data: {
              metaobjectDefinitionCreate: {
                metaobjectDefinition: null,
                userErrors: [
                  {
                    code: "URL_HANDLE_TAKEN",
                    message: "The services URL handle is already taken",
                  },
                ],
              },
            },
          });
      },
    ),
  );
  const error = await loader(routeArgs(adminRequest("/app/services"))).catch(
    (e: Response) => e,
  );
  expect(error.status).toBe(422);
  expect(await error.text()).toContain("services URL handle is already taken");
});

test("Shopify mutation userErrors are returned to the merchant without reporting success", async () => {
  const resource = await resourceForShop();
  server.use(
    http.post(
      "https://:shop/admin/api/:version/graphql.json",
      async ({ request }) => {
        const { query } = (await request.clone().json()) as { query: string };
        if (query.includes("mutation CreateService("))
          return HttpResponse.json({
            data: {
              metaobjectCreate: {
                metaobject: null,
                userErrors: [
                  {
                    field: ["metaobject", "values", "name"],
                    message: "Invalid Service name",
                  },
                ],
              },
            },
          });
      },
    ),
  );
  const response = await change("create", {
    name: "Lesson",
    resource_id: resource.id,
  });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    userErrors: [{ message: "Invalid Service name" }],
  });
  expect((await services()).services).toEqual([]);
});
