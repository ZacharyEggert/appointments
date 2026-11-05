import { createHash } from "node:crypto";
import { isIP } from "node:net";
import prisma from "./db.server";
import { emailHash } from "./customer-email.server";

const windowMs = 15 * 60_000;

export async function bookingRetryAfter(
  shop: string,
  forwardedFor: string | null,
  email: string,
) {
  let ip = forwardedFor?.split(",")[0].trim() ?? "";
  if (isIP(ip) === 6) ip = new URL(`http://[${ip.split("%")[0]}]/`).hostname;
  else if (!isIP(ip)) ip = "unknown";
  const limits = [
    { key: `ip:${createHash("sha256").update(ip).digest("hex")}`, max: 10 },
    { key: `email:${emailHash(email)}`, max: 3 },
  ];
  return prisma.$transaction(async (tx) => {
    // Share counters across app processes; never hold this lock during API calls.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-abuse:${shop}`}, 0))::text`;
    const now = new Date();
    await tx.bookingRateLimit.deleteMany({
      where: { shop, expiresAt: { lte: now } },
    });
    const buckets = await tx.bookingRateLimit.findMany({
      where: { shop, key: { in: limits.map(({ key }) => key) } },
    });
    let retryAfter = 0;
    for (const { key, max } of limits) {
      const bucket = buckets.find((bucket) => bucket.key === key);
      if (bucket && bucket.count >= max)
        retryAfter = Math.max(
          retryAfter,
          Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000),
        );
    }
    if (retryAfter) return retryAfter;
    for (const { key } of limits)
      await tx.bookingRateLimit.upsert({
        where: { shop_key: { shop, key } },
        create: {
          shop,
          key,
          count: 1,
          expiresAt: new Date(now.getTime() + windowMs),
        },
        update: { count: { increment: 1 } },
      });
    return 0;
  });
}
