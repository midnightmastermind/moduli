// 0454 — every "New …" button's form also asks for the fields its rows use, each with an Include box
// (user, 2026-10-28: "it should ask for the fields as well that tasks uses. they dont have to be required … it
// should have a checkbox next to them asking if its included or not").
//
// For each operation whose pipeline asks with a form (ASK_FORM) and then creates (CREATE), the form gains one
// `optional` input per field the destination's rows use, and the CREATE takes `fieldsFrom: "$form.fields"` — which
// holds only the inputs the user included (client helpers/formItems.answersToResult). Nothing is required.
//
// Which fields, derived from the data, never a list of names: a field is offered when it is bound VISIBLY on at
// least 2 rows and at least 10% of the rows in the button's destination(s), it takes input (not a display/computed
// field), it is not a yes/no box (a new item starts unticked anyway), not a picture or files binding, not a button,
// and the form does not already ask for it. Most-used first.
export const id = "0454-new-buttons-ask-row-fields";
export const describe = "New … button forms ask for the fields their rows use, each with an Include box; Create takes the included ones.";
export const touches = ["operations"];

const MIN_ROWS = 2;
const MIN_SHARE = 0.1;
const SKIP_TYPES = new Set(["boolean", "button"]);
const SKIP_ROLES = new Set(["media", "files", "display"]);

/** Pure: the field ids to offer, most-used first. `rows` are the modules of the destination's rows. */
export function fieldsToOffer(rowModules, fieldsById, askedIds = [], skipTypes = SKIP_TYPES) {
  const counts = new Map();
  for (const m of rowModules) {
    const seen = new Set();
    for (const b of m?.fieldBindings || []) {
      if (!b?.fieldId || b.hidden || SKIP_ROLES.has(b.role) || seen.has(b.fieldId)) continue;
      seen.add(b.fieldId);
      counts.set(b.fieldId, (counts.get(b.fieldId) || 0) + 1);
    }
  }
  const n = rowModules.length;
  const asked = new Set(askedIds);
  return [...counts]
    .filter(([fid, c]) => {
      const f = fieldsById[fid];
      if (!f || f.trashed || asked.has(fid) || skipTypes.has(f.type)) return false;
      if (f.inputEnabled === false || f.displayEnabled === true) return false;
      return c >= MIN_ROWS && c >= n * MIN_SHARE;
    })
    .sort((a, b) => b[1] - a[1] || String(fieldsById[a[0]].name).localeCompare(String(fieldsById[b[0]].name)))
    .map(([fid]) => fid);
}

