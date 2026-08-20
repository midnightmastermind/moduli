/**
 * 0158 — a Medications board, a Medication dropdown, and a "Take Medication" routine.
 *
 * USER, 2026-08-20: *"we need to add my medications in too to a board and then used as a dropdown
 * for a take medication routine occurance. aripiprazole 10mg, lamotrigine 100mg, vivance 30mg,
 * trazadone 50mg."*
 *
 * EVERY PIECE IS COPIED FROM THE ONE THIS GRID ALREADY HAS FOR SUPPLEMENTS, at run time rather than
 * restated here. `Recover` binds a multi-select `Supplement` dropdown scoped to the Supplements
 * board, which is the same three-part shape — board, dropdown, routine — one category over. Reading
 * the exemplar means a board that has since been re-homed or re-tagged carries this one with it,
 * and it is what `0059` and `0054` both had to be repaired for not doing.
 *
 * MULTI-SELECT, AND THAT IS PRECEDENT RATHER THAN A GUESS: `Supplement` is `multiSelect: true`, so
 * one `Recover` row records everything taken in that dose. Medications work the same way — a
 * morning dose is several pills and one row per pill would put four rows in one timeslot.
 *
 * THE DOSE IS PART OF THE NAME, and that is a deliberate departure from `0122`, which pulled
 * amounts OUT of ingredient titles. An ingredient's amount is a serving size — a property of the
 * portion. A medication's dose is its IDENTITY: 10mg and 20mg aripiprazole are different things to
 * take, and a dropdown that lists them both as "Aripiprazole" is unusable. It is ALSO stored on
 * `module.meta.dose`, so nothing downstream ever has to parse a label to get the number.
 *
 * TWO NAMES ARE SPELLED AS THE MANUFACTURER SPELLS THEM — "Vyvanse" for *vivance* and "Trazodone"
 * for *trazadone*. On a medication list a phonetic spelling is the kind of thing that reads as
 * correct and is not, and this is the one board where that matters. **Flagged rather than done
 * silently**; the doses are the user's own and are written exactly as given.
 *
 * NOTHING IS PLACED ON A SCHEDULE. The ask is a routine that EXISTS and a dropdown that lists the
 * medications; putting it on the day template would change what appears on every morning's schedule
 * — a separate decision, and the user's.
 *
 * WHAT IS NOT INVENTED: no times, no frequencies, no prescriber, no refill dates. `0052` set that
 * rule for phone numbers and `0054` for addresses, and a plausible-looking dosing schedule on a real
 * medication list is worse than either.
 */
export const id = "0158-medications-board-and-routine";
export const describe = "A Medications board with four medications, a Medication dropdown, and a Take Medication routine in Physical > Care.";

