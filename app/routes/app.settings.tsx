import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { useState } from "react";
import type { Resource } from "@prisma/client";
import {
  slotRuleFields,
  type SlotRules,
  type OpeningHours,
} from "../slot-rules";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseSettings, shopSlotRules } from "../settings.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const resource = await prisma.resource.findFirst({
    where: { shop: session.shop },
    orderBy: { id: "asc" },
  });
  return Response.json(
    { resource, slotRules: await shopSlotRules(session.shop) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const settings = parseSettings(form.get("settings"));
  if (
    settings.resourceId &&
    !(await prisma.resource.findFirst({
      where: { id: settings.resourceId, shop: session.shop },
    }))
  ) {
    throw new Response("Resource not found", { status: 404 });
  }
  await prisma.$transaction([
    ...(settings.resourceId
      ? [
          prisma.resource.update({
            where: { id: settings.resourceId, shop: session.shop },
            data: {
              openingHours: settings.openingHours.map((h) => ({ ...h })),
            },
          }),
        ]
      : []),
    prisma.shopSettings.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, ...settings.slotRules },
      update: settings.slotRules,
    }),
  ]);
  return Response.json({ saved: true });
}

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function Settings() {
  const { resource, slotRules } = useLoaderData<{
    resource:
      | (Omit<Resource, "openingHours"> & { openingHours: OpeningHours[] })
      | null;
    slotRules: SlotRules;
  }>();
  const [hours, setHours] = useState(resource?.openingHours ?? []);
  const save = useFetcher<{ saved: boolean }>();
  return (
    <s-page heading="Opening hours and Slot rules">
      <save.Form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const rules = Object.fromEntries(
            slotRuleFields.map((rule) => [
              rule.key,
              Number(form.get(rule.key)),
            ]),
          );
          void save.submit(
            {
              settings: JSON.stringify({
                resourceId: resource?.id,
                openingHours: hours,
                slotRules: rules,
              }),
            },
            { method: "post" },
          );
        }}
      >
        <s-section heading="Weekly Opening hours">
          {resource ? (
            <>
              <s-paragraph>
                {resource.name} — times in {resource.timeZone}. Days without
                intervals are closed. Split overnight hours at midnight.
              </s-paragraph>
              {weekdays.map((day, dayOfWeek) => (
                <fieldset key={day}>
                  <legend>{day}</legend>
                  {hours.map(
                    (interval, index) =>
                      interval.dayOfWeek === dayOfWeek && (
                        <div key={index}>
                          <label>
                            Opens{" "}
                            <input
                              aria-label={`${day} opens ${index + 1}`}
                              type="time"
                              required
                              value={interval.start}
                              onChange={(event) =>
                                setHours(
                                  hours.map((h, i) =>
                                    i === index
                                      ? { ...h, start: event.target.value }
                                      : h,
                                  ),
                                )
                              }
                            />
                          </label>{" "}
                          <label>
                            Closes{" "}
                            <input
                              aria-label={`${day} closes ${index + 1}`}
                              type="text"
                              placeholder="17:00"
                              pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
                              required
                              value={interval.end}
                              onChange={(event) =>
                                setHours(
                                  hours.map((h, i) =>
                                    i === index
                                      ? { ...h, end: event.target.value }
                                      : h,
                                  ),
                                )
                              }
                            />
                          </label>{" "}
                          <button
                            type="button"
                            onClick={() =>
                              setHours(hours.filter((_, i) => i !== index))
                            }
                          >
                            Remove interval
                          </button>
                        </div>
                      ),
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setHours([
                        ...hours,
                        { dayOfWeek, start: "09:00", end: "17:00" },
                      ])
                    }
                  >
                    Add interval
                  </button>
                </fieldset>
              ))}
            </>
          ) : (
            <s-paragraph>
              <s-link href="/app">Choose a Resource</s-link> to set Opening
              hours.
            </s-paragraph>
          )}
        </s-section>
        <s-section heading="Shop Slot rule defaults">
          <s-paragraph>
            Services inherit these values when an override is empty.
          </s-paragraph>
          {slotRuleFields.map((rule) => (
            <p key={rule.key}>
              <label>
                {rule.label}{" "}
                <input
                  type="number"
                  name={rule.key}
                  min={rule.min}
                  max={rule.max}
                  step="1"
                  required
                  defaultValue={slotRules[rule.key]}
                />
              </label>
            </p>
          ))}
          <s-button
            type="submit"
            variant="primary"
            loading={save.state !== "idle"}
          >
            Save settings
          </s-button>
          {save.data?.saved && <p role="status">Settings saved.</p>}
        </s-section>
      </save.Form>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <s-page heading="Could not save settings">
      <s-section>
        <p role="alert">
          {isRouteErrorResponse(error)
            ? String(error.data)
            : "Please try again."}
        </p>
        <s-link href="/app/settings">Return to settings</s-link>
      </s-section>
    </s-page>
  );
}
