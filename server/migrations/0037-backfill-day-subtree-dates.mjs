// server/migrations/0037-backfill-day-subtree-dates.mjs
//
// The APPLY_TEMPLATE gate only stamped `defaultFields` on clones whose role was
// "instance", or on other roles whose MODULE bound the field. That rule was
// written when the Schedule's slots were instances; they are containers now, so
// it silently stopped covering them — and only 1 of 48 slot modules still bound
// the date, so the binding fallback caught almost nothing. Measured on poms grid
// 2026-08-05: 40 of 50 children of today's Schedule column had no date at all.
//
// The date is what connects a per-day occurrence's content to the date FILTER,
// so anything living under a dated column needs its own value — slots, the Day
// Page's Journal / Notes / Highlights, and any textblock or item added to that
// day (user, 2026-08-05: "any occurrence can carry fields").
//
// The executor fix handles every build from now on. This backfills the columns
// that already exist, so today's grid is correct rather than only tomorrow's.
//
// SAFE BY CONSTRUCTION: it only ever ADDS a date to a descendant of a column
// that already carries one, only when that descendant has no value for the
// field, and never touches page/panel wrappers (they carry their date in
// `filterOverride`). It never overwrites a differing date — a descendant with
// its own date is deliberate and is left alone.
export const id = "0037-backfill-day-subtree-dates";
export const describe =
  "Stamps the owning day column's date onto descendants that have none (slots, day-page sections, " +
  "textblocks), so date filtering sees them.";

const SKIP_ROLES = new Set(["page", "panel"]);

/** Pure: which descendants of a dated root still need the date. Exported for tests. */
export function collectNeedingDate({ rootId, date, byId, roleOf, dateFieldId, maxDepth = 6 }) {
  const out = [];
  const seen = new Set();
  const walk = (id, depth) => {
    if (depth > maxDepth || seen.has(id)) return;
    seen.add(id);
    const occ = byId.get(id);
    if (!occ) return;
    for (const childId of occ.occurrences || []) {
      const child = byId.get(childId);
      if (!child) continue;
      const role = roleOf(child);
      if (!SKIP_ROLES.has(role)) {
        const existing = child.fields?.[dateFieldId]?.value;
        if (!existing) out.push({ id: child.id, role });
      }
      walk(childId, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Grid } = models;

  const grid = await Grid.findById(gridId).lean();
  const dateFieldId = grid?.meta?.scheduleFieldIds?.dateFieldId;
  if (!dateFieldId) { log("grid has no scheduleFieldIds.dateFieldId — nothing to do"); return; }

  const occs = await Occurrence.find({ gridId }).select("-textmap").lean();
  const mods = await Module.find({ gridId }).select("id role").lean();
  const roleById = new Map(mods.map(m => [m.id, m.role]));
  const byId = new Map(occs.map(o => [o.id, o]));
  const roleOf = (o) => roleById.get(o.moduleId) || null;

  // A "day root" is any occurrence carrying a plain YYYY-MM-DD in the date field
  // AND holding children — the day columns of the Schedule and the Day Page.
  const roots = occs.filter((o) => {
    const v = o.fields?.[dateFieldId]?.value;
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && (o.occurrences || []).length > 0;
  });
  log(`${roots.length} dated column(s) with children`);

  let stamped = 0;
  for (const root of roots) {
    const date = root.fields[dateFieldId].value;
    const need = collectNeedingDate({ rootId: root.id, date, byId, roleOf, dateFieldId });
    if (!need.length) { log(`  ${date} "${root.label || root.id}": already complete`); continue; }

    const byRole = need.reduce((a, n) => { a[n.role || "?"] = (a[n.role || "?"] || 0) + 1; return a; }, {});
    log(`  ${date} "${root.label || root.id}": ${need.length} to stamp — ${JSON.stringify(byRole)}`);
    if (dryRun) { stamped += need.length; continue; }

    for (const n of need) {
      await Occurrence.updateOne(
        { gridId, id: n.id },
        { $set: { [`fields.${dateFieldId}`]: { value: date, flow: "in" } } }
      );
      stamped++;
    }
  }

  log(dryRun ? `(dry run — would stamp ${stamped})` : `stamped ${stamped} occurrence(s)`);
}
