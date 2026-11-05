import db from "./db.server";
import { revokeGoogleConnection } from "./google-calendar.server";

export async function deleteShopData(shop: string) {
  try {
    await revokeGoogleConnection(shop);
  } catch {
    console.warn({ event: "google-revoke-failed", shop });
  }
  await db.$transaction([
    db.bookingRateLimit.deleteMany({ where: { shop } }),
    db.googleOAuthState.deleteMany({ where: { shop } }),
    db.googleConnection.deleteMany({ where: { shop } }),
    db.resource.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
