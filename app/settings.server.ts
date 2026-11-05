import {
  defaultSlotRules,
  slotRuleFields,
  type OpeningHours,
} from "./slot-rules";
import prisma from "./db.server";

export async function shopSlotRules(shop: string) {
  return (
    (await prisma.shopSettings.findUnique({
      where: { shop },
      select: {
        durationMinutes: true,
        startIntervalMinutes: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
        minNoticeMinutes: true,
        maxAdvanceDays: true,
      },
    })) ?? defaultSlotRules
  );
}

export function invalid(message: string): never {
  throw new Response(message, { status: 400 });
}

export function parseSettings(value: FormDataEntryValue | null) {
  let input;
  try {
    input = JSON.parse(String(value));
  } catch {
    invalid("Invalid settings JSON");
  }
  if (!input || typeof input !== "object" || !input.slotRules)
    invalid("Provide Slot rules");
  const slotRules = { ...defaultSlotRules };
  for (const rule of slotRuleFields) {
    const value = input.slotRules[rule.key];
    if (!Number.isInteger(value) || value < rule.min || value > rule.max)
      invalid(`Invalid ${rule.label}`);
    slotRules[rule.key] = value;
  }
  const openingHours: OpeningHours[] = [];
  if (input.resourceId != null) {
    if (typeof input.resourceId !== "string" || !input.resourceId)
      invalid("Choose a Resource");
    if (!Array.isArray(input.openingHours))
      invalid("Provide weekly Opening hours");
    for (const hours of input.openingHours) {
      if (
        !hours ||
        !Number.isInteger(hours.dayOfWeek) ||
        hours.dayOfWeek < 0 ||
        hours.dayOfWeek > 6 ||
        typeof hours.start !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.start) ||
        typeof hours.end !== "string" ||
        !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(hours.end) ||
        hours.start >= hours.end
      ) {
        invalid(
          "Opening hours must be valid intervals within one day; split overnight hours at midnight",
        );
      }
      if (
        openingHours.some(
          (h) =>
            h.dayOfWeek === hours.dayOfWeek &&
            h.start < hours.end &&
            h.end > hours.start,
        )
      )
        invalid("Opening hours cannot overlap");
      openingHours.push({
        dayOfWeek: hours.dayOfWeek,
        start: hours.start,
        end: hours.end,
      });
    }
  }
  return {
    resourceId: input.resourceId as string | undefined,
    openingHours,
    slotRules,
  };
}
