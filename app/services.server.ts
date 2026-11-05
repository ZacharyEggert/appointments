import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { slotRuleFields, type SlotRules } from "./slot-rules";

interface Metaobject {
  id: string;
  type: string;
  handle: string;
  capabilities: { publishable: { status: "ACTIVE" | "DRAFT" } };
  fields: { key: string; value: string | null }[];
}
const serviceSelection = `id type handle capabilities { publishable { status } } fields { key value }`;

export function readService(object: Metaobject, defaults: SlotRules) {
  const fields = Object.fromEntries(object.fields.map((f) => [f.key, f.value]));
  const slotRules = { ...defaults };
  for (const rule of slotRuleFields) {
    if (fields[rule.field] != null && fields[rule.field] !== "")
      slotRules[rule.key] = Number(fields[rule.field]);
  }
  return {
    id: object.id,
    handle: object.handle,
    status: object.capabilities.publishable.status,
    name: fields.name ?? "",
    description: fields.description ?? "",
    resourceId: fields.resource_id ?? "",
    blocking: fields.blocking !== "false",
    location: fields.location || "in-person",
    meetEnabled: fields.meet_enabled !== "false",
    priceNote: fields.price_note ?? "",
    slotRules,
    fields,
  };
}
export type Service = ReturnType<typeof readService>;

export async function storefrontService(
  admin: AdminApiContext,
  handle: string,
  defaults: SlotRules,
) {
  const result = await graphql<{
    shop: { ianaTimezone: string };
    metaobjectDefinitionByType: Definition | null;
    service: Metaobject | null;
  }>(
    admin,
    `query SlotService($handle: MetaobjectHandleInput!) {
    shop { ianaTimezone }
    metaobjectDefinitionByType(type: "$app:service") { id type }
    service: metaobjectByHandle(handle: $handle) { ${serviceSelection} }
  }`,
    { handle: { type: "$app:service", handle } },
  );
  if (
    !result.service ||
    result.service.type !== result.metaobjectDefinitionByType?.type ||
    result.service.capabilities.publishable.status !== "ACTIVE"
  )
    throw new Response("Service not found", { status: 404 });
  return {
    service: readService(result.service, defaults),
    shopTimeZone: result.shop.ianaTimezone,
  };
}

