import type { OpeningHours, SlotRules } from "./slot-rules";

export interface Interval {
  start: string;
  end: string;
}

const minute = 60_000;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function minutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function availableSlots(input: {
  openingHours: OpeningHours[];
  timeZone: string;
  rules: SlotRules;
  from: Date;
  to: Date;
  busy: Interval[];
  now: Date;
}): Interval[] {
  const { openingHours, timeZone, rules, from, to, now } = input;
  const before = rules.bufferBeforeMinutes * minute;
  const after = rules.bufferAfterMinutes * minute;
  const duration = rules.durationMinutes * minute;
  const earliest = Math.max(
    from.getTime(),
    now.getTime() + rules.minNoticeMinutes * minute,
  );
  const latest = Math.min(
    to.getTime() - duration,
    now.getTime() + rules.maxAdvanceDays * 86_400_000,
  );
  if (earliest > latest) return [];
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const windows: { start: number; end: number; candidates: number[] }[] = [];
  let window: (typeof windows)[number] | undefined;
  const scanEnd = Math.ceil((latest + duration + after) / minute) * minute;
  // Walk real instants: missing wall-clock minutes never become starts, and a
  // repeated hour has two distinct starts. Durations and buffers are elapsed time.
  for (
    let time = Math.floor((earliest - before) / minute) * minute;
    time < scanEnd;
    time += minute
  ) {
    const parts = Object.fromEntries(
      format.formatToParts(time).map((p) => [p.type, p.value]),
    );
    const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
    const hours = openingHours.find(
      (h) =>
        h.dayOfWeek === weekdays.indexOf(parts.weekday) &&
        localMinute >= minutes(h.start) &&
        localMinute < minutes(h.end),
    );
    if (!hours) {
      window = undefined;
      continue;
    }
    if (!window) {
      window = { start: time, end: time, candidates: [] };
      windows.push(window);
    }
    window.end = time + minute;
    if (
      time >= earliest &&
      time <= latest &&
      (localMinute - minutes(hours.start)) % rules.startIntervalMinutes === 0
    ) {
      window.candidates.push(time);
    }
  }
  const busy = input.busy.map((b) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }));
  return windows.flatMap((window) =>
    window.candidates
      .filter(
        (start) =>
          start - before >= window.start &&
          start + duration + after <= window.end &&
          !busy.some(
            (b) => b.start < start + duration + after && b.end > start - before,
          ),
      )
      .map((start) => ({
        start: new Date(start).toISOString(),
        end: new Date(start + duration).toISOString(),
      })),
  );
}
