import { http, HttpResponse } from "msw";

interface Definition {
  id: string;
  type: string;
  displayNameKey: string;
  access: { admin: string; storefront: string };
  capabilities: Record<string, unknown>;
  fieldDefinitions: { key: string; type: string; required?: boolean }[];
}
interface FakeMetaobject {
  id: string;
  type: string;
  handle: string;
  capabilities: { publishable: { status: string } };
  fields: { key: string; value: string }[];
}

export const fakeShopify = {
  definitions: new Map<string, Definition>(),
  definitionCreates: 0,
  services: new Map<string, FakeMetaobject[]>(),
  nextId: 1,
  products: new Map<string, string>(), // gid -> title
  shop: { name: "Test guitar shop", ianaTimezone: "America/Los_Angeles" },
  serviceDefinitions: new Map<string, { id: string; type: string }>(),
  reset() {
    this.definitions.clear();
    this.definitionCreates = 0;
    this.services.clear();
    this.nextId = 1;
    this.products.clear();
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
      const { query, variables } = (await request.json()) as {
        query: string;
        variables: {
          after?: string;
          handle?: { type: string; handle: string };
          id: string;
          definition: Definition;
          metaobject: {
            type: string;
            values: Record<string, string | number | boolean>;
            capabilities: FakeMetaobject["capabilities"];
          };
        };
      };
      const shop = String(params.shop);
      if (query.includes("query SlotService(")) {
        const definition = fakeShopify.definitions.get(shop);
        return HttpResponse.json({
          data: {
            shop: fakeShopify.shop,
            metaobjectDefinitionByType: definition
              ? { ...definition, type: "app--12345--service" }
              : null,
            service:
              fakeShopify.services
                .get(shop)
                ?.find((s) => s.handle === variables.handle?.handle) ?? null,
          },
        });
      }
      if (query.includes("query SubjectProduct")) {
        const title = fakeShopify.products.get(variables.id);
        return HttpResponse.json({
          data: { product: title ? { id: variables.id, title } : null },
        });
      }
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
                    (fakeShopify.definitions.has(String(params.shop))
                      ? {
                          ...fakeShopify.definitions.get(String(params.shop)),
                          type: "app--12345--service",
                        }
                      : null),
                }
              : {}),
          },
        });
      }
      if (query.includes("query ServiceDefinition")) {
        const definition = fakeShopify.definitions.get(shop);
        return HttpResponse.json({
          data: {
            metaobjectDefinitionByType: definition
              ? { ...definition, type: "app--12345--service" }
              : null,
          },
        });
      }
      if (query.includes("mutation CreateServiceDefinition")) {
        fakeShopify.definitionCreates++;
        if (fakeShopify.definitions.has(shop)) {
          return HttpResponse.json({
            data: {
              metaobjectDefinitionCreate: {
                metaobjectDefinition: null,
                userErrors: [{ code: "TAKEN", message: "Type already exists" }],
              },
            },
          });
        }
        const definition = {
          ...variables.definition,
          id: "gid://shopify/MetaobjectDefinition/1",
        };
        fakeShopify.definitions.set(shop, definition);
        return HttpResponse.json({
          data: {
            metaobjectDefinitionCreate: {
              metaobjectDefinition: {
                ...definition,
                type: "app--12345--service",
              },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("query Services")) {
        const objects = fakeShopify.services.get(shop) ?? [];
        const offset = Number(variables?.after ?? 0);
        return HttpResponse.json({
          data: {
            metaobjects: {
              nodes: objects.slice(offset, offset + 2),
              pageInfo: {
                hasNextPage: offset + 2 < objects.length,
                endCursor: String(offset + 2),
              },
            },
          },
        });
      }
      if (query.includes("query Service(")) {
        return HttpResponse.json({
          data: {
            metaobject:
              fakeShopify.services
                .get(shop)
                ?.find((s) => s.id === variables.id) ?? null,
          },
        });
      }
      if (query.includes("mutation UpdateService(")) {
        const object = fakeShopify.services
          .get(shop)
          ?.find((s) => s.id === variables.id);
        if (!object)
          return HttpResponse.json({
            data: {
              metaobjectUpdate: {
                metaobject: null,
                userErrors: [{ message: "Not found" }],
              },
            },
          });
        if (variables.metaobject.values)
          object.fields = Object.entries(variables.metaobject.values).map(
            ([key, value]) => ({ key, value: String(value) }),
          );
        if (variables.metaobject.capabilities)
          object.capabilities = variables.metaobject.capabilities;
        return HttpResponse.json({
          data: { metaobjectUpdate: { metaobject: object, userErrors: [] } },
        });
      }
      if (query.includes("mutation DeleteService(")) {
        const objects = fakeShopify.services.get(shop) ?? [];
        const object = objects.find((s) => s.id === variables.id);
        fakeShopify.services.set(
          shop,
          objects.filter((s) => s.id !== variables.id),
        );
        return HttpResponse.json({
          data: {
            metaobjectDelete: { deletedId: object?.id ?? null, userErrors: [] },
          },
        });
      }
      if (query.includes("mutation CreateService(")) {
        if (
          !fakeShopify.definitions.has(shop) ||
          variables.metaobject.type !== "$app:service"
        ) {
          return HttpResponse.json({
            data: {
              metaobjectCreate: {
                metaobject: null,
                userErrors: [{ message: "Unknown definition" }],
              },
            },
          });
        }
        const values = variables.metaobject.values;
        const id = fakeShopify.nextId++;
        const object: FakeMetaobject = {
          id: `gid://shopify/Metaobject/${id}`,
          type: "app--12345--service",
          handle: `service-${id}`,
          capabilities: variables.metaobject.capabilities ?? {
            publishable: { status: "DRAFT" },
          },
          fields: Object.entries(values).map(([key, value]) => ({
            key,
            value: String(value),
          })),
        };
        const objects = fakeShopify.services.get(shop) ?? [];
        objects.push(object);
        fakeShopify.services.set(shop, objects);
        return HttpResponse.json({
          data: { metaobjectCreate: { metaobject: object, userErrors: [] } },
        });
      }
      return HttpResponse.json(
        { errors: [{ message: "Unimplemented fake GraphQL operation" }] },
        { status: 500 },
      );
    },
  ),
];