export async function listServices(
  admin: AdminApiContext,
  defaults: SlotRules,
) {
  const services: Service[] = [];
  let after: string | null = null;
  do {
    const {
      metaobjects,
    }: {
      metaobjects: {
        nodes: Metaobject[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    } = await graphql(
      admin,
      `query Services($after: String) { metaobjects(type: "$app:service", first: 100, after: $after) { nodes { ${serviceSelection} } pageInfo { hasNextPage endCursor } } }`,
      { after },
    );
    services.push(
      ...metaobjects.nodes.map((object) => readService(object, defaults)),
    );
    after = metaobjects.pageInfo.hasNextPage
      ? metaobjects.pageInfo.endCursor
      : null;
  } while (after);
  return services;
}

export async function createService(
  admin: AdminApiContext,
  values: Record<string, string | number | boolean>,
) {
  const { metaobjectCreate } = await graphql<{
    metaobjectCreate: {
      metaobject: Metaobject | null;
      userErrors: UserError[];
    };
  }>(
    admin,
    `mutation CreateService($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) { metaobject { ${serviceSelection} } userErrors { field message code } }
    }`,
    {
      metaobject: {
        type: "$app:service",
        values,
        capabilities: { publishable: { status: "DRAFT" } },
      },
    },
  );
  return metaobjectCreate;
}

export async function getService(
  admin: AdminApiContext,
  id: string,
  type: string,
) {
  const { metaobject } = await graphql<{ metaobject: Metaobject | null }>(
    admin,
    `query Service($id: ID!) { metaobject(id: $id) { ${serviceSelection} } }`,
    { id },
  );
  if (!metaobject || metaobject.type !== type)
    throw new Response("Service not found", { status: 404 });
  return metaobject;
}

export async function updateService(
  admin: AdminApiContext,
  id: string,
  metaobject: {
    values?: Record<string, string | number | boolean>;
    capabilities?: { publishable: { status: "ACTIVE" | "DRAFT" } };
  },
) {
  const { metaobjectUpdate } = await graphql<{
    metaobjectUpdate: {
      metaobject: Metaobject | null;
      userErrors: UserError[];
    };
  }>(
    admin,
    `mutation UpdateService($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { ${serviceSelection} } userErrors { field message code } }
    }`,
    { id, metaobject },
  );
  return metaobjectUpdate;
}

export async function deleteService(admin: AdminApiContext, id: string) {
  const { metaobjectDelete } = await graphql<{
    metaobjectDelete: { deletedId: string | null; userErrors: UserError[] };
  }>(
    admin,
    `
      mutation DeleteService($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    { id },
  );
  return metaobjectDelete;
}

interface UserError {
  field?: string[];
  message: string;
  code?: string;
}
interface Definition {
  id: string;
  type: string;
}

export async function graphql<T>(
  admin: AdminApiContext,
  query: string,
  variables = {},
) {
  const response = await admin.graphql(query, { variables });
  const result = (await response.json()) as { data?: T; errors?: unknown };
  if (!result.data || result.errors)
    throw new Response("Could not load Services from Shopify", { status: 502 });
  return result.data;
}

export async function ensureServiceDefinition(admin: AdminApiContext) {
  const lookup = () =>
    graphql<{ metaobjectDefinitionByType: Definition | null }>(
      admin,
      `
        query ServiceDefinition {
          metaobjectDefinitionByType(type: "$app:service") {
            id
            type
          }
        }
      `,
    );
  const { metaobjectDefinitionByType } = await lookup();
  if (metaobjectDefinitionByType) return metaobjectDefinitionByType;
  const { metaobjectDefinitionCreate } = await graphql<{
    metaobjectDefinitionCreate: {
      metaobjectDefinition: Definition | null;
      userErrors: UserError[];
    };
  }>(
    admin,
    `
      mutation CreateServiceDefinition(
        $definition: MetaobjectDefinitionCreateInput!
      ) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition {
            id
            type
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    {
      definition: {
        type: "$app:service",
        name: "Service",
        displayNameKey: "name",
        access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
        capabilities: {
          publishable: { enabled: true },
          renderable: {
            enabled: true,
            data: { metaTitleKey: "name", metaDescriptionKey: "description" },
          },
          onlineStore: {
            enabled: true,
            data: { urlHandle: "services", createRedirects: true },
          },
        },
        fieldDefinitions: [
          {
            key: "name",
            name: "Name",
            type: "single_line_text_field",
            required: true,
          },
          {
            key: "description",
            name: "Description",
            type: "multi_line_text_field",
          },
          ...slotRuleFields.map((rule) => ({
            key: rule.field,
            name: rule.label,
            type: "number_integer",
            validations: [
              { name: "min", value: String(rule.min) },
              { name: "max", value: String(rule.max) },
            ],
          })),
          { key: "blocking", name: "Blocking", type: "boolean" },
          {
            key: "location",
            name: "Location",
            type: "single_line_text_field",
            validations: [{ name: "choices", value: '["in-person","remote"]' }],
          },
          {
            key: "meet_enabled",
            name: "Add Google Meet link",
            type: "boolean",
          },
          {
            key: "price_note",
            name: "Price note",
            type: "single_line_text_field",
          },
          {
            key: "resource_id",
            name: "Resource ID",
            type: "single_line_text_field",
            required: true,
          },
        ],
      },
    },
  );
  if (metaobjectDefinitionCreate.userErrors.some((e) => e.code === "TAKEN")) {
    const existing = (await lookup()).metaobjectDefinitionByType;
    if (existing) return existing;
  }
  if (
    metaobjectDefinitionCreate.userErrors.length ||
    !metaobjectDefinitionCreate.metaobjectDefinition
  ) {
    throw new Response(
      metaobjectDefinitionCreate.userErrors.map((e) => e.message).join("; ") ||
        "Could not create Service definition",
      { status: 422 },
    );
  }
  return metaobjectDefinitionCreate.metaobjectDefinition;
}
