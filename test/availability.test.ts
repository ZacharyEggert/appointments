import { expect, test } from "vitest";
import { availableSlots } from "../app/availability";
import { defaultSlotRules } from "../app/slot-rules";

const monday = {
  timeZone: "America/Los_Angeles",
  from: new Date("2026-11-09T08:00:00Z"),
  to: new Date("2026-11-10T08:00:00Z"),
  now: new Date("2026-11-09T08:00:00Z"),
  rules: { ...defaultSlotRules, startIntervalMinutes: 30 },
  busy: [],
};

test("split Opening hours leave the lunch break closed", () => {
  expect(
    availableSlots({
      ...monday,
      openingHours: [
        { dayOfWeek: 1, start: "09:00", end: "10:00" },
        { dayOfWeek: 1, start: "11:00", end: "11:30" },
      ],
    }),
  ).toEqual([
    { start: "2026-11-09T17:00:00.000Z", end: "2026-11-09T17:30:00.000Z" },
    { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
    { start: "2026-11-09T19:00:00.000Z", end: "2026-11-09T19:30:00.000Z" },
  ]);
});

test("an omitted weekday is closed", () => {
  expect(
    availableSlots({
      ...monday,
      openingHours: [{ dayOfWeek: 2, start: "09:00", end: "17:00" }],
    }),
  ).toEqual([]);
});

test("busy endpoints can touch buffers without overlapping them", () => {
  expect(
    availableSlots({
      ...monday,
      rules: {
        ...monday.rules,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
      },
      openingHours: [{ dayOfWeek: 1, start: "09:00", end: "12:00" }],
      busy: [{ start: "2026-11-09T18:15:00Z", end: "2026-11-09T18:45:00Z" }],
    }),
  ).toEqual([
    { start: "2026-11-09T17:30:00.000Z", end: "2026-11-09T18:00:00.000Z" },
    { start: "2026-11-09T19:00:00.000Z", end: "2026-11-09T19:30:00.000Z" },
  ]);
});

test("24:00 closes at local midnight and returns no Slot extending outside the requested range", () => {
  expect(
    availableSlots({
      ...monday,
      openingHours: [{ dayOfWeek: 1, start: "23:00", end: "24:00" }],
      from: new Date("2026-11-10T07:15:00Z"),
    }),
  ).toEqual([
    { start: "2026-11-10T07:30:00.000Z", end: "2026-11-10T08:00:00.000Z" },
  ]);
});

test("continuous overnight Opening hours allow elapsed duration across midnight", () => {
  expect(
    availableSlots({
      ...monday,
      rules: { ...monday.rules, durationMinutes: 60 },
      openingHours: [
        { dayOfWeek: 1, start: "23:30", end: "24:00" },
        { dayOfWeek: 2, start: "00:00", end: "00:30" },
      ],
      to: new Date("2026-11-10T09:00:00Z"),
    }),
  ).toEqual([
    { start: "2026-11-10T07:30:00.000Z", end: "2026-11-10T08:30:00.000Z" },
  ]);
});

test("Opening hours entirely inside a spring DST gap have no Slots", () => {
  expect(
    availableSlots({
      ...monday,
      openingHours: [{ dayOfWeek: 0, start: "02:00", end: "03:00" }],
      now: new Date("2026-03-07T08:00:00Z"),
      from: new Date("2026-03-08T08:00:00Z"),
      to: new Date("2026-03-09T07:00:00Z"),
    }),
  ).toEqual([]);
});

test("a half-hour DST jump preserves elapsed duration and the local closing boundary", () => {
  expect(
    availableSlots({
      ...monday,
      timeZone: "Australia/Lord_Howe",
      rules: { ...monday.rules, durationMinutes: 60 },
      openingHours: [{ dayOfWeek: 0, start: "01:30", end: "03:00" }],
      now: new Date("2026-10-02T00:00:00Z"),
      from: new Date("2026-10-03T13:30:00Z"),
      to: new Date("2026-10-04T13:00:00Z"),
    }),
  ).toEqual([
    { start: "2026-10-03T15:00:00.000Z", end: "2026-10-03T16:00:00.000Z" },
  ]);
});
