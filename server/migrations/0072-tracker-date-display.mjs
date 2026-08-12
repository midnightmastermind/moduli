// server/migrations/0072-tracker-date-display.mjs
//
// USER, 2026-08-11: *"date isnt being set on trackers"* → *"those should be
// display fields for date in trackers and set by the ops we have."*
//
// ── WHY THIS IS SAFE, WHEN STAMPING THE FILTER'S DATE FIELD IS NOT ──────────
//
// `0071` declined to write the auto-applied **Date** onto tracker tiles, and
// that was right: it is the field the named filter's conditions name, so a
// stored value makes the tile date-filtered and it vanishes the moment you move
// off that day (2026-04-30 records exactly that, and a migration removed it once
// already). Since 2026-08-11 it would also vanish whenever the date is cleared.
//
// A SEPARATE field does not have that problem, and the reason is precise:
// `isOccurrenceVisible` only evaluates the field ids the active filter's
// conditions name. A value on any OTHER field is invisible to it. So a dedicated
// display field can carry the date safely — the danger was never "a date on a
// tracker", it was "a value on the field the filter reads".
//
// ── WHAT THIS DOES ──────────────────────────────────────────────────────────
//
//   1. Creates **Tracker Date** — type `date`, DISPLAY only (never an input, so
//      nobody can type into it and no write path but the op touches it).
//   2. Binds it `role: "display"` on every tracker TILE module under the
//      Trackers page.
//   3. Extends the op we already have — `Trackers: Date-Prefix Labels`, which is
//      already targeted at the Trackers page and already loops those tiles on
//      onFilterChange + onLoad — to write `$activeDate` into it. ONE op, not the
//      39 that mention $goalPeriod.
//   4. Puts the Trackers page back on the grid default, so the empty **input**
//      Date stops rendering there. The computed one replaces it.
//
// `$activeDate` resolves through the op's `targetOccurrenceId` (the Trackers
// page), so it follows THAT page's own filter — which is what makes the number
// beside it and the date above it describe the same day.
//
// Idempotent: the field is found-or-created, bindings are skipped when present,
// and the op step is only added when absent.

export const id = "0072-tracker-date-display";
export const describe =
  "Add a display-only Tracker Date field, bind it on every tracker tile, and have "
  + "Trackers: Date-Prefix Labels write the active date into it.";

const FIELD_NAME = "Tracker Date";
const OP_NAME = "Trackers: Date-Prefix Labels";
const TRACKERS_PAGE = "Trackers";

const mkId = () => Math.random().toString(36).slice(2, 14);

/**
 * Add `UPDATE $goal.fields.<fid>.value = $activeDate` to the loop that already
 * walks the tracker tiles.
 *
 * Anchored on the step that CLEARS `$goal.label` — the one write already made
 * per tile, so `$goal` is bound and the scope guard above it has already run.
 * Anchoring by position would be a guess about someone else's pipeline.
 *
 * Exported so the test drives the REAL function.
 */
