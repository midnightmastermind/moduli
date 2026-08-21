/**
 * 0177 — the seven day-templates become SIX REUSABLE LAYERS, merged at build time.
 *
 * USER: *"is there anyway to merge like templates too. maybe we should have a monday - thurs workout
 * templates (schedules with workouts on it) and a meal one where i have all my meals, and at game
 * time, we merge those together through the operation"*.
 *
 * ── THE MECHANISM ALREADY EXISTS; IT IS THE DATA THAT IS DUPLICATED ───────────────────────────
 *
 * A day column is ALREADY built by four ops merging into it in priority order — `Build Schedule` →
 * `Place Weekday` → `Place Dated Work` → `Place Weekday Tasks`. So layering is what the schedule
 * already does. What was missing is that a weekday template is a whole DAY rather than a LAYER.
 *
 * MEASURED BEFORE ANY CODE, and the number is the whole justification:
 *
 *     distinct meal signatures across the seven templates .......... 1
 *     the eight Eat rows (7am 9 11 1pm 3 5 7 9pm) ......... byte-identical on all seven days
 *     stored ....................................................... 56
 *     needed ....................................................... 8
 *
 * The workouts are NOT duplicated — they are four genuinely distinct sessions (Push · Legs · Pull ·
 * Core) plus Run + Stretch. So the consolidation target is precisely the meals, and the workouts
 * are the thing that becomes REASSIGNABLE: a session moves to another day by editing a dropdown
 * rather than by re-authoring a template.
 *
 * ── ONE STEP OF THE OP CHANGES, AND NOTHING BELOW IT ─────────────────────────────────────────
 *
 * `Place Weekday` resolved ONE template with `FIND ... Weekday IS $wd`. A FIND that matches several
 * rows binds an ARRAY, and every consumer downstream throws on it — the documented failure this
 * repo has paid for more than once. So it does not become a wider FIND; it becomes a LOOP with the
 * match as an inner gate, which is the idiom `0173` already uses:
 *
 *     LOOP over $stPage.occurrences as $wdTplId        <- the page's OWN child list
 *       SET_VAR $wdTpl  = $allItemsById.${$wdTplId}
 *       SET_VAR $tplWd  = $wdTpl.fields.<WD>.value
 *       IF $tplWd IS_NOT_EMPTY AND $tplWd CONTAINS $wd
 *         ...the existing slot walk, UNTOUCHED...
 *
 * **It loops the page's own `occurrences[]` rather than scanning `$allContainers` by ancestor.** All
 * seven templates are direct children of the Schedule Template page (verified: 7 of 7), so the
 * child list is the precise test and it costs no ancestor walk. It also means the `Day` template —
 * which sits in that same list carrying no Weekday — is skipped by the IS_NOT_EMPTY arm rather than
 * by anything knowing its name.
 *
 * `CONTAINS` is array-aware: exact member equality for a multi-select, substring for a scalar. No
 * weekday name is a substring of another, so the scalar arm stays safe for any template not yet
 * converted — which is what makes this migration re-runnable against a half-converted grid.
 *
 * ── THE TEMPLATES ARE REPURPOSED, NOT RE-MINTED ──────────────────────────────────────────────
 *
 * Minting six fresh templates would re-create ~300 slot occurrences to arrive at content the grid
 * already holds, and strand seven as dead clutter — the thing the user has complained about once
 * already ("why are the old ingredients in the grocery list"). So each existing template KEEPS its
 * slots and its rows, and only loses what is now redundant:
 *
 *     Saturday  -> "Meals"              Weekday = all seven      keeps its 8 meals
 *     Monday    -> "Workout — <group>"  Weekday = [Monday]       meals dropped
 *     Tuesday   -> "Workout — <group>"  Weekday = [Tuesday]      meals dropped
 *     Wednesday -> "Workout — <group>"  Weekday = [Wednesday]    meals dropped
 *     Thursday  -> "Workout — <group>"  Weekday = [Thursday]     meals dropped, keeps Run + Stretch
 *     Friday    -> "Cardio — Friday"    Weekday = [Friday]       meals dropped, keeps Run + Stretch
 *     Sunday    -> RETIRED                                       its 8 meals are now the Meals layer
 *
 * **Which template becomes Meals is decided STRUCTURALLY — the meals-only ones — never by name.**
 * "Saturday" is one rename away from being wrong; "carries eight meal rows and nothing else" is a
 * fact about the content. Of the two meals-only templates the FIRST by weekday order is kept and
 * the rest are retired, so the choice is deterministic rather than dependent on Mongo's ordering.
 *
 * A row is a MEAL because it carries a `Meal` pick — the same structural discriminator `0174` had
 * to reach for when matching on a module id turned out not to survive cloning.
 *
 * ── CARDIO FOLDS INTO CORE AND A FRIDAY LAYER — the user's call, asked before building ────────
 *
 * The alternative was a Cardio layer on [Thursday, Friday], which removes the last duplicated pair.
 * The user chose the fold, so Run + Stretch stay on Thursday's template and on Friday's, and those
 * two rows remain duplicated. Recorded rather than silently optimised away: it is two rows, and it
 * is what was asked for.
 *
 * ── TODAY'S COLUMN NEEDS NO CLEAR, AND MEASURING IS WHAT SETTLED THAT ────────────────────────
 *
 * The premise this was designed around — merge idempotence is `auto:<sourceId>`, so consolidating
 * changes the source and doubles every row — **is false here, and only reading the live signatures
 * showed it.** `0112` signs every template row `cycle:<pick label>`:
 *
 *     today  7:00am Eat   cycle:Greek Yogurt Bowl        <- content, not a source id
 *     Monday 7:00am Eat   cycle:Greek Yogurt Bowl        <- identical in all seven templates
 *     Friday 7:00am Run   auto:zlac7lo5tv                <- the one shape that IS a source id
 *
 * A content signature does not move when the row does, so the Meals layer's `7:00am Eat` still
 * matches the one already on today's column. Run and Stretch are the exception, and their templates
 * are REPURPOSED rather than retired, so those ids survive too.
 *
 * So nothing is cleared, nothing is re-signed, and **the two ticked rows on today's column are never
 * at risk** — which is strictly better than either option that was on the table when the question
 * was asked. The user chose clear-and-rebuild over re-signing; the measurement retired both.
 *
 * **The assumption is a GUARD, not a comment.** Before writing, the migration scans every occurrence
 * on the grid for a signature `auto:<id>` naming a row it is about to delete, and REFUSES if it
 * finds one. A rule nobody has watched fail is a guess — this one is cheap and it fails closed.
  */
