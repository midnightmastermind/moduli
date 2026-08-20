/**
 * 0164 — the second axis: trackers can be scoped by CATEGORY, not just by date.
 *
 * THE ORIGINAL VISION, verbatim: *"the app can sum/count/track progress across any time window AND
 * category"*. The time window has worked for months. The category half had never been built —
 * measured on this grid: **0 of 29 tracker operations referenced any category field**, and 27 of
 * them were scoped by page ancestry plus date and nothing else. So "how many PHYSICAL tasks did I
 * complete this week?" had no answer.
 *
 * IT INTRODUCES NO NEW MECHANISM, and that is the point — the user's instruction was to look at what
 * the operations already need for the date and use that. Every piece is the date gate one field
 * over:
 * ```
 *   date      INIT_VAR $goalPeriod   = $goalItem._effectiveFilter.<dateFieldId>
 *             rule     $item.fields.<dateFieldId>.value DATE_IN_PERIOD $goalPeriod
 *   category  INIT_VAR $goalCategory = $goalItem._effectiveFilter.<categoryFieldId>
 *             rule     $item.fields.<categoryFieldId>.value CONTAINS $goalCategory
 * ```
 *
 * THE FIELD IS `Tags`, AND IT IS ALREADY THE RIGHT SHAPE — this migration picks it STRUCTURALLY,
 * off `grid.meta.autoAppliedFieldIds`, never by name. That list is exactly `[Tags, Date]`: the two
 * fields `0064` made universal so EVERY occurrence carries them. The category axis and the date axis
 * therefore have the identical carrier, which is what lets one mechanism serve both. And the values
 * are already there — `0064` backfilled Tags from structure, so the nine wellness dimensions are
 * live on the grid today (physical 168 · creative 19 · financial 16 · intellectual 15 · social 13 ·
 * occupational 13 · environmental 13 · emotional 12 · spiritual 12). Nothing has to be re-tagged for
 * this to mean something on day one.
 *
 * `CONTAINS`, not `IS`, because Tags is multiSelect — a row's value is an ARRAY. `evalRule`'s
 * CONTAINS branch is array-aware (2026-07-12), which is why the feed work could match tags the same
 * way.
 *
 * EMPTY MEANS ALL. `periodAllPolicy` established that rule for dates and it has to hold here for the
 * same reason: the Trackers page is normally unfiltered by category, and a bare category rule would
 * make every tile read 0 until you picked one. The gate is `(matches) OR ($goalCategory IS_EMPTY)`.
 *
 * ONLY THE LOOP GATE, NEVER THE TRIGGER GATE. Of the 111 live `DATE_IN_PERIOD $goalPeriod` rules,
 * **42 sit on a LOOP variable** (which items aggregate) and **69 on `$trigger.*`** (whether an edit
 * re-runs the tracker at all). Only 32 of those 42 are literally named `$item` — the other 10 belong
 * to the hand-written media and mood trackers, which is exactly why the discriminator is
 * trigger-vs-loop and not the variable's name. Two reasons the trigger is left alone, and the second is fatal rather than
 * merely wrong: a category-gated trigger would stop a tracker recomputing after an out-of-category
 * edit and leave a STALE number on screen; and `$item` is UNBOUND in a trigger context, where
 * referencing an unbound var throws — the op would stop firing entirely.
 *
 * THE FILTER IS ALSO SURFACED, or this ships inert — and the obvious way to surface it DOES NOT
 * WORK, which is the finding that reshaped this half. A `grid.namedFilters` entry can only be
 * reached by becoming `grid.activeFilterId`: `Toolbar.jsx` renders exactly ONE `FilterNavWidget`,
 * for the active filter, and `FiltersSection`'s ancestor rows list the active filter's conditions
 * and nothing else. So a second GRID-wide axis is not expressible — picking Category would REPLACE
 * the date nav. And `grid.toolbarNavFilters`, which the first draft pushed into, is written by
 * `ToolbarFilterDropdown`'s "nav here" switch and **read by nothing that renders** (grep: that file
 * and the schema). It would have shipped a filter nobody can reach with every log line reading
 * correctly.
 *
 * SO THE AXIS IS A LOCAL FILTER ON THE TRACKERS PAGE, which is the mechanism that already supports
 * a second simultaneous axis — `FiltersSection` renders a widget per `occurrence.filters[]` entry
 * beside the inherited grid one. **The Schedule page already carries exactly this**: a second entry
 * on Time Slot with `style:"select"` and its own options, alongside its date filter. This copies
 * that shape at run time rather than restating it.
 *
 * THE PAGE IS DERIVED, NEVER NAMED. Every one of the 37 trackers binds its goal tile picker-direct
 * (`$goalItem = $allItemsById.<id>`), and all 37 of those tiles resolve to ONE page ancestor. That
 * page is where the nav goes — so a renamed or moved Trackers page carries this with it.
 *
 * IT CHANGES NUMBERS, NOT WHAT IS ON SCREEN, and the `condition` is what buys that.
 * `getLocalFilterConditions` contributes a VISIBILITY condition only for entries whose `condition`
 * is null; an entry carrying one renders its widget and gates nothing. That matters here because
 * Tags is a MIXED field — 45 values are in live use and only nine are wellness dimensions, the rest
 * being board categories (`image`, `grocery`, `person`, …). Gating visibility would mean picking
 * "grocery" empties the Trackers page while the numbers rescope: an empty screen where the answer
 * should be. The condition is the page's OWN date filter one field over — `(matches) OR (IS_EMPTY)`.
 */
