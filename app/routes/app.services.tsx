import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { Fragment, useState } from "react";
import { authenticate } from "../shopify.server";
import {
  ensureServiceDefinition,
  listServices,
  createService,
  getService,
  updateService,
  deleteService,
} from "../services.server";
import prisma from "../db.server";
import { slotRuleFields } from "../slot-rules";
import { invalid, shopSlotRules } from "../settings.server";
import type { Service } from "../services.server";
import type { SlotRules } from "../slot-rules";

interface MutationResult {
  userErrors: { message: string }[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const definition = await ensureServiceDefinition(admin);
  const slotRules = await shopSlotRules(session.shop);
  const resource = await prisma.resource.findFirst({
    where: { shop: session.shop },
    orderBy: { id: "asc" },
  });
  return Response.json(
    {
      definition,
      resource,
      slotRules,
      services: await listServices(admin, slotRules),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (
    !["create", "edit", "publish", "unpublish", "delete"].includes(
      String(intent),
    )
  )
    invalid("Unknown Service action");
  const definition = await ensureServiceDefinition(admin);
  const id = String(form.get("id") ?? "");
  if (intent !== "create") await getService(admin, id, definition.type);
  if (intent === "delete") {
    const result = await deleteService(admin, id);
    return Response.json(result, {
      status: result.userErrors.length ? 422 : 200,
    });
  }
  if (intent === "publish" || intent === "unpublish") {
    const result = await updateService(admin, id, {
      capabilities: {
        publishable: { status: intent === "publish" ? "ACTIVE" : "DRAFT" },
      },
    });
    return Response.json(result, {
      status: result.userErrors.length ? 422 : 200,
    });
  }
  const resourceId = String(form.get("resource_id") ?? "");
  if (
    !(await prisma.resource.findFirst({
      where: { id: resourceId, shop: session.shop },
    }))
  )
    invalid("Choose your Resource before creating a Service");
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 255)
    invalid("Enter a Service name (up to 255 characters)");
  const values: Record<string, string | number | boolean> = {
    name,
    resource_id: resourceId,
  };
  for (const field of ["description", "price_note"] as const) {
    const value = String(form.get(field) ?? "").trim();
    if (value) values[field] = value;
  }
  for (const rule of slotRuleFields) {
    const raw = String(form.get(rule.field) ?? "").trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < rule.min || value > rule.max)
      invalid(`Invalid ${rule.label}`);
    values[rule.field] = value;
  }
  const location = String(form.get("location") ?? "in-person");
  if (!["in-person", "remote"].includes(location))
    invalid("Choose in-person or remote");
  values.location = location;
  for (const field of ["blocking", "meet_enabled"]) {
    const value = form.get(field) ?? "true";
    if (value !== "true" && value !== "false") invalid(`Invalid ${field}`);
    values[field] = value === "true";
  }
  const result =
    intent === "create"
      ? await createService(admin, values)
      : await updateService(admin, id, { values });
  return Response.json(result, {
    status: result.userErrors.length ? 422 : 200,
  });
}

const ruleGrid =
  "@container (inline-size > 640px) 1fr 1fr 1fr, @container (inline-size > 400px) 1fr 1fr, 1fr";

function ServiceForm({
  service,
  resource,
  slotRules,
  onCancel,
}: {
  service?: Service;
  resource: { id: string; name: string };
  slotRules: SlotRules;
  onCancel?: () => void;
}) {
  const save = useFetcher<MutationResult>();
  return (
    <save.Form method="post">
      <input type="hidden" name="intent" value={service ? "edit" : "create"} />
      <input type="hidden" name="id" value={service?.id ?? ""} />
      <input type="hidden" name="resource_id" value={resource.id} />
      <s-stack gap="large">
        <s-stack gap="base">
          <s-grid
            gridTemplateColumns="@container (inline-size > 560px) 2fr 1fr, 1fr"
            gap="base"
          >
            <s-text-field
              label="Name"
              name="name"
              required
              maxLength={255}
              defaultValue={service?.name ?? ""}
            />
            <s-text-field
              label="Price note"
              name="price_note"
              placeholder="$40, paid in store"
              details="Shown to customers. No payment is taken."
              defaultValue={service?.priceNote ?? ""}
            />
          </s-grid>
          <s-text-area
            label="Description"
            name="description"
            rows={3}
            defaultValue={service?.description ?? ""}
          />
        </s-stack>
        <s-stack gap="base">
          <s-heading>Booking</s-heading>
          <s-grid gridTemplateColumns={ruleGrid} gap="base">
            <s-select
              label="Availability"
              name="blocking"
              value={service?.blocking === false ? "false" : "true"}
              details="Blocking Bookings take the time off the calendar."
            >
              <s-option value="true">Blocking</s-option>
              <s-option value="false">Non-blocking</s-option>
            </s-select>
            <s-select
              label="Location"
              name="location"
              value={service?.location ?? "in-person"}
            >
              <s-option value="in-person">In-person</s-option>
              <s-option value="remote">Remote</s-option>
            </s-select>
            <s-select
              label="Google Meet"
              name="meet_enabled"
              value={service?.meetEnabled === false ? "false" : "true"}
              details="Remote Services only."
            >
              <s-option value="true">Add Meet link</s-option>
              <s-option value="false">No Meet link</s-option>
            </s-select>
          </s-grid>
        </s-stack>
        <s-stack gap="base">
          <s-stack gap="small-200">
            <s-heading>Slot rules</s-heading>
            <s-text color="subdued">
              Booked on {resource.name}. Empty fields use shop defaults.
            </s-text>
          </s-stack>
          <s-grid gridTemplateColumns={ruleGrid} gap="base">
            {slotRuleFields.map((rule) => (
              <s-number-field
                key={rule.field}
                label={rule.label}
                name={rule.field}
                min={rule.min}
                max={rule.max}
                step={1}
                placeholder={`Default: ${slotRules[rule.key]}`}
                defaultValue={String(service?.fields[rule.field] ?? "")}
              />
            ))}
          </s-grid>
        </s-stack>
        {save.data?.userErrors.length ? (
          <s-banner tone="critical" heading="Could not save Service">
            {save.data.userErrors.map((e) => e.message).join("; ")}
          </s-banner>
        ) : null}
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="end"
        >
          {save.data &&
            !save.data.userErrors.length &&
            save.state === "idle" && (
              <s-text tone="success">Service saved</s-text>
            )}
          {onCancel && (
            <s-button variant="tertiary" onClick={onCancel}>
              Cancel
            </s-button>
          )}
          <s-button
            type="submit"
            variant="primary"
            loading={save.state !== "idle"}
          >
            {service ? "Save Service" : "Create draft Service"}
          </s-button>
        </s-stack>
      </s-stack>
    </save.Form>
  );
}

function ServiceEntry({
  service,
  resource,
  slotRules,
}: {
  service: Service;
  resource: { id: string; name: string } | null;
  slotRules: SlotRules;
}) {
  const change = useFetcher<MutationResult>();
  const [editing, setEditing] = useState(false);
  const published = service.status === "ACTIVE";
  const act = (intent: string) =>
    void change.submit({ id: service.id, intent }, { method: "post" });
  return (
    <s-box paddingBlock="base">
      <s-stack gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-stack gap="small-300">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{service.name}</s-text>
              <s-badge tone={published ? "success" : "neutral"}>
                {published ? "Published" : "Draft"}
              </s-badge>
            </s-stack>
            <s-text color="subdued">
              {service.slotRules.durationMinutes} min ·{" "}
              {service.location === "remote" ? "Remote" : "In-person"} ·{" "}
              {service.blocking ? "Blocking" : "Non-blocking"}
              {service.priceNote && ` · ${service.priceNote}`}
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="small-200">
            {resource && !editing && (
              <s-button onClick={() => setEditing(true)}>Edit</s-button>
            )}
            <s-button
              disabled={change.state !== "idle"}
              onClick={() => act(published ? "unpublish" : "publish")}
            >
              {published ? "Unpublish" : "Publish"}
            </s-button>
            <s-button
              tone="critical"
              variant="tertiary"
              disabled={change.state !== "idle"}
              onClick={() => act("delete")}
            >
              Delete
            </s-button>
          </s-stack>
        </s-stack>
        {change.data?.userErrors.length ? (
          <s-banner tone="critical">
            {change.data.userErrors.map((e) => e.message).join("; ")}
          </s-banner>
        ) : null}
        {resource && editing && (
          <s-box
            padding="base"
            borderWidth="base"
            borderColor="base"
            borderRadius="base"
          >
            <ServiceForm
              service={service}
              resource={resource}
              slotRules={slotRules}
              onCancel={() => setEditing(false)}
            />
          </s-box>
        )}
      </s-stack>
    </s-box>
  );
}

export default function Services() {
  const { resource, slotRules, services } = useLoaderData<{
    resource: { id: string; name: string } | null;
    slotRules: SlotRules;
    services: Service[];
  }>();
  return (
    <s-page heading="Services">
      <s-section heading="Your Services">
        {services.length ? (
          <s-stack gap="none">
            {services.map((service, i) => (
              <Fragment key={service.id}>
                {i > 0 && <s-divider />}
                <ServiceEntry
                  service={service}
                  resource={resource}
                  slotRules={slotRules}
                />
              </Fragment>
            ))}
          </s-stack>
        ) : (
          <s-paragraph color="subdued">
            No Services yet. Create one below; it starts as a draft.
          </s-paragraph>
        )}
      </s-section>
      <s-section heading="Create a Service">
        {resource ? (
          <ServiceForm resource={resource} slotRules={slotRules} />
        ) : (
          <s-paragraph>
            <s-link href="/app">Choose a Resource</s-link> before creating a
            Service.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <s-page heading="Services">
      <s-banner tone="critical" heading="Could not load or save Services">
        {isRouteErrorResponse(error) ? String(error.data) : "Please try again."}{" "}
        <s-link href="/app/services">Return to Services</s-link>
      </s-banner>
    </s-page>
  );
}
