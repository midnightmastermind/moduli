// helpers/filterFieldStamp.js — normalizing a date filter value to a local day.
//
// This file used to also hold `computePageFilterFields`, the app-level stamp that
// copied the page's filter date onto every new occurrence. REMOVED 2026-09-29
// (user: "stamping something with the date and using the date filter are two diff
// things … the autodate stamp should just be on things dragged or added to the
// schedule"). Dating Schedule adds/moves is the "Schedule: Stamp Date & Time
// Slot" operation's job. What is left is the day normalizer, which is not a stamp.
// Normalize a date-typed filter value to a local-tz YYYY-MM-DD string. Handles
// the three input shapes the filter pipeline produces in the wild:
//   1) "2026-05-23"        — already a day-key, return as-is
//   2) "2026-05-23T...Z"   — ISO timestamp, slice the date prefix; the time
//      component shouldn't bleed into local-tz interpretation downstream.
//   3) Date instance       — format via getFullYear/getMonth/getDate.
// null/undefined/empty → null. Other shapes → null (caller skips stamp).
//
// Why this exists: stampPageFilterFields previously passed `effective[fid]`
// straight through. When the page filter stored a UTC midnight ISO string
// ("2026-05-23T00:00:00.000Z"), downstream date-field renders called
// `new Date(...)` and shifted to the previous day in any TZ west of UTC —
// the "stamping as May 22 when the filter says May 23" bug.
export function normalizeFilterDateValue(v) {
  if (v == null || v === "") return null;
  // DrilldownDatePicker period-shape: {value, unit, kind, dates, span}.
  // Single-day picks expose `value` as YYYY-MM-DD; multi-day picks use `dates[0]`
  // as the anchor. Without this, the new picker's object shape falls through
  // to `return null` below and drop-side date stamping silently no-ops —
  // the dropped occurrence is created without its date field.
  if (typeof v === "object" && !(v instanceof Date)) {
    if (typeof v.value === "string" || v.value instanceof Date) return normalizeFilterDateValue(v.value);
    if (Array.isArray(v.dates) && v.dates.length) return normalizeFilterDateValue(v.dates[0]);
    return null;
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return null;
}
