import { setupServer } from "msw/node";
import { beforeEach, afterEach, afterAll } from "vitest";
import prisma from "../app/db.server";
import { fakeShopify, shopifyHandlers } from "./fakes/shopify";
import { fakeGoogle, googleHandlers } from "./fakes/google";

export const server = setupServer(...shopifyHandlers, ...googleHandlers);
// The Shopify adapter captures fetch at import time, before beforeAll runs.
server.listen({ onUnhandledFrame: "error" });

beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(",")} RESTART IDENTITY CASCADE`,
    );
  }
  fakeShopify.reset();
  fakeGoogle.reset();
});
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});
