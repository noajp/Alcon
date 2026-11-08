// The heartbeat's clock, as pure functions: when the next wake falls,
// and whether a moment sits inside the Space's quiet hours. The tick
// claims and advances schedules with these; the driver and the tests
// read the same answers. No I/O, no clock of its own — every function
// takes the moment it judges.

/** The cadences a Space may pick, in minutes (design §8.2: a fixed
 *  list, because finer than the threshold's order buys nothing but
 *  empty wake records). */
export const HEARTBEAT_CADENCE_MINUTES: readonly number[] = [30, 60, 180, 360, 720, 1440];

export function isHeartbeatCadence(v: unknown): v is number {
  return typeof v === "number" && HEARTBEAT_CADENCE_MINUTES.includes(v);
}

export interface QuietHours { startMinutes: number; endMinutes: number }

/** A Postgres `time` value ("23:00:00") or an "HH:MM" string, as minutes
 *  of the day. Null for anything unreadable. */
export function timeToMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return (h % 24) * 60 + min;
}

export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The quiet window a Space's row describes; null when unset (either
 *  side missing) or empty (start equals end). */
export function quietHoursOf(row: { heartbeat_quiet_start?: unknown; heartbeat_quiet_end?: unknown }): QuietHours | null {
  const start = timeToMinutes(row.heartbeat_quiet_start);
  const end = timeToMinutes(row.heartbeat_quiet_end);
  if (start === null || end === null || start === end) return null;
  return { startMinutes: start, endMinutes: end };
}

/** Minutes since local midnight for a moment in a timezone. */
export function localMinutesOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

/** Pure. Whether a moment falls in the quiet window, which may cross
 *  midnight (23:00–07:00 quiets both sides of it). */
export function inQuietHours(at: Date, timeZone: string, quiet: QuietHours | null): boolean {
  if (!quiet) return false;
  const m = localMinutesOfDay(at, timeZone);
  if (quiet.startMinutes < quiet.endMinutes) return m >= quiet.startMinutes && m < quiet.endMinutes;
  return m >= quiet.startMinutes || m < quiet.endMinutes;
}

/** Pure. The first moment at or after `at` that is outside the quiet
 *  window — a wake that comes due inside quiet hours is deferred to
 *  the window's end, not dropped. Steps by the minute so a timezone's
 *  own shifts are followed rather than computed around. */
export function quietAdjusted(at: Date, timeZone: string, quiet: QuietHours | null): Date {
  let t = at.getTime();
  // A quiet window is at most a day; two days of minutes is a safe bound.
  for (let i = 0; i < 2880 && inQuietHours(new Date(t), timeZone, quiet); i++) t += 60_000;
  return new Date(t);
}

/**
 * Pure. The next wake after a scheduled one: the schedule advances from
 * the scheduled time, not from when the tick happened to run (the
 * nextCronRun discipline), stepping past any beats already missed, and
 * a landing inside quiet hours moves to the quiet window's end.
 */
export function nextHeartbeatAt(
  scheduledAt: Date, cadenceMinutes: number, now: Date,
  timeZone: string, quiet: QuietHours | null,
): Date {
  const cadenceMs = Math.max(1, cadenceMinutes) * 60_000;
  let t = scheduledAt.getTime() + cadenceMs;
  while (t <= now.getTime()) t += cadenceMs;
  return quietAdjusted(new Date(t), timeZone, quiet);
}
