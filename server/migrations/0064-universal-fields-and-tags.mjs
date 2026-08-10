// server/migrations/0064-universal-fields-and-tags.mjs
//
// Make Tags and Date UNIVERSAL — carried by every occurrence — and give Tags
// real data derived from the grid's own structure.
//
// ── WHY THE GRID HOLDS THE LIST ─────────────────────────────────────────────
//
// User, 2026-08-10: *"it shouldnt be hard coded at all, it should be set on the
// grid level to give every occurance that field (and Date). just like we do on
// the schedule level."* So this writes `grid.meta.universalFieldIds`, the same
// shape as the existing `grid.meta.scheduleFieldIds`, and the client resolves
// the list at render time (`helpers/universalFields`). Nothing in the code names
// Tags.
//
// The alternative was writing the binding onto all 2,505 modules of poms grid —
// a large write to protected live data AND a rule every future module has to
// remember. A grid-level list cannot be forgotten by a module that does not
// exist yet.
//
// ── THE TAG RULES READ STRUCTURE THAT ALREADY EXISTS ────────────────────────
//
// Every rule reads a value the grid already holds. Nothing is inferred from a
// label, and nothing is invented — the standing rule that a plausible-looking
// value on real data is indistinguishable from one the user entered.
//
//   board category   an option's own `Board Category` value  → that value
//   file kind        an artifact homed in Files/<kind>       → images→image, …
//   routine          anything under a Routines dimension     → the dimension
//
// MEASURED ON THE LIVE GRIDS BEFORE THESE WERE WRITTEN, which is what makes the
// dry run checkable against a NAMED expectation rather than a count:
//
//   poms grid     board category  382 live  (+156 feed copies, EXCLUDED)
//                 Files subfolders present, 223 artifacts homed in them
//                 Routines        9 dimensions
//   test grid 2   board category  251 live  (0 feed copies)
//                 Files subfolders present, 0 artifacts homed
//                 Routines        9 dimensions
//   test grid 1   none of the three — it only gets the universalFieldIds stamp
//
// ── FEED COPIES ARE NEVER WRITTEN, and that is not a detail ─────────────────
//
// A feed copy carries its SOURCE's field values, including its board category —
// which is why every board dropdown's predicate already excludes them. feedSync
// sweeps and re-mints them from the source, so a tag written onto a copy is a
// write to something about to be overwritten. 156 of poms grid's 538
// board-category occurrences are copies.
//
// ── IT OVERWRITES NOTHING ───────────────────────────────────────────────────
//
// An occurrence that already carries a Tags value is left alone: that value is
// the user's. Re-running only fills what is still empty, which is also what
// makes it idempotent.

export const id = "0064-universal-fields-and-tags";
export const describe =
  "Stamps grid.meta.universalFieldIds with the Tags and Date fields so every "
  + "occurrence carries them, backfills Tags from structure the grid already has "
  + "(board category, Files/<kind>, Routines dimension), appends any new values to "
  + "the Tags option list, and turns Tags on for the Trackers page as the one "
  + "visible demonstration.";

const FILES_KIND_TAG = { images: "image", video: "video", audio: "audio", documents: "document" };

/** A stored field value is either the {value,flow} wrapper or the bare value. */
export function readValue(occ, fieldId) {
  const raw = occ?.fields?.[fieldId];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return "value" in raw ? raw.value : undefined;
  return raw;
}

/**
 * Resolve a field BY NAME AND TYPE.
 *
 * Type matters: poms grid carries two fields called "Due" (a display number and
 * the real date), and matching on name alone picks whichever Mongo returns
 * first — the trap migration 0053 recorded. Returns null when absent or
 * ambiguous so the caller can fail closed rather than guess.
 */
export function resolveFieldByName(fields, name, type) {
  const hits = fields.filter(
    (f) => (f.name || "").toLowerCase() === name.toLowerCase() && (!type || f.type === type),
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Which tags each occurrence should gain. PURE — the whole risk of this
 * migration is the selector, so it is testable without a database.
 *
 * @returns Map<occurrenceId, string[]>  only for occurrences that gain something
 */
export function deriveTags({ occurrences, modulesById, foldersById, boardCategoryFieldId, tagsFieldId }) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const out = new Map();
  const add = (occId, tag) => {
    if (!tag) return;
    if (!out.has(occId)) out.set(occId, new Set());
    out.get(occId).add(String(tag).toLowerCase());
  };

  // A row the user has already tagged is theirs — never touched, and that is
  // what makes a re-run a no-op rather than an accumulation.
  const alreadyTagged = (o) => {
    const v = readValue(o, tagsFieldId);
    return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
  };
  // Derived data: feedSync re-mints these from their source, so writing here
  // writes to something about to be overwritten.
  const writable = (o) => o && !o.meta?.feedSourceId && !alreadyTagged(o);

  // 1. BOARD CATEGORY — an option board's own tag. The single richest source
  //    (382 live occurrences on poms grid across 35 distinct values).
  if (boardCategoryFieldId) {
    for (const o of occurrences) {
      if (!writable(o)) continue;
      const v = readValue(o, boardCategoryFieldId);
      for (const t of Array.isArray(v) ? v : (v ? [v] : [])) add(o.id, t);
    }
  }

  // 2. FILE KIND — an artifact's home folder under Files. `Files/Images` is a
  //    fact about the file that the folder tree already records.
  for (const o of occurrences) {
    if (!writable(o)) continue;
    if (modulesById.get(o.moduleId)?.role !== "artifact") continue;
    const folder = o.parentId ? foldersById.get(o.parentId) : null;
    const tag = folder ? FILES_KIND_TAG[(folder.name || "").toLowerCase()] : null;
    if (tag) add(o.id, tag);
  }

  // 3. ROUTINE DIMENSION — everything in a dimension's subtree carries that
  //    dimension. Walked from the Routines PAGE's own children rather than
  //    matched on a label list, so a dimension renamed or added tomorrow is
  //    picked up without editing this file.
  const routinesPage = occurrences.find(
    (o) => modulesById.get(o.moduleId)?.role === "page"
      && (o.label || modulesById.get(o.moduleId)?.label) === "Routines",
  );
  if (routinesPage) {
    for (const dimId of routinesPage.occurrences || []) {
      const dim = byId.get(dimId);
      if (!dim) continue;
      const tag = dim.label || modulesById.get(dim.moduleId)?.label;
      if (!tag) continue;
      // Depth-capped walk: a cycle in `occurrences[]` must not hang a migration.
      const seen = new Set([dimId]);
      const stack = [...(dim.occurrences || [])];
      let guard = 0;
      while (stack.length && guard++ < 5000) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const kid = byId.get(id);
        if (!kid) continue;
        if (writable(kid)) add(kid.id, tag);
        for (const g of kid.occurrences || []) stack.push(g);
      }
    }
  }

  return new Map([...out].map(([k, set]) => [k, [...set].sort()]));
}