export const id = "0177-merge-templates-as-layers";
export const describe =
  "Seven day-templates become six reusable layers; Place Weekday merges every template whose Weekday contains the day.";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const uid = () => Math.random().toString(36).slice(2, 14);

/**
 * Replace the single-template FIND with a loop over the Schedule Template page's own children.
 * Exported so the behavioural test drives the SAME transform the migration performs.
 * Returns { changed, reason }.
 */
export function layerizePlaceWeekday(pipeline, { WD }) {
  const findIdx = (steps) => steps.findIndex(
    (s) => s.type === "action" && s.config?.type === "FIND" && s.config?.itemIdVar === "$wdTplId");

  const visit = (steps) => {
    if (!Array.isArray(steps)) return null;
    const i = findIdx(steps);
    if (i > -1) {
      const guard = steps[i + 1];
      if (!guard || guard.type !== "if") return { changed: false, reason: "FIND $wdTplId is not followed by its IF guard" };
      const inner = guard.then;                       // the untouched slot walk
      const loop = {
        id: uid(), type: "loop", overExpr: "$stPage.occurrences", as: "$wdTplId",
        body: [
          { id: uid(), type: "action", config: { type: "SET_VAR", name: "$wdTpl", value: "$allItemsById.${$wdTplId}" } },
          { id: uid(), type: "action", config: { type: "SET_VAR", name: "$tplWd", value: `$wdTpl.fields.${WD}.value` } },
          { id: uid(), type: "if",
            condition: { operator: "AND", rules: [
              { id: uid(), left: "$tplWd", comparator: "IS_NOT_EMPTY", right: "" },
              { id: uid(), left: "$tplWd", comparator: "CONTAINS", right: "$wd" },
            ] },
            then: inner, else: [] },
        ],
      };
      steps.splice(i, 2, loop);                        // FIND + its IF -> the loop
      return { changed: true, reason: "" };
    }
    for (const s of steps) {
      for (const k of ["body", "then", "else"]) {
        const r = visit(s[k]);
        if (r) return r;
      }
    }
    return null;
  };

  // `$stPage` must exist: the op already inits `$stPageId` from it, but not the page itself.
  const steps = pipeline?.steps;
  if (!Array.isArray(steps)) return { changed: false, reason: "no pipeline steps" };
  const already = JSON.stringify(steps).includes('"$stPage.occurrences"');
  if (already) return { changed: false, reason: "already layered" };

  const r = visit(steps);
  if (!r) return { changed: false, reason: "no FIND binding $wdTplId — pipeline shape not recognised" };
  if (!r.changed) return r;

  // bind $stPage beside the existing $stPageId init, deriving the id from the same expr
  const idInit = steps.find((s) => s.type === "action" && s.config?.type === "INIT_VAR" && s.config?.name === "$stPageId");
  if (idInit) {
    const expr = String(idInit.config.expr || "").replace(/\.id$/, "");
    steps.splice(steps.indexOf(idInit), 0,
      { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$stPage", expr } });
  }
  return { changed: true, reason: "" };
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const oById = new Map(occs.map((o) => [o.id, o]));
  const mById = new Map(mods.map((m) => [m.id, m]));
  const lbl = (o) => o?.label ?? mById.get(o?.moduleId)?.label ?? "(none)";
  const fid = (re, type) => fields.find((f) => re.test(f.name || "") && (!type || f.type === type))?.id;

  const WD = fid(/^weekday$/i), MEAL = fid(/^meal$/i), TS = fid(/^time slot$/i);
  const DATE = fid(/^date$/i, "date"), FMT = fid(/^schedule format$/i), DONE = fid(/^completed$/i);
  const MG = fid(/^muscle group$/i), MOVE = fid(/^movement$/i);
  if (!WD || !MEAL || !TS) { log("  REFUSING: missing Weekday / Meal / Time Slot field"); return; }

  const op = ops.find((o) => o.name === "Schedule: Place Weekday");
  if (!op) { log("  REFUSING: no 'Schedule: Place Weekday' operation"); return; }

  // The template page is DERIVED from the op's own $stPageId init, never hardcoded.
  const stInit = (op.pipeline?.steps || []).find(
    (s) => s.type === "action" && s.config?.type === "INIT_VAR" && s.config?.name === "$stPageId");
  const stPageId = String(stInit?.config?.expr || "").match(/\$allItemsById\.([A-Za-z0-9_-]+)/)?.[1];
  const stPage = stPageId && oById.get(stPageId);
  if (!stPage) { log("  REFUSING: could not resolve the Schedule Template page from the op"); return; }
  log(`  template page: ${lbl(stPage)} (${stPageId}), ${stPage.occurrences?.length ?? 0} children`);

  // ── the templates, and what each one holds ────────────────────────────────────────────────
  const tpls = (stPage.occurrences || []).map((id) => oById.get(id)).filter(
    (o) => o && DAYS.includes(String(o.fields?.[WD]?.value ?? (Array.isArray(o.fields?.[WD]?.value) ? "" : ""))) ||
           (o && Array.isArray(o.fields?.[WD]?.value) && o.fields[WD].value.some((v) => DAYS.includes(String(v)))));
  if (!tpls.length) { log("  nothing to do: no weekday templates on the page"); return; }

  const rowsOf = (tpl) => {
    const out = [];
    for (const sid of tpl.occurrences || []) {
      const slot = oById.get(sid); if (!slot) continue;
      const slotTime = String(slot.fields?.[TS]?.value ?? "");
      for (const cid of slot.occurrences || []) {
        const c = oById.get(cid); if (!c) continue;
        out.push({ row: c, slot, slotTime, isMeal: c.fields?.[MEAL]?.value != null && c.fields[MEAL].value !== "" });
      }
    }
    return out;
  };

  const plan = [];
  for (const t of tpls) {
    const v = t.fields[WD].value;
    const day = Array.isArray(v) ? String(v[0]) : String(v);
    const rows = rowsOf(t);
    plan.push({ tpl: t, day, rows, meals: rows.filter((r) => r.isMeal), other: rows.filter((r) => !r.isMeal) });
  }
  plan.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
  for (const p of plan) log(`    ${p.day.padEnd(10)} ${p.meals.length} meal(s) · ${p.other.length} other`);

  // meals-only templates are the Meals-layer candidates — STRUCTURAL, never by name
  const mealsOnly = plan.filter((p) => p.other.length === 0 && p.meals.length > 0);
  if (!mealsOnly.length) { log("  REFUSING: no meals-only template to promote to the Meals layer"); return; }
  const mealsLayer = mealsOnly[0];
  const retire = mealsOnly.slice(1);
  log(`  Meals layer  <- ${mealsLayer.day} (${mealsLayer.meals.length} meals)`);
  log(`  retiring     <- ${retire.map((r) => r.day).join(", ") || "(none)"}`);

  // name the workout/cardio layers from their CONTENT
  const nameFor = (p) => {
    const tally = new Map();
    for (const r of p.other) {
      const pick = r.row.fields?.[MOVE]?.value;
      const ids = Array.isArray(pick) ? pick : pick ? [pick] : [];
      for (const id of ids) {
        const g = MG && oById.get(id)?.fields?.[MG]?.value;
        if (g) { const k = String(Array.isArray(g) ? g[0] : g); tally.set(k, (tally.get(k) || 0) + 1); }
      }
    }
    if (!tally.size) return "Cardio";
    // EVERY group present, most-worked first — derived, never invented. "Push"/"Pull" are
    // domain names no field on this grid carries, and a migration must not make one up.
    const groups = [...tally.entries()].sort((a, b) => b[1] - a[1])
      .map(([g]) => g.charAt(0).toUpperCase() + g.slice(1));
    return `Workout — ${groups.join(" · ")}`;
  };

  const writes = [];
  const layers = plan.filter((p) => p !== mealsLayer && !retire.includes(p));
  for (const p of layers) {
    writes.push({ id: p.tpl.id, label: nameFor(p), wd: [p.day], drop: p.meals.map((m) => m.row.id) });
  }
  writes.push({ id: mealsLayer.tpl.id, label: "Meals", wd: [...DAYS], drop: [] });
  for (const w of writes) log(`  ${w.label.padEnd(22)} Weekday=[${w.wd.join(", ")}]  drop ${w.drop.length} meal row(s)`);

  // ── THE SAFETY PREMISE, VERIFIED RATHER THAN ASSUMED ────────────────────────────────────
  //
  // The plan above DELETES rows (the redundant meals, and the retired template's subtree). That is
  // only safe because a placed row does not point at the row it came from: `0112` signs every
  // template row `cycle:<pick label>` — a CONTENT signature, identical in all seven templates — so
  // moving the meals to one layer changes nothing a day column matches on.
  //
  // Run and Stretch are the exception: they carry no pick, so merge fell back to `auto:<sourceId>`.
  // Their templates are REPURPOSED rather than retired, so those ids survive.
  //
  // This is the check that proves it instead of trusting it: if any live day column holds a row
  // signed `auto:` naming a row this migration is about to delete, the rebuild would lose its match
  // and DOUBLE that row — so refuse, loudly, rather than write.
  const deleting = new Set([
    ...writes.flatMap((w) => w.drop),
    ...retire.flatMap((r) => [r.tpl.id, ...(r.tpl.occurrences || []), ...r.rows.map((x) => x.row.id)]),
  ]);
  const orphaned = [];
  for (const o of occs) {
    const sig = String(o.identitySignature || "");
    if (!sig.startsWith("auto:")) continue;
    if (deleting.has(sig.slice(5))) orphaned.push(`${lbl(o)} (${o.id}) -> ${sig}`);
  }
  log(`  deleting ${deleting.size} occurrence(s); rows anywhere on the grid signed auto: at one of them: ${orphaned.length}`);
  if (orphaned.length) {
    orphaned.slice(0, 10).forEach((x) => log(`     ORPHANED: ${x}`));
    log("  REFUSING: those rows would stop matching and be duplicated on the next build.");
    return;
  }
  log("  -> no placed row depends on a deleted source; today's column needs NO clear and keeps every tick");

  // ── the op ───────────────────────────────────────────────────────────────────────────────
  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const res = layerizePlaceWeekday(pipeline, { WD });
  log(`  op 'Schedule: Place Weekday': ${res.changed ? "layered" : `unchanged (${res.reason})`}`);
  if (!res.changed && res.reason !== "already layered") { log("  REFUSING: the op could not be layered — no data written"); return; }

  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // 1. Weekday becomes multi-select
  await Field.updateOne({ id: WD, gridId }, { $set: { "meta.multiSelect": true } });
  // 2/3. repurpose the templates
  for (const w of writes) {
    await Occurrence.updateOne({ id: w.id, gridId },
      { $set: { label: w.label, [`fields.${WD}`]: { value: w.wd } } });
    if (w.drop.length) {
      await Occurrence.updateMany({ gridId, occurrences: { $in: w.drop } },
        { $pull: { occurrences: { $in: w.drop } } });
      await Occurrence.deleteMany({ gridId, id: { $in: w.drop } });
    }
  }
  // 4. retire the redundant meals-only template(s), subtree included
  for (const r of retire) {
    const subtree = [r.tpl.id, ...(r.tpl.occurrences || []),
      ...r.rows.map((x) => x.row.id)];
    await Occurrence.updateMany({ gridId, occurrences: { $in: subtree } },
      { $pull: { occurrences: { $in: subtree } } });
    await Occurrence.deleteMany({ gridId, id: { $in: subtree } });
    log(`  retired ${r.day}: ${subtree.length} occurrence(s)`);
  }
  // 5. nothing to clear — the guard above proved no placed row depends on a deleted
  //    source, because `0112` signs template rows by CONTENT (`cycle:<pick>`) rather
  //    than by source id. Today's column keeps every row and every tick.
  // 6. the op
  if (res.changed) await Operation.updateOne({ _id: op._id }, { $set: { pipeline } });
  log("  written — RESTART pm2 and reload the grid so the column rebuilds.");
}
