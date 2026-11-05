import { beforeEach, expect, test } from "vitest";
import { loader, action } from "../../app/routes/app.settings";
import {
  adminRequest,
  installShop,
  routeArgs,
  SHOP,
  resourceForShop,
} from "../helpers";

beforeEach(() => installShop());

export const defaults = {
  durationMinutes: 45,
  startIntervalMinutes: 15,
  bufferBeforeMinutes: 10,
  bufferAfterMinutes: 5,
  minNoticeMinutes: 120,
  maxAdvanceDays: 60,
};

function save(body: object, shop = SHOP) {
  return action(
    routeArgs(
      adminRequest(
        "/app/settings",
        {
          method: "POST",
          body: new URLSearchParams({ settings: JSON.stringify(body) }),
        },
        shop,
      ),
    ),
  );
}

test("a merchant saves weekly split Opening hours and shop Slot rule defaults", async () => {
  const resource = await resourceForShop();
  const openingHours = [
    { dayOfWeek: 1, start: "09:00", end: "12:00" },
    { dayOfWeek: 1, start: "13:00", end: "17:00" },
    { dayOfWeek: 5, start: "10:00", end: "24:00" },
  ];
  expect(
    (await save({ resourceId: resource.id, openingHours, slotRules: defaults }))
      .status,
  ).toBe(200);
  expect(
    await (await loader(routeArgs(adminRequest("/app/settings")))).json(),
  ).toMatchObject({
    resource: { id: resource.id, openingHours },
    slotRules: defaults,
  });
  await save({
    resourceId: resource.id,
    openingHours: [],
    slotRules: defaults,
  });
  expect(
    await (await loader(routeArgs(adminRequest("/app/settings")))).json(),
  ).toMatchObject({
    resource: { openingHours: [] },
  });
});

test.each([
  [{ dayOfWeek: 1, start: "17:00", end: "09:00" }],
  [{ dayOfWeek: 7, start: "09:00", end: "17:00" }],
  [{ dayOfWeek: 1, start: "09:00", end: "25:00" }],
  [
    { dayOfWeek: 1, start: "09:00", end: "12:00" },
    { dayOfWeek: 1, start: "11:00", end: "13:00" },
  ],
])(
  "invalid Opening hours are rejected without saving defaults: %j",
  async (...openingHours) => {
    const resource = await resourceForShop();
    await expect(
      save({ resourceId: resource.id, openingHours, slotRules: defaults }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await (await loader(routeArgs(adminRequest("/app/settings")))).json(),
    ).toMatchObject({
      resource: { openingHours: [] },
      slotRules: { durationMinutes: 30 },
    });
  },
);

test("a Shop cannot change another Shop's Opening hours", async () => {
  const resource = await resourceForShop();
  const other = "other.myshopify.com";
  await installShop(other);
  await expect(
    save(
      { resourceId: resource.id, openingHours: [], slotRules: defaults },
      other,
    ),
  ).rejects.toMatchObject({ status: 404 });
});

test("invalid Slot rules and malformed settings return actionable validation errors", async () => {
  await expect(
    save({ slotRules: { ...defaults, startIntervalMinutes: 0 } }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    action(
      routeArgs(
        adminRequest("/app/settings", {
          method: "POST",
          body: new URLSearchParams({ settings: "{" }),
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 400 });
});