export function addTrackerDateStep(op, fieldId) {
  const report = { added: 0, alreadyPresent: 0, reason: null };
  const steps = op?.pipeline?.steps;
  if (!Array.isArray(steps)) { report.reason = "op has no pipeline steps"; return report; }

  const path = `$goal.fields.${fieldId}.value`;
  if (JSON.stringify(op.pipeline).includes(path)) { report.alreadyPresent = 1; return report; }

  const walk = (list) => {
    if (!Array.isArray(list)) return false;
    for (let i = 0; i < list.length; i += 1) {
      const st = list[i];
      if (!st || typeof st !== "object") continue;
      const cfg = st.config || {};
      if (cfg.type === "UPDATE" && cfg.path === "$goal.label") {
        list.splice(i + 1, 0, {
          id: mkId(), type: "action",
          config: { type: "UPDATE", path, value: "$activeDate" },
        });
        report.added += 1;
        return true;
      }
      if (walk(st.then) || walk(st.else) || walk(st.body)) return true;
    }
    return false;
  };
  if (!walk(steps)) {
    report.reason = "no `UPDATE $goal.label` step to anchor the write to";
  }
  return report;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Occurrence, Module, Field, Operation } = models;

  const grid = await Grid.findById(gridId).lean();
  if (!grid) { log("  · grid not found"); return; }

  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";

  const page = occs.find((o) => modById.get(o.moduleId)?.role === "page" && labelOf(o) === TRACKERS_PAGE);
  if (!page) { log(`  · no "${TRACKERS_PAGE}" page on this grid — nothing to do`); return; }

  // ── 1. the field ──────────────────────────────────────────────────────────
  // Unique names are a standing rule here (2026-07-14), so a same-named field of
  // another shape is a refusal rather than a second one.
  let field = fields.find((f) => f.name === FIELD_NAME);
  if (field && !(field.type === "date" && field.displayEnabled)) {
    log(`  · REFUSED: a field called "${FIELD_NAME}" already exists but is `
      + `type=${field.type} display=${field.displayEnabled} — not reusing it blindly`);
    return;
  }
  if (!field) {
    field = {
      id: mkId(), userId: grid.userId, gridId,
      name: FIELD_NAME, type: "date",
      // DISPLAY ONLY. An input would let someone type a date into a tile whose
      // value is owned by an operation, and the next op run would silently
      // overwrite it.
      displayEnabled: true, inputEnabled: false,
      meta: {},
    };
    log(`  · CREATE field "${FIELD_NAME}" (date, display-only) ${field.id}`);
    if (!dryRun) await Field.create(field);
  } else {
    log(`  · field "${FIELD_NAME}" already exists (${field.id})`);
  }

  // ── 2. bind it on every tracker TILE ──────────────────────────────────────
  // Tiles are the grandchildren of the page: page -> dimension container -> tile.
  const tileModuleIds = new Set();
  for (const contId of (page.occurrences || [])) {
    for (const tileId of (occById.get(contId)?.occurrences || [])) {
      const mid = occById.get(tileId)?.moduleId;
      if (mid) tileModuleIds.add(mid);
    }
  }
  let bound = 0, already = 0;
  for (const mid of tileModuleIds) {
    const mod = modById.get(mid);
    if (!mod) continue;
    const bindings = Array.isArray(mod.fieldBindings) ? mod.fieldBindings : [];
    if (bindings.some((b) => b.fieldId === field.id)) { already += 1; continue; }
    bound += 1;
    if (!dryRun) {
      await Module.updateOne({ gridId, id: mid }, {
        $set: { fieldBindings: [...bindings, { fieldId: field.id, role: "display", order: bindings.length }] },
      });
    }
  }
  log(`  · bind on tracker tiles: ${bound} newly bound, ${already} already had it (${tileModuleIds.size} tile module(s))`);

  // ── 3. the op writes it ───────────────────────────────────────────────────
  const op = await Operation.findOne({ gridId, name: OP_NAME });
  if (!op) {
    log(`  · REFUSED: "${OP_NAME}" is not on this grid — nothing would ever set the value`);
  } else {
    const r = addTrackerDateStep(op, field.id);
    if (r.reason) log(`  · REFUSED to patch "${OP_NAME}": ${r.reason}`);
    else if (r.alreadyPresent) log(`  · "${OP_NAME}" already writes it — no change`);
    else {
      log(`  · "${OP_NAME}" gains \`UPDATE $goal.fields.<Tracker Date>.value = $activeDate\``);
      log("    ($activeDate resolves through the op's targetOccurrenceId — the Trackers page — so it");
      log("     follows that page's own filter, which is the same one the numbers beside it use)");
      if (!dryRun) { op.markModified("pipeline"); await op.save(); }
    }
  }

  // ── 4. stop rendering the empty INPUT Date on that page ───────────────────
  // 0071 made the Trackers page an exception so Date would show. The thing that
  // should show is the computed one; the input was the empty box being reported.
  const applied = Array.isArray(grid.meta?.autoAppliedFieldIds) ? grid.meta.autoAppliedFieldIds : [];
  const dateId = applied.find((id) => fields.find((f) => f.id === id)?.type === "date");
  const fv = page.fieldVisibility;
  if (dateId && fv?.mode === "hide" && !fv.fieldIds.includes(dateId)) {
    const next = { mode: "hide", fieldIds: [...fv.fieldIds, dateId] };
    log("  · Trackers page also hides the auto-applied Date input now — the computed one replaces it");
    if (!dryRun) await Occurrence.updateOne({ gridId, id: page.id }, { $set: { fieldVisibility: next } });
  }
}