/** Values the Tags field does not offer yet, so its dropdown lists what the data holds. */
export function missingOptionValues(field, tagValues) {
  const manual = field?.meta?.optionsSource?.values;
  const legacy = field?.meta?.options;
  const have = new Set(
    (Array.isArray(manual) ? manual : Array.isArray(legacy) ? legacy : [])
      .map((o) => String(o?.value ?? o).toLowerCase()),
  );
  return [...new Set(tagValues)].filter((v) => !have.has(v)).sort();
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Folder, Grid } = models;
  const [fields, mods, occs, folders] = await Promise.all([
    Field.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
    Folder.find({ gridId }).lean(),
  ]);

  const tagsField = resolveFieldByName(fields, "Tags", "select");
  const dateField = resolveFieldByName(fields, "Date", "date");
  // FAIL CLOSED. Guessing which field is "the tags one" is exactly how a
  // migration writes to the wrong column.
  if (!tagsField) { log("  · no unambiguous Tags field — REFUSING, nothing written"); return; }

  const universalFieldIds = [tagsField.id, ...(dateField ? [dateField.id] : [])];
  if (!dateField) log("  · no unambiguous Date field — stamping Tags only");

  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const bc = resolveFieldByName(fields, "Board Category", "select");

  const tagPlan = deriveTags({
    occurrences: occs, modulesById, foldersById,
    boardCategoryFieldId: bc?.id || null, tagsFieldId: tagsField.id,
  });
  const allValues = [...new Set([...tagPlan.values()].flat())];
  const newOptions = missingOptionValues(tagsField, allValues);

  // The one visible demonstration (the user's pick): Tags ON for the Trackers
  // page, and its containers laid out as wrapping squares. Everything else on
  // the grid stays hidden.
  const trackers = occs.find(
    (o) => modulesById.get(o.moduleId)?.role === "page"
      && (o.label || modulesById.get(o.moduleId)?.label) === "Trackers",
  );

  log(`  · universal fields: ${universalFieldIds.length} (${tagsField.name}${dateField ? " + " + dateField.name : ""})`);
  log(`  · tags to write: ${tagPlan.size} occurrence(s), ${allValues.length} distinct value(s)`);
  log(`     ${allValues.slice(0, 12).join(", ")}${allValues.length > 12 ? ` … +${allValues.length - 12}` : ""}`);
  log(`  · new option values for the Tags field: ${newOptions.length}`);
  log(`  · Trackers page: ${trackers ? `"${trackers.id}" — show Tags + wrap children` : "NOT FOUND, skipping the demo"}`);
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  // 1. the grid's list
  await Grid.updateOne({ _id: gridId }, { $set: { "meta.universalFieldIds": universalFieldIds } });

  // 2. the tag values — written one occurrence at a time against its OWN
  //    fields object, so a concurrent write to another field is not clobbered.
  let wrote = 0;
  for (const [occId, tags] of tagPlan) {
    await Occurrence.updateOne(
      { gridId, id: occId },
      { $set: { [`fields.${tagsField.id}`]: { value: tags, flow: "in" } } },
    );
    wrote++;
  }

  // 3. the option list — appended to WHICHEVER shape this grid uses. Manual
  //    mode stores them at meta.optionsSource.values, older fields at
  //    meta.options; writing the wrong one leaves a list nothing reads (0054).
  if (newOptions.length) {
    const rows = newOptions.map((v) => ({ value: v, label: v }));
    const usesSource = Array.isArray(tagsField.meta?.optionsSource?.values);
    const path = usesSource ? "meta.optionsSource.values" : "meta.options";
    const existing = usesSource ? tagsField.meta.optionsSource.values : (tagsField.meta?.options || []);
    await Field.updateOne({ gridId, id: tagsField.id }, { $set: { [path]: [...existing, ...rows] } });
  }

  // 4. the demonstration
  if (trackers) {
    await Occurrence.updateOne({ gridId, id: trackers.id }, {
      $set: {
        fieldVisibility: { mode: "show", fieldIds: [tagsField.id] },
        // Same cascade key the board page uses; ModuleContainer reads it for
        // its children. Set on the PAGE so every container under it follows.
        "meta.layoutCascade.mode": "wrap",
        "meta.layoutCascade.childMinWidth": 132,
      },
    });
  }

  log(`  ✓ stamped ${universalFieldIds.length} universal field(s), tagged ${wrote} occurrence(s), `
    + `added ${newOptions.length} option(s)${trackers ? ", turned Tags on for Trackers" : ""}`);
}
