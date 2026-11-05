export const defaultSlotRules = {
  durationMinutes: 30,
  startIntervalMinutes: 15,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 30,
};
export type SlotRules = typeof defaultSlotRules;
export const slotRuleFields = [
  {
    key: "durationMinutes",
    field: "duration_minutes",
    label: "Duration (minutes)",
    min: 5,
    max: 1440,
  },
  {
    key: "startIntervalMinutes",
    field: "start_interval_minutes",
    label: "Start interval (minutes)",
    min: 5,
    max: 1440,
  },
  {
    key: "bufferBeforeMinutes",
    field: "buffer_before_minutes",
    label: "Buffer before (minutes)",
    min: 0,
    max: 1440,
  },
  {
    key: "bufferAfterMinutes",
    field: "buffer_after_minutes",
    label: "Buffer after (minutes)",
    min: 0,
    max: 1440,
  },
  {
    key: "minNoticeMinutes",
    field: "min_notice_minutes",
    label: "Minimum notice (minutes)",
    min: 0,
    max: 2147483647,
  },
  {
    key: "maxAdvanceDays",
    field: "max_advance_days",
    label: "Max advance (days)",
    min: 1,
    max: 3650,
  },
] as const;
export interface OpeningHours {
  dayOfWeek: number; // Sunday = 0; intervals stay within one local day.
  start: string;
  end: string; // 24:00 is allowed as an exclusive end.
}
