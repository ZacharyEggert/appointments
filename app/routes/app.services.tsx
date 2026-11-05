import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
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

function ServiceForm({
  service,
  resource,
  slotRules,
}: {
  service?: Service;
  resource: { id: string; name: string };
  slotRules: SlotRules;
}) {
  const save = useFetcher<MutationResult>();
  return (
    <save.Form method="post">
      <input type="hidden" name="intent" value={service ? "edit" : "create"} />
      <input type="hidden" name="id" value={service?.id ?? ""} />
      <input type="hidden" name="resource_id" value={resource.id} />
      <p>
        <label>
          Name{" "}
          <input
            name="name"
            required
            maxLength={255}
            defaultValue={service?.name ?? ""}
          />
        </label>
      </p>
      <p>
        <label>
          Description{" "}
          <textarea
            name="description"
            defaultValue={service?.description ?? ""}
          />
        </label>
      </p>
      <s-paragraph>
        Resource: {resource.name}. Empty Slot rules use shop defaults.
      </s-paragraph>
      {slotRuleFields.map((rule) => (
        <p key={rule.field}>
          <label>
            {rule.label}{" "}
            <input
              name={rule.field}
              type="number"
              min={rule.min}
              max={rule.max}
              step="1"
              placeholder={`Shop default: ${slotRules[rule.key]}`}
              defaultValue={service?.fields[rule.field] ?? ""}
            />
          </label>
        </p>
      ))}
      <p>
        <label>
          Availability{" "}
          <select
            name="blocking"
            defaultValue={service?.blocking === false ? "false" : "true"}
          >
            <option value="true">Blocking</option>
            <option value="false">Non-blocking</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          Location{" "}
          <select
            name="location"
            defaultValue={service?.location ?? "in-person"}
          >
            <option value="in-person">In-person</option>
            <option value="remote">Remote</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          Google Meet for remote Services{" "}
          <select
            name="meet_enabled"
            defaultValue={service?.meetEnabled === false ? "false" : "true"}
          >
            <option value="true">Add Meet link</option>
            <option value="false">No Meet link</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          Price note{" "}
          <input name="price_note" defaultValue={service?.priceNote ?? ""} />
        </label>
      </p>
      <s-button type="submit" variant="primary" loading={save.state !== "idle"}>
        {service ? "Save Service" : "Create draft Service"}
      </s-button>
      {save.data &&
        (save.data.userErrors.length ? (
          <p role="alert">
            {save.data.userErrors.map((e) => e.message).join("; ")}
          </p>
        ) : (
          <p role="status">Service saved.</p>
        ))}
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
  return (
    <s-section heading={service.name}>
      <s-paragraph>
        {service.status === "ACTIVE" ? "Published" : "Draft"} ·{" "}
        {service.slotRules.durationMinutes} minutes
      </s-paragraph>
      {resource && (
        <details>
          <summary>Edit Service</summary>
          <ServiceForm
            service={service}
            resource={resource}
            slotRules={slotRules}
          />
        </details>
      )}
      <change.Form method="post">
        <input type="hidden" name="id" value={service.id} />
        <button
          type="submit"
          name="intent"
          value={service.status === "ACTIVE" ? "unpublish" : "publish"}
          disabled={change.state !== "idle"}
        >
          {service.status === "ACTIVE" ? "Unpublish" : "Publish"}
        </button>{" "}
        <button
          type="submit"
          name="intent"
          value="delete"
          disabled={change.state !== "idle"}
        >
          Delete Service
        </button>
      </change.Form>
      {change.data?.userErrors.map((e, i) => (
        <p role="alert" key={i}>
          {e.message}
        </p>
      ))}
    </s-section>
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
      {services.map((service) => (
        <ServiceEntry
          key={service.id}
          service={service}
          resource={resource}
          slotRules={slotRules}
        />
      ))}
      {!services.length && (
        <s-section>
          <s-paragraph>No Services yet.</s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <s-page heading="Could not load or save Services">
      <s-section>
        <p role="alert">
          {isRouteErrorResponse(error)
            ? String(error.data)
            : "Please try again."}
        </p>
        <s-link href="/app/services">Return to Services</s-link>
      </s-section>
    </s-page>
  );
}
