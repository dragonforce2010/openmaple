import type { JsonRecord } from "../types";

type CronSpec = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  dayWildcard: boolean;
  weekdayWildcard: boolean;
};

type ZonedParts = {
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function nextDeploymentRunAt(schedule: JsonRecord | null | undefined, after = new Date()) {
  const cron = parseSchedule(schedule);
  let cursor = roundUpMinute(new Date(after.getTime() + 60_000));
  const limit = cursor.getTime() + 366 * 24 * 60 * 60_000;
  while (cursor.getTime() <= limit) {
    if (matchesCron(cron.spec, zonedParts(cursor, cron.timezone))) return cursor.toISOString();
    cursor = new Date(cursor.getTime() + 60_000);
  }
  throw new Error("deployment_schedule_has_no_next_run");
}

export function deploymentUpcomingRuns(schedule: JsonRecord | null | undefined, count = 3, after = new Date()) {
  const runs: string[] = [];
  let cursor = after;
  for (let index = 0; index < count; index += 1) {
    const next = nextDeploymentRunAt(schedule, cursor);
    runs.push(next);
    cursor = new Date(Date.parse(next));
  }
  return runs;
}

export function deploymentHasUserMessage(initialEvents: JsonRecord[]) {
  return initialEvents.some((event) => String(event.type || "") === "user.message" && userMessageText(event));
}

export function userMessageText(event: JsonRecord) {
  const content = Array.isArray(event.content) ? event.content : Array.isArray((event.payload as JsonRecord | undefined)?.content) ? ((event.payload as JsonRecord).content as unknown[]) : [];
  const text = content
    .map((item) => {
      const record = asRecord(item);
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text;
}

function parseSchedule(schedule: JsonRecord | null | undefined) {
  if (!schedule || String(schedule.type || "cron") !== "cron") throw new Error("deployment_schedule_cron_required");
  const expression = String(schedule.expression || "").trim();
  const parts = expression.split(/\s+/);
  if (parts.length !== 5) throw new Error("deployment_schedule_must_be_5_field_cron");
  const timezone = String(schedule.timezone || "UTC");
  formatterFor(timezone);
  return {
    timezone,
    spec: {
      minute: parseField(parts[0], 0, 59),
      hour: parseField(parts[1], 0, 23),
      day: parseField(parts[2], 1, 31),
      month: parseField(parts[3], 1, 12),
      weekday: parseField(parts[4], 0, 7, 0),
      dayWildcard: parts[2] === "*",
      weekdayWildcard: parts[4] === "*"
    }
  };
}

function parseField(raw: string, min: number, max: number, aliasMax?: number) {
  const values = new Set<number>();
  for (const segment of raw.split(",")) {
    addSegment(values, segment, min, max, aliasMax);
  }
  if (!values.size) throw new Error("deployment_schedule_empty_field");
  return values;
}

function addSegment(values: Set<number>, segment: string, min: number, max: number, aliasMax?: number) {
  const [rangeRaw, stepRaw] = segment.split("/");
  const step = stepRaw ? Number(stepRaw) : 1;
  if (!Number.isInteger(step) || step < 1) throw new Error("deployment_schedule_invalid_step");
  const [start, end] = cronRange(rangeRaw, min, max);
  for (let value = start; value <= end; value += step) {
    if (value < min || value > max) throw new Error("deployment_schedule_value_out_of_range");
    values.add(aliasMax !== undefined && value === aliasMax ? min : value);
  }
}

function cronRange(raw: string, min: number, max: number) {
  if (raw === "*") return [min, max];
  if (raw.includes("-")) {
    const [startRaw, endRaw] = raw.split("-");
    return [cronNumber(startRaw), cronNumber(endRaw)];
  }
  const value = cronNumber(raw);
  return [value, value];
}

function cronNumber(raw: string) {
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error("deployment_schedule_invalid_number");
  return value;
}

function roundUpMinute(date: Date) {
  date.setUTCSeconds(0, 0);
  return date;
}

function matchesCron(spec: CronSpec, parts: ZonedParts) {
  if (!spec.minute.has(parts.minute) || !spec.hour.has(parts.hour) || !spec.month.has(parts.month)) return false;
  const dayMatch = spec.day.has(parts.day);
  const weekdayMatch = spec.weekday.has(parts.weekday);
  if (spec.dayWildcard && spec.weekdayWildcard) return true;
  if (spec.dayWildcard) return weekdayMatch;
  if (spec.weekdayWildcard) return dayMatch;
  return dayMatch || weekdayMatch;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const record: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(date)) {
    if (part.type !== "literal") record[part.type] = Number(part.value);
  }
  return {
    month: record.month,
    day: record.day,
    hour: record.hour,
    minute: record.minute,
    weekday: weekday(date, timezone)
  };
}

function weekday(date: Date, timezone: string) {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function formatterFor(timezone: string) {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}