import { applyCategoryScope } from "../utils/categoryScopePolicy.js";

export const id = "0164-category-axis-on-trackers";
export const describe = "Adds a category gate (Tags) to every tracker's value loop and adds a category nav to the page those trackers live on. Edits operation pipelines; deletes nothing.";

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Grid, Field, Occurrence, Module } = models;
  const grid = await Grid.findById(gridId).lean();
  const fields = await Field.find({ gridId }).lean();
  const byId = new Map(fields.map((f) => [f.id, f]));

  // Structural: the universal fields are [Tags, Date]. The category one is the
  // select. Nothing here matches on the name "Tags".
  const universal = grid?.meta?.autoAppliedFieldIds || [];
  const categoryField = universal.map((id) => byId.get(id)).find((f) => f && f.type === "select");
  if (!categoryField) {
    log("  REFUSING: no universal select field to use as the category axis");
    return;
  }
  log(`  category field: "${categoryField.name}" (${categoryField.id}) · multiSelect=${!!categoryField.meta?.multiSelect}`);

  const ops = await Operation.find({ gridId }).lean();
  const trackers = ops.filter((o) => /\$goalPeriod/.test(JSON.stringify(o.pipeline || {})));
  log(`  operations: ${ops.length} · trackers (resolve a $goalPeriod): ${trackers.length}`);

  const changed = applyCategoryScope(trackers, { categoryFieldId: categoryField.id });
  const vars = changed.reduce((n, c) => n + c.vars, 0);
  const gates = changed.reduce((n, c) => n + c.gates, 0);
  log(`  would patch ${changed.length} op(s): ${vars} $goalCategory binding(s), ${gates} loop gate(s)`);
  // Reported, never silent: these resolve their $goalPeriod without an
  // `_effectiveFilter` source, so there is nothing to mirror for the category.
  // They keep working exactly as they do today, just without a category filter.
  if (changed.skipped?.length) {
    log(`  NOT category-scoped (no filter source to mirror): ${changed.skipped.join(", ")}`);
  }

  // ── The nav, on the page the trackers themselves point at ────────────────
  // Derived: every tracker binds its goal tile picker-direct, and all of them
  // resolve to one page ancestor. Nothing here matches the name "Trackers".
  const occs = await Occurrence.find({ gridId }).lean();
  const mods = await Module.find({ gridId }).lean();
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const parentOf = new Map();
  for (const o of occs) for (const c of o.occurrences || []) parentOf.set(c, o.id);
  const pageAncestorOf = (oid) => {
    let cur = occById.get(oid), d = 0;
    while (cur && d++ < 30) {
      if ((cur.role || modById.get(cur.moduleId)?.role) === "page") return cur;
      const pid = parentOf.get(cur.id) ?? cur.parentId;
      cur = pid ? occById.get(pid) : null;
    }
    return null;
  };
  const pageVotes = new Map();
  for (const op of trackers) {
    const m = /\$allItemsById\.([A-Za-z0-9_-]+)/.exec(JSON.stringify(op.pipeline || {}));
    const page = m ? pageAncestorOf(m[1]) : null;
    if (page) pageVotes.set(page.id, (pageVotes.get(page.id) || 0) + 1);
  }
  const [trackersPageId, votes] = [...pageVotes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const trackersPage = trackersPageId ? occById.get(trackersPageId) : null;
  if (!trackersPage) {
    log("  REFUSING to surface: could not derive the trackers' page from their goal tiles");
    return;
  }
  const pageLabel = trackersPage.label || modById.get(trackersPage.moduleId)?.label || trackersPage.id;
  log(`  trackers' page: "${pageLabel}" (${trackersPage.id}) — ${votes}/${trackers.length} goal tiles agree`);

  // Options are the values the grid ACTUALLY carries, most-used first — not the
  // field's declared list (some of which nothing uses), and not a restated set
  // of dimension names.
  const counts = new Map();
  for (const o of occs) {
    let v = o.fields?.[categoryField.id];
    v = v && typeof v === "object" && "value" in v ? v.value : v;
    for (const t of Array.isArray(v) ? v : v == null || v === "" ? [] : [v]) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const options = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const already = (trackersPage.filters || []).some((f) => f?.fieldId === categoryField.id);
  log(`  ${categoryField.name} nav on that page: ${already ? "present" : "to add"} · ${options.length} value(s) in live use`);

  if (!changed.length && already) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const { op } of changed) {
    await Operation.updateOne({ _id: op._id }, { $set: { pipeline: op.pipeline } });
  }
  log(`  patched ${changed.length} operation pipeline(s)`);

  if (!already) {
    // The shape is the page's OWN date filter, one field over: the same
    // OR-with-IS_EMPTY condition, plus `style:"select"` + explicit options from
    // the Schedule page's Time Slot entry.
    await Occurrence.updateOne({ id: trackersPage.id, gridId }, {
      $push: { filters: {
        id: Math.random().toString(36).slice(2, 14),
        fieldId: categoryField.id,
        active: true,
        showNav: true,
        style: "select",
        options,
        condition: { operator: "OR", rules: [
          { left: "$field.value", comparator: "CONTAINS", right: "$nav" },
          { left: "$field.value", comparator: "IS_EMPTY" },
        ] },
      } },
    });
    log(`  added the ${categoryField.name} nav to "${pageLabel}" (renders a widget; gates no visibility)`);
  }
  log("  done — RESTART pm2 and reload.");
}
