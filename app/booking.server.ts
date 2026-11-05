import { randomUUID } from "node:crypto";
import { availableSlots } from "./availability";
import type { OpeningHours } from "./slot-rules";
import prisma from "./db.server";
import type { Service } from "./services.server";
import {
  deleteGoogleEvent,
  googleBusy,
  overlappingGoogleEvents,
  writeGoogleEvent,
} from "./google-calendar.server";
import { emailHash, normalizeEmail } from "./customer-email.server";

export interface Guest {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

export async function book(
  shop: string,
  service: Service,
  slotStart: Date,
  customer: Guest,
) {
  const resource = await prisma.resource.findFirst({
    where: { id: service.resourceId, shop },
  });
  if (!resource) return { status: "unavailable" } as const;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${resource.id}, 0))::text`;
        const end = new Date(
          slotStart.getTime() + service.slotRules.durationMinutes * 60_000,
        );
        const from = new Date(
          slotStart.getTime() - service.slotRules.bufferBeforeMinutes * 60_000,
        );
        const to = new Date(
          end.getTime() + service.slotRules.bufferAfterMinutes * 60_000,
        );
        const busy = await googleBusy(shop, resource.calendarId, from, to);
        if (
          !availableSlots({
            openingHours: resource.openingHours as unknown as OpeningHours[],
            timeZone: resource.timeZone,
            rules: service.slotRules,
            from: slotStart,
            to: end,
            busy,
            now: new Date(),
          }).some((slot) => slot.start === slotStart.toISOString())
        )
          return { status: "slot-taken" } as const;
        const withMeet = service.location === "remote" && service.meetEnabled;
        const event = await writeGoogleEvent(shop, resource.calendarId, {
          ...(withMeet
            ? {
                conferenceData: {
                  createRequest: {
                    requestId: randomUUID(),
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                  },
                },
              }
            : {}),
          summary: `${service.name} – ${customer.name}`,
          transparency: service.blocking ? "opaque" : "transparent",
          description: `Service: ${service.name}\nCustomer: ${customer.name}\nPhone: ${customer.phone}\nNotes: ${customer.notes}`,
          start: {
            dateTime: slotStart.toISOString(),
            timeZone: resource.timeZone,
          },
          end: {
            dateTime: new Date(
              slotStart.getTime() + service.slotRules.durationMinutes * 60_000,
            ).toISOString(),
            timeZone: resource.timeZone,
          },
          extendedProperties: {
            private: {
              app: "appointments",
              shop,
              serviceId: service.id,
              emailHash: emailHash(customer.email),
            },
          },
        });
        let confirmed = false;
        try {
          const overlaps = await overlappingGoogleEvents(
            shop,
            resource.calendarId,
            from,
            to,
          );
          if (
            overlaps.some(
              (other) =>
                other.id !== event.id &&
                other.transparency !== "transparent" &&
                other.status !== "cancelled",
            )
          ) {
            return { status: "slot-taken" } as const;
          }
          await writeGoogleEvent(
            shop,
            resource.calendarId,
            {
              attendees: [
                {
                  email: normalizeEmail(customer.email),
                  displayName: customer.name,
                },
              ],
            },
            event.id,
            withMeet,
          );
          confirmed = true;
          return { status: "confirmed", eventId: event.id } as const;
        } finally {
          if (!confirmed)
            await deleteGoogleEvent(shop, resource.calendarId, event.id);
        }
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  } catch {
    return { status: "unavailable" } as const;
  }
}