/** Pure: the pipeline with the inputs added and the CREATE taking them. Idempotent (an item per field once). */
export function patchPipeline(pipeline, offerIds, fieldsById) {
  const p = structuredClone(pipeline);
  const form = p.steps.find((s) => s.config?.type === "ASK_FORM")?.config;
  const create = p.steps.find((s) => s.config?.type === "CREATE")?.config;
  if (!form || !create) return { pipeline: p, added: [], boxed: 0 };
  const taken = new Set(form.items.map((i) => i.key));
  const have = new Set(form.items.map((i) => i.fieldId).filter(Boolean));
  const added = [];
  let boxed = 0;
  // A field input already on the form that is not required gets its Include box too (and Create its map).
  for (const it of form.items) if (it.fieldId && !it.required && !it.optional) { it.optional = true; boxed++; }
  for (const fid of offerIds) {
    if (have.has(fid)) continue;
    const base = String(fieldsById[fid].name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
    let key = base, k = 2;
    while (taken.has(key)) key = `${base}_${k++}`;
    taken.add(key);
    form.items.push({ key, label: fieldsById[fid].name, fieldId: fid, optional: true });
    added.push(fid);
  }
  if (added.length && !create.fieldsFrom) create.fieldsFrom = "$form.fields";
  return { pipeline: p, added, boxed };
}

export async function up({ gridId, models, log, dryRun }) {
  return offerRowFields({ gridId, models, log, dryRun });
}

/** The whole pass; `skipTypes` = field types never offered (0462 lets yes/no fields in). */
export async function offerRowFields({ gridId, models, log, dryRun, skipTypes = SKIP_TYPES }) {
  const { Occurrence, Module, Field, Operation } = models;
  const fieldsById = Object.fromEntries((await Field.find({ gridId }).lean()).map((f) => [f.id, f]));
  const ops = (await Operation.find({ gridId }).lean()).filter((o) =>
    o.pipeline?.steps?.some((s) => s.config?.type === "ASK_FORM") && o.pipeline.steps.some((s) => s.config?.type === "CREATE"));
  const allOccs = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, occurrences: 1, meta: 1 }).lean();
  const allMods = await Module.find({ gridId }, { id: 1, role: 1, fieldBindings: 1 }).lean();
  const occById = new Map(allOccs.map((o) => [o.id, o]));
  const modById = new Map(allMods.map((m) => [m.id, m]));
  const occ = async (oid) => occById.get(oid) || null;
  const mod = async (mid) => modById.get(mid) || null;

  const plan = [];
  for (const op of ops) {
    const form = op.pipeline.steps.find((s) => s.config?.type === "ASK_FORM").config;
    const create = op.pipeline.steps.find((s) => s.config?.type === "CREATE").config;
    const parent = String(create.parent || "");
    let dests;
    if (parent.startsWith("$form.values.")) {
      dests = (form.items.find((i) => i.key === parent.split(".").pop())?.options || []).map((o) => o.value);
    } else if (parent.startsWith("$trigger.")) {
      // Creates into the pressed occurrence: the destinations are the placements binding this op's button field.
      const buttonIds = (op.triggerObjects || []).filter((t) => t?.eventType === "onButton").map((t) => t.fieldId || t.targetId).filter(Boolean);
      const hostMods = new Set(allMods.filter((m) => (m.fieldBindings || []).some((b) => buttonIds.includes(b.fieldId))).map((m) => m.id));
      dests = allOccs.filter((o) => hostMods.has(o.moduleId) && !o.meta?.feedSourceId).map((o) => o.id);
    } else {
      dests = [parent.replace(/^literal:/, "")];
    }
    // A destination's rows: its instance/artifact children; a board holding only containers looks one level in.
    const rows = [];
    for (const d of dests) {
      const c = await occ(d);
      let kids = [];
      for (const k of c?.occurrences || []) { const o = await occ(k); if (o && !o.meta?.feedSourceId) kids.push(o); }
      const kidMods = await Promise.all(kids.map((o) => mod(o.moduleId)));
      let rowMods = kidMods.filter((m) => m && (m.role === "instance" || m.role === "artifact"));
      if (!rowMods.length) {
        for (const [i, m] of kidMods.entries()) {
          if (m?.role !== "container") continue;
          for (const k of kids[i].occurrences || []) { const o = await occ(k); if (!o || o.meta?.feedSourceId) continue; const mm = await mod(o.moduleId); if (mm && (mm.role === "instance" || mm.role === "artifact")) rowMods.push(mm); }
        }
      }
      rows.push(...rowMods);
    }
    // Already asked by the form, or already written by the Create (a board's own tag): not offered again.
    const asked = [...form.items.map((i) => i.fieldId).filter(Boolean), ...Object.keys(create.fields || {})];
    const offer = fieldsToOffer(rows, fieldsById, asked, skipTypes);
    const next = patchPipeline(op.pipeline, offer, fieldsById);
    plan.push({ op, next, rows: rows.length });
    log(`  ${op.name} (${dests.length} destination${dests.length === 1 ? "" : "s"}, ${rows.length} rows): ${next.added.length ? next.added.map((f) => fieldsById[f].name).join(", ") : "nothing to add"}${next.boxed ? ` · ${next.boxed} existing input(s) get an Include box` : ""}`);
  }
  if (dryRun) return;
  for (const { op, next } of plan) {
    if (!next.added.length && !next.boxed) continue;
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next.pipeline, updatedAt: new Date() } });
  }
  log("  applied. RESTART pm2.");
}
