// helpers/filterFieldStamp.js — the ONE place that answers "what filter values
// should an occurrence be born with, given where it is being placed?"
//
// Lifted out of dropHandlers 2026-08-05. It lived there because drops were the
// only path that stamped, but a textblock created by TYPING needs exactly the
// same answer — and dropHandlers imports CommitHelpers, so CommitHelpers could
// not import it back without a cycle. This module is a leaf: it imports only
// the selector it needs, so every create path can reach it.
//
// The rule these functions encode: an occurrence placed under a dated container
// must be BORN carrying that date. Patching it afterwards is not equivalent —
// the create's own OccurrenceCreateOp and per-field MeasureOps fire immediately
// and evaluate `fields.<dateFieldId>.value SAME_DAY $goalDate` against whatever
// the record had at that moment, and a follow-up update races the create's
// server queue besides.
import { getEffectiveFilterForOccurrence } from "../state/selectors";

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

// Resolves the page-filter date stamps that should land on an occurrence
// placed under `parentContainerOcc`, returning a merged fields map (existing +
// stamped) without writing anything. Use BEFORE creating the occurrence so the
// new record is born with the correct date — otherwise the in-flight
// OccurrenceCreateOp + per-field MeasureOps fire against the source's old
// date and trackers (which check `fields.<dateFieldId>.value SAME_DAY
// $goalDate`) silently exclude it. Returns the original `existingFields`
// reference unchanged when there are no nav fields or no value to stamp, so
// callers can cheaply detect a no-op via identity.
export function computePageFilterFields({ state, occurrencesById, parentContainerOcc, existingFields = {} }) {
  if (!parentContainerOcc) return existingFields;
  // #60 — per-container opt-out. Containers with
  // `meta.skipFilterStamp: true` short-circuit so drops into them
  // don't auto-stamp the filter's date/timeslot. Useful for
  // long-lived "all dates" containers (Library / Bills / Accounts)
  // where stamping today's date onto a movie / bill / account would
  // hide it from the next-day filter view. Default behavior
  // (auto-stamp) preserved for Schedule slots, day-page tasks, etc.
  if (parentContainerOcc?.meta?.skipFilterStamp === true) return existingFields;
  const grid = state?.grid;
  const activeNamedFilter = (grid?.namedFilters || []).find(f => f.id === grid?.activeFilterId);
  const navFieldIds = (activeNamedFilter?.conditions || [])
    .filter(c => c.isNav && c.fieldId)
    .map(c => c.fieldId);
  if (!navFieldIds.length) return existingFields;

  const effective = getEffectiveFilterForOccurrence(parentContainerOcc, { grid, occurrencesById });
  let merged = existingFields;
  for (const fid of navFieldIds) {
    const v = normalizeFilterDateValue(effective?.[fid]);
    if (v == null) continue;
    const existing = merged[fid];
    const existingValue = existing && typeof existing === "object" ? existing.value : existing;
    if (normalizeFilterDateValue(existingValue) === v) continue;
    if (merged === existingFields) merged = { ...existingFields };
    merged[fid] = { value: v, flow: existing?.flow ?? "in" };
  }
  return merged;
}
