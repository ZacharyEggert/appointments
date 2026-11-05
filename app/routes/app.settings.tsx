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
const clockTime = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
let nextKey = 0;

export default function Settings() {
  const { resource, slotRules } = useLoaderData<{
    resource:
      | (Omit<Resource, "openingHours"> & { openingHours: OpeningHours[] })
      | null;
    slotRules: SlotRules;
  }>();
  // Field values stay in the DOM (read on submit); state only tracks rows.
  const [hours, setHours] = useState(() =>
    (resource?.openingHours ?? []).map((h) => ({ ...h, key: nextKey++ })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useFetcher<{ saved: boolean }>();
  return (
    <s-page heading="Opening hours and Slot rules">
      <save.Form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const found: Record<string, string> = {};
          const openingHours = hours.map(({ key, dayOfWeek }) => {
            const start = String(form.get(`start-${key}`) ?? "").trim();
            const end = String(form.get(`end-${key}`) ?? "").trim();
            if (!clockTime.test(start)) found[`start-${key}`] = "Use HH:MM";
            if (!clockTime.test(end)) found[`end-${key}`] = "Use HH:MM";
            else if (clockTime.test(start) && end <= start)
              found[`end-${key}`] = "Must be after opening";
            return { dayOfWeek, start, end };
          });
          setErrors(found);
          if (Object.keys(found).length) return;
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
                openingHours,
                slotRules: rules,
              }),
            },
            { method: "post" },
          );
        }}
      >
        <s-stack gap="base">
          <s-section heading="Weekly Opening hours">
            {resource ? (
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  {resource.name} · times in {resource.timeZone}. Days without
                  hours are closed. Split overnight hours at midnight; 24:00
                  closes at end of day.
                </s-paragraph>
                <s-stack gap="none">
                  {weekdays.map((day, dayOfWeek) => {
                    const intervals = hours.filter(
                      (h) => h.dayOfWeek === dayOfWeek,
                    );
                    return (
                      <s-box
                        key={day}
                        paddingBlock="small-100"
                        borderWidth={dayOfWeek ? "base none none none" : "none"}
                        borderColor="base"
                      >
                        <s-grid
                          gridTemplateColumns="@container (inline-size > 560px) 7rem 1fr auto, 1fr auto"
                          gap="small-200 base"
                          alignItems="start"
                        >
                          <s-box paddingBlock="small-200">
                            <s-text type="strong">{day}</s-text>
                          </s-box>
                          <s-stack gap="small-200">
                            {intervals.length ? (
                              intervals.map(({ key, start, end }) => (
                                <s-stack
                                  key={key}
                                  direction="inline"
                                  gap="small-200"
                                  alignItems="start"
                                >
                                  <s-box inlineSize="104px">
                                    <s-text-field
                                      label={`${day} opens`}
                                      labelAccessibilityVisibility="exclusive"
                                      name={`start-${key}`}
                                      placeholder="09:00"
                                      defaultValue={start}
                                      error={errors[`start-${key}`]}
                                      required
                                    />
                                  </s-box>
                                  <s-box paddingBlock="small-200">
                                    <s-text color="subdued">to</s-text>
                                  </s-box>
                                  <s-box inlineSize="104px">
                                    <s-text-field
                                      label={`${day} closes`}
                                      labelAccessibilityVisibility="exclusive"
                                      name={`end-${key}`}
                                      placeholder="17:00"
                                      defaultValue={end}
                                      error={errors[`end-${key}`]}
                                      required
                                    />
                                  </s-box>
                                  <s-button
                                    variant="tertiary"
                                    icon="delete"
                                    accessibilityLabel={`Remove ${day} ${start}–${end}`}
                                    onClick={() =>
                                      setHours(
                                        hours.filter((h) => h.key !== key),
                                      )
                                    }
                                  />
                                </s-stack>
                              ))
                            ) : (
                              <s-box paddingBlock="small-200">
                                <s-text color="subdued">Closed</s-text>
                              </s-box>
                            )}
                          </s-stack>
                          <s-button
                            variant="tertiary"
                            icon="plus"
                            onClick={() =>
                              setHours([
                                ...hours,
                                {
                                  dayOfWeek,
                                  start: "09:00",
                                  end: "17:00",
                                  key: nextKey++,
                                },
                              ])
                            }
                          >
                            Add hours
                          </s-button>
                        </s-grid>
                      </s-box>
                    );
                  })}
                </s-stack>
              </s-stack>
            ) : (
              <s-paragraph>
                <s-link href="/app">Choose a Resource</s-link> to set Opening
                hours.
              </s-paragraph>
            )}
          </s-section>
          <s-section heading="Shop Slot rule defaults">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                Services inherit these values when their own field is empty.
              </s-paragraph>
              <s-grid
                gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr, @container (inline-size > 400px) 1fr 1fr, 1fr"
                gap="base"
              >
                {slotRuleFields.map((rule) => (
                  <s-number-field
                    key={rule.key}
                    label={rule.label}
                    name={rule.key}
                    min={rule.min}
                    max={rule.max}
                    step={1}
                    required
                    defaultValue={String(slotRules[rule.key])}
                  />
                ))}
              </s-grid>
            </s-stack>
          </s-section>
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="end"
          >
            {save.data?.saved && save.state === "idle" && (
              <s-text tone="success">Settings saved</s-text>
            )}
            <s-button
              type="submit"
              variant="primary"
              loading={save.state !== "idle"}
            >
              Save settings
            </s-button>
          </s-stack>
        </s-stack>
      </save.Form>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <s-page heading="Opening hours and Slot rules">
      <s-banner tone="critical" heading="Could not save settings">
        {isRouteErrorResponse(error) ? String(error.data) : "Please try again."}{" "}
        <s-link href="/app/settings">Return to settings</s-link>
      </s-banner>
    </s-page>
  );
}