const TAG = "medication";
const MEDS = [
  { name: "Aripiprazole", dose: "10mg" },
  { name: "Lamotrigine", dose: "100mg" },
  { name: "Vyvanse", dose: "30mg" },
  { name: "Trazodone", dose: "50mg" },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map(m => [m.id, m]));
  const oById = new Map(occs.map(o => [o.id, o]));
  const lbl = (o) => o.label || mById.get(o.moduleId)?.label || "";

  // ---- the exemplars, all resolved by NAME ------------------------------
  const bc = fields.find(f => f.name === "Board Category");
  const supField = fields.find(f => f.name === "Supplement" && f.type === "occurrence");
  const supBoard = occs.find(o => o.feed?.enabled &&
    (o.feed.conditions || []).some(c => c.fieldId === bc?.id && c.value === "supplement"));
  const exOption = supBoard && (supBoard.occurrences || []).map(id => oById.get(id))
    .find(o => o && !o.meta?.feedSourceId);
  const hygiene = occs.find(o => lbl(o) === "Hygiene" && mById.get(o.moduleId)?.role === "instance"
    && lbl(oById.get(o.parentId) || {}) === "Care");
  const care = hygiene && oById.get(hygiene.parentId);
  const missing = [["Board Category", bc], ["Supplement field", supField], ["Supplements board", supBoard],
    ["a supplement option to copy", exOption], ["the Hygiene routine", hygiene], ["the Care container", care]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { log(`  REFUSING: cannot resolve ${missing.join(", ")}`); return; }

  const userId = hygiene.userId;
  const supMod = mById.get(supBoard.moduleId), hygMod = mById.get(hygiene.moduleId);
  const exMod = mById.get(exOption.moduleId);

  // ---- what already exists ----------------------------------------------
  const tagList = bc.meta?.optionsSource?.values ? "optionsSource.values" : "options";
  const tags = (bc.meta?.optionsSource?.values || bc.meta?.options || []);
  const tagPresent = tags.includes(TAG);
  const board = occs.find(o => o.feed?.enabled &&
    (o.feed.conditions || []).some(c => c.fieldId === bc.id && c.value === TAG));
  const medField = fields.find(f => f.name === "Medication" && f.type === "occurrence");
  const routine = occs.find(o => lbl(o) === "Take Medication" && o.parentId === care.id);
  const have = new Set(occs.filter(o => {
    const v = o.fields?.[bc.id]?.value; return Array.isArray(v) ? v.includes(TAG) : v === TAG;
  }).map(o => lbl(o)));
  const toMint = MEDS.filter(m => !have.has(`${m.name} ${m.dose}`));

  log(`  "${TAG}" in Board Category (${tagList}): ${tagPresent ? "present" : "to add"}`);
  log(`  Medications board: ${board ? "present" : "to create"} · Medication field: ${medField ? "present" : "to create"}`);
  log(`  medications to mint: ${toMint.length} of ${MEDS.length}${toMint.length ? ` (${toMint.map(m => m.name).join(", ")})` : ""}`);
  log(`  "Take Medication" routine in Care: ${routine ? "present" : "to create"}`);
  if (tagPresent && board && medField && !toMint.length && routine) { log("  already converged"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);

  // ---- 1. the tag --------------------------------------------------------
  if (!tagPresent) {
    const path = bc.meta?.optionsSource?.values ? "meta.optionsSource.values" : "meta.options";
    await Field.updateOne({ id: bc.id, gridId }, { $push: { [path]: TAG } });
    log(`  added "${TAG}" to Board Category (${path})`);
  }

  // ---- 2. the board — the Supplements board's own shape -------------------
  let boardId = board?.id;
  if (!board) {
    const modId = uid(); boardId = uid();
    await Module.create({ ...stripId(supMod), id: modId, label: "Medications" });
    await Occurrence.create({
      id: boardId, userId, gridId, moduleId: modId,
      parentId: supBoard.parentId,                    // the same folder the other boards live in
      filterOverride: supBoard.filterOverride ?? {},
      filterNavConfig: supBoard.filterNavConfig ?? {},
      occurrences: [],
      fields: { [bc.id]: { value: [TAG], flow: "in" } },
      feed: { ...supBoard.feed, conditions: (supBoard.feed.conditions || [])
        .map(c => c.fieldId === bc.id ? { ...c, value: TAG } : c) },
      sortOrder: (supBoard.sortOrder ?? 0) + 1,
    });
    log(`  created the Medications board (${boardId}), homed beside Supplements`);
  }

  // ---- 3. the options ----------------------------------------------------
  for (const m of toMint) {
    const modId = uid(), occId = uid();
    await Module.create({
      ...stripId(exMod), id: modId, label: `${m.name} ${m.dose}`,
      // The option's OWN identity fields only — the exemplar's poster/files
      // bindings come with it so a picture can be set the ordinary way.
      meta: { ...(exMod.meta || {}), dose: m.dose, genericName: m.name },
    });
    await Occurrence.create({
      id: occId, userId, gridId, moduleId: modId, parentId: boardId,
      occurrences: [], fields: { [bc.id]: { value: [TAG], flow: "in" } },
    });
    await Occurrence.updateOne({ id: boardId, gridId }, { $addToSet: { occurrences: occId } });
    log(`  minted "${m.name} ${m.dose}"`);
  }

  // ---- 4. the dropdown — the Supplement field's own shape -----------------
  let medFieldId = medField?.id;
  if (!medField) {
    medFieldId = uid();
    const src = structuredClone(supField.meta?.optionsSource || {});
    src.predicate = replaceTag(src.predicate, TAG);
    src.addNew = { parentOccurrenceId: boardId };
    await Field.create({
      id: medFieldId, gridId, userId, name: "Medication", type: supField.type,
      inputEnabled: true, displayEnabled: false,
      meta: { ...(supField.meta || {}), optionsSource: src },
    });
    log(`  created the "Medication" dropdown (multiSelect=${supField.meta?.multiSelect === true})`);
  }

  // ---- 5. the routine — Hygiene's own shape, plus the dropdown -----------
  if (!routine) {
    const modId = uid(), occId = uid();
    // THE HABIT MARKER RIDES ALONG WITH THE EXEMPLAR. A routine minted without
    // it lands in the TASKS count instead of Completed Habits (2026-08-13), and
    // copying Hygiene's bindings is what makes that impossible to forget.
    const bindings = (hygMod.fieldBindings || []).map(b => ({ ...b, _id: undefined }));
    bindings.splice(1, 0, { fieldId: medFieldId, order: 1, role: "input" });
    await Module.create({ ...stripId(hygMod), id: modId, label: "Take Medication",
      fieldBindings: bindings.map((b, i) => ({ ...b, order: b.order ?? i })) });
    await Occurrence.create({
      id: occId, userId, gridId, moduleId: modId, parentId: care.id,
      occurrences: [], fields: structuredClone(hygiene.fields || {}),
      sortOrder: (hygiene.sortOrder ?? 0) + 1,
    });
    await Occurrence.updateOne({ id: care.id, gridId }, { $addToSet: { occurrences: occId } });
    log(`  created the "Take Medication" routine in Physical > Care`);
  }
  log("  done — RESTART pm2 and reload.");
}

// Mongo's own `_id` must never be carried onto a copy, and neither must the
// subdocument `_id`s inside fieldBindings — reusing one is a duplicate key.
function stripId(doc) {
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  if (Array.isArray(rest.fieldBindings)) {
    rest.fieldBindings = rest.fieldBindings.map(({ _id: _drop, ...b }) => b);
  }
  return rest;
}

// The exemplar's predicate names "supplement" wherever it tests the tag; this
// rewrites those leaves and leaves every other rule (the feed-copy exclusion)
// exactly as it is.
function replaceTag(node, tag) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node.rules)) return { ...node, rules: node.rules.map(r => replaceTag(r, tag)) };
  if (node.right === "supplement") return { ...node, right: tag };
  return node;
}
