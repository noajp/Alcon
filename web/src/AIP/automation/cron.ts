// A 5-field cron expression (minute hour day-of-month month day-of-week),
// read in an IANA time zone. Pure, so the automations function, the
// Automation screen and the tests compute the same next run.
//
//   *  a,b  a-b  */n  a-b/n      in every field
//   day-of-week 0-7, 0 and 7 are Sunday
//   when both day fields are restricted, a day matches either (as cron does)

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

const FIELDS: [string, number, number][] = [
  ["minute", 0, 59], ["hour", 0, 23], ["day of month", 1, 31], ["month", 1, 12], ["day of week", 0, 7],
];

function field(text: string, name: string, lo: number, hi: number): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`${name}: 「${part}」を読めません`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`${name}: 間隔は 1 以上`);
    let from = lo, to = hi;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      from = a; to = b ?? (m[2] ? hi : a);
    }
    if (from < lo || to > hi || from > to) throw new Error(`${name}: ${lo}〜${hi} の範囲で書いてください`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** Pure. Throws an Error with a Japanese message when the expression cannot be read. */
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron 式は「分 時 日 月 曜日」の5つで書いてください");
  const [minutes, hours, days, months, weekdaysRaw] = parts.map((p, i) => field(p, FIELDS[i][0], FIELDS[i][1], FIELDS[i][2]));
  const weekdays = new Set([...weekdaysRaw].map((d) => (d === 7 ? 0 : d)));
  return { minutes, hours, days, months, weekdays, dayRestricted: parts[2] !== "*", weekdayRestricted: parts[4] !== "*" };
}

interface Local { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(at: Date, timeZone: string): Local {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(at)) p[x.type] = x.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday };
}

function dayMatches(spec: CronSpec, l: Local): boolean {
  if (!spec.months.has(l.month)) return false;
  const byDay = spec.days.has(l.day);
  const byWeekday = spec.weekdays.has(l.weekday);
  if (spec.dayRestricted && spec.weekdayRestricted) return byDay || byWeekday;
  if (spec.dayRestricted) return byDay;
  if (spec.weekdayRestricted) return byWeekday;
  return true;
}

/** Pure. The first minute strictly after `after` that the expression names,
 *  in `timeZone`; null when none falls within about a year and a half. */
export function nextCronRun(expr: string, after: Date, timeZone = "Asia/Tokyo"): Date | null {
  const spec = parseCron(expr);
  let t = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const limit = t + 550 * 24 * 60 * 60_000;
  while (t < limit) {
    const l = localParts(new Date(t), timeZone);
    if (!dayMatches(spec, l)) { t += ((23 - l.hour) * 60 + (60 - l.minute)) * 60_000; continue; }
    if (!spec.hours.has(l.hour)) { t += (60 - l.minute) * 60_000; continue; }
    if (spec.minutes.has(l.minute)) return new Date(t);
    t += 60_000;
  }
  return null;
}

/** Pure. A plain description of when the expression runs, for the screen. */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [mi, h, dom, mon, dow] = parts;
  const time = /^\d+$/.test(mi) && /^\d+$/.test(h) ? `${h.padStart(2, "0")}:${mi.padStart(2, "0")}` : null;
  const days: Record<string, string> = { "1-5": "平日", "0,6": "土日", "6,0": "土日", "0": "日曜", "1": "月曜", "2": "火曜", "3": "水曜", "4": "木曜", "5": "金曜", "6": "土曜", "7": "日曜" };
  if (time && dom === "*" && mon === "*") {
    if (dow === "*") return `毎日 ${time}`;
    if (days[dow]) return `毎週${days[dow]} ${time}`;
  }
  if (time && /^\d+$/.test(dom) && mon === "*" && dow === "*") return `毎月${dom}日 ${time}`;
  if (/^\*\/\d+$/.test(mi) && h === "*" && dom === "*" && mon === "*" && dow === "*") return `${mi.slice(2)}分ごと`;
  if (mi === "0" && h === "*" && dom === "*" && mon === "*" && dow === "*") return "毎時0分";
  return expr;
}
