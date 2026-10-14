// helpers/when.js
//
// A WHEN value: one moment, or a repeat. The value type behind the `when` field type, which the Reminder
// field (an alarm in the Alarms list) and the Schedule field (an operation places the occurrence on the day)
// both use (user, 2026-10-12). Pure — no store, no clock unless one is passed.
//
//   { mode: "once",     dates: ["2026-10-13", "2026-10-15"], time: "14:30" }   time optional (all day);
//                       one or several dates sharing the time. An older value carries a single `date`.
//   { mode: "every",    every: 2, unit: "minute"|"hour"|"day"|"week"|"month",
//                       start: { date: "2026-10-13", time: "09:00" } } time optional for day/week/month
//   { mode: "weekdays", days: [1, 3, 5], time: "09:00", start?: { date } }   0 = Sunday
//
// Dates and times are LOCAL wall-clock strings, the same as every other date field here.

export const WHEN_UNITS = ["minute", "hour", "day", "week", "month"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const parseTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
};
const at = (day, time) => {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const t = parseTime(time);
  if (t) d.setHours(t.h, t.m, 0, 0);
  return d;
};
const DAY_MS = 86_400_000;
const daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);

/** PURE. The dates of a "once" value, sorted and deduplicated — `dates`, plus a legacy single `date`. */
export function onceDates(v) {
  const all = [...(Array.isArray(v?.dates) ? v.dates : []), ...(v?.date ? [v.date] : [])]
    .map(parseDay).filter(Boolean).map(dayKey);
  return [...new Set(all)].sort();
}

/** PURE. Is this a usable when value? */
export function isWhen(v) {
  if (!v || typeof v !== "object") return false;
  if (v.mode === "once") return onceDates(v).length > 0;
  if (v.mode === "every") return WHEN_UNITS.includes(v.unit) && Number(v.every) >= 1 && !!parseDay(v.start?.date);
  if (v.mode === "weekdays") return Array.isArray(v.days) && v.days.length > 0;
  return false;
}

/** PURE. The times ("HH:MM", or null for all day) this value falls on, on one local day. */
export function whenTimesOnDay(v, day) {
  if (!isWhen(v)) return [];
  const d = typeof day === "string" ? parseDay(day) : day;
  if (!d) return [];
  const key = dayKey(d);
  if (v.mode === "once") return onceDates(v).includes(key) ? [v.time || null] : [];
  if (v.mode === "weekdays") {
    const start = parseDay(v.start?.date);
    if (start && daysBetween(start, d) < 0) return [];
    return v.days.map(Number).includes(d.getDay()) ? [v.time || null] : [];
  }
  const start = parseDay(v.start.date);
  const n = Math.max(1, Math.floor(Number(v.every)));
  const delta = daysBetween(start, d);
  if (delta < 0) return [];
  const time = v.start.time || null;
  if (v.unit === "day") return delta % n === 0 ? [time] : [];
  if (v.unit === "week") return delta % (7 * n) === 0 ? [time] : [];
  if (v.unit === "month") {
    const months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    return months % n === 0 && d.getDate() === start.getDate() ? [time] : [];
  }
  // minute / hour: every step from the start moment that lands on this day
  const stepMs = n * (v.unit === "hour" ? 3_600_000 : 60_000);
  const first = at(start, time || "00:00").getTime();
  const dayStart = at(d, "00:00").getTime();
  const dayEnd = dayStart + DAY_MS;
  let k = Math.max(0, Math.ceil((dayStart - first) / stepMs));
  const out = [];
  for (let t = first + k * stepMs; t < dayEnd && out.length < 1440; t = first + (++k) * stepMs) {
    const x = new Date(t);
    out.push(`${pad(x.getHours())}:${pad(x.getMinutes())}`);
  }
  return out;
}

/** PURE. Does this value fall on that day at all? */
export const whenOnDay = (v, day) => whenTimesOnDay(v, day).length > 0;

/** PURE. The latest moment this value fires at or before `now` (an all-day value fires at 09:00), or null. */
export function lastFireAtOrBefore(v, now) {
  if (!isWhen(v)) return null;
  for (let back = 0; back <= 1; back++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const times = whenTimesOnDay(v, day).map((t) => at(day, t || "09:00")).filter((d) => d <= now);
    if (times.length) return new Date(Math.max(...times.map((d) => d.getTime())));
  }
  return null;
}

/** PURE. The next moment strictly after `after`, looking up to a year ahead, or null. */
export function nextFireAfter(v, after) {
  if (!isWhen(v)) return null;
  for (let ahead = 0; ahead <= 366; ahead++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + ahead);
    const times = whenTimesOnDay(v, day).map((t) => at(day, t || "09:00")).filter((d) => d > after);
    if (times.length) return new Date(Math.min(...times.map((d) => d.getTime())));
  }
  return null;
}

/** "2:30pm" from "14:30". */
export function formatClock(t) {
  const p = parseTime(t);
  if (!p) return "";
  const h12 = ((p.h + 11) % 12) + 1;
  return `${h12}:${pad(p.m)}${p.h < 12 ? "am" : "pm"}`;
}
const fmtDay = (s) => {
  const d = parseDay(s);
  return d ? d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "";
};

/** PURE. A one-line description: "Oct 13 at 2:30pm", "Every 2 days at 9:00am", "Mon, Wed, Fri at 9:00am". */
export function describeWhen(v) {
  if (!isWhen(v)) return "";
  const time = (t) => (t ? ` at ${formatClock(t)}` : "");
  if (v.mode === "once") {
    const ds = onceDates(v);
    const days = ds.length <= 3 ? ds.map(fmtDay).join(", ") : `${fmtDay(ds[0])} + ${ds.length - 1} more dates`;
    return `${days}${time(v.time)}`;
  }
  if (v.mode === "weekdays") {
    const days = [...v.days].map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const name = days.length === 7 ? "Every day" : days.join(",") === "1,2,3,4,5" ? "Weekdays" : days.map((d) => WEEKDAY_SHORT[d]).join(", ");
    return `${name}${time(v.time)}`;
  }
  const n = Number(v.every);
  const unit = n === 1 ? v.unit : `${n} ${v.unit}s`;
  const from = v.start?.date && v.start.date !== dayKey(new Date()) ? ` from ${fmtDay(v.start.date)}` : "";
  return `Every ${unit}${time(v.start?.time)}${from}`;
}

/** PURE. The half-hour schedule slot a time falls in ("14:40" -> "2:30pm"); null for all day. */
export function slotLabelFor(t) {
  const p = parseTime(t);
  if (!p) return null;
  return formatClock(`${pad(p.h)}:${pad(p.m < 30 ? 0 : 30)}`);
}
