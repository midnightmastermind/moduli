// helpers/filterHiddenHint.js
//
// "N items hidden by the <filter> filter (<field>)" — what a container says when
// it HAS rows and the active filter hides every one of them. Before this it
// rendered empty with an "Add new item" bar, which reads as "there is nothing
// here" (checkGrid's container-filtered-empty: 13 such containers on poms).
//
// WHICH filter is read off the real visibility test, one condition at a time —
// `isOccurrenceVisible(occ, effectiveFilters, [cond])` — so it can never
// disagree with what actually hid the row, and it never assumes the field is a
// date (user, 2026-10-13: "show a hint but it shouldnt be hard coded to Date").
//
// Conditions carry `__filterName` from the caller: the grid's named filter's
// name for its conditions, null for an occurrence's own local filters (those
// are named by their field). With no conditions (the legacy path), each
// effective filter key is tested on its own and named by its field.
import { isOccurrenceVisible } from "../state/selectors";

function fieldIdsOfGroup(group, out = []) {
  for (const r of group?.rules || []) {
    if (Array.isArray(r?.rules)) fieldIdsOfGroup(r, out);
    const m = typeof r?.left === "string" && r.left.match(/fields\.([^.]+)\.value/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function filterHiddenHint({ occurrences, visibleCount, effectiveFilters, conditions, fieldsById = {} }) {
  if (visibleCount > 0) return null;
  // A row hidden by hand (`occurrence.hidden`) is not the filter's doing.
  const rows = (occurrences || []).filter((o) => o && !o.hidden);
  if (!rows.length) return null;

  const tests = Array.isArray(conditions) && conditions.length
    ? conditions.filter(Boolean).map((c) => ({
        visible: (o) => isOccurrenceVisible(o, effectiveFilters, [c]),
        filterName: c.__filterName || null,
        fieldIds: Array.isArray(c.rules) ? fieldIdsOfGroup(c) : (c.fieldId ? [c.fieldId] : []),
      }))
    : Object.keys(effectiveFilters || {}).map((fid) => ({
        visible: (o) => isOccurrenceVisible(o, { [fid]: effectiveFilters[fid] }, null),
        filterName: null,
        fieldIds: [fid],
      }));

  let count = 0;
  const bySource = new Map(); // key -> { filterName, fieldNames:Set }
  for (const o of rows) {
    const failing = tests.filter((t) => !t.visible(o));
    if (!failing.length) continue;
    count++;
    for (const t of failing) {
      const names = t.fieldIds.map((fid) => fieldsById[fid]?.name).filter(Boolean);
      const key = t.filterName ? `n:${t.filterName}` : `f:${names.join(",")}`;
      if (!bySource.has(key)) bySource.set(key, { filterName: t.filterName, fieldNames: new Set() });
      for (const n of names) bySource.get(key).fieldNames.add(n);
    }
  }
  if (!count) return null;
  return { count, sources: [...bySource.values()].map((s) => ({ filterName: s.filterName, fieldNames: [...s.fieldNames] })) };
}

export function filterHiddenHintText(hint) {
  if (!hint) return "";
  const parts = hint.sources.map((s) => s.filterName
    ? `the ${s.filterName} filter${s.fieldNames.length ? ` (${s.fieldNames.join(", ")})` : ""}`
    : `the ${s.fieldNames.join(", ") || "active"} filter`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${hint.count} item${hint.count === 1 ? "" : "s"} hidden by ${list}`;
}
