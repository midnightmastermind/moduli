// server/migrations/0395-a-page-per-schedule-template.mjs
//
// The user, 2026-10-12: "there should be a page for each template, not one template page", answered:
// a Templates/Schedule folder holding one page per template. The Schedule Template page held nine
// containers (Schedule: Layout, the six Workouts weekdays, Meals, Schedule: Routine); each becomes
// the only container on a board page of its own name, in the same order, in Templates/Schedule.
// The containers keep their ids, so every operation that names one (Build Schedule's Layout
// copy-link, Place Cycle Day) is untouched.
//
// `Schedule: Fill Day` looped over the Schedule Template page's children. It now loops over every
// container and keeps the ones holding a Weekday value — measured on both grids: exactly the eight
// weekday templates hold one, and nothing else does.
//
// Deletes: the Schedule Template PAGE itself (its occurrence + module) once it is empty, and its tab
// on the panels that list it; a panel showing it is switched to the Schedule page.

export const id = "0395-a-page-per-schedule-template";
export const describe = "Templates/Schedule: one board page per schedule template (containers moved, ids kept); Fill Day finds templates by their Weekday value. DELETES the emptied Schedule Template page (occurrence + module) and its panel tab.";
export const touches = ["folders", "modules", "occurrences", "views", "operations"];

const uid = () => (globalThis.crypto?.randomUUID?.() || `o-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** PURE. The Fill Day pipeline with its template loop reading every container instead of the page. */
export function repointFillDay(steps) {
  let loops = 0, sets = 0;
  const walk = (list) => (list || []).filter((s) => {
    const c = s.config || {};
    // the two INIT_VARs that named the Schedule Template page go: nothing else reads them
    if (s.type === "action" && c.type === "INIT_VAR" && (c.name === "$stPage" || c.name === "$stPageId")) return false;
    return true;
  }).map((s) => {
    const n = { ...s };
    if (n.type === "loop" && n.overExpr === "$stPage.occurrences") { n.overExpr = "$allContainers"; loops++; }
    const c = n.config;
    if (n.type === "action" && c?.type === "SET_VAR" && c.name === "$wdTpl" && c.value === "$allItemsById.${$wdTplId}") {
      n.config = { ...c, value: "$wdTplId" }; sets++;
    }
    for (const k of ["body", "then", "else", "steps"]) if (Array.isArray(n[k])) n[k] = walk(n[k]);
    return n;
  });
  const out = walk(steps);
  return { steps: out, loops, sets };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Folder, Module, Occurrence, View, Operation } = models;
  const tplFolder = (await Folder.find({ gridId, name: "Templates", "meta.protected": true }).lean());
  if (tplFolder.length !== 1) throw new Error(`0395: expected one protected Templates folder, found ${tplFolder.length}`);
  const tf = tplFolder[0];
  const mods = await Module.find({ gridId }).lean(); const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const pageMods = new Set(mods.filter((m) => m.role === "page" && m.label === "Schedule Template").map((m) => m.id));
  const pages = await Occurrence.find({ gridId, parentId: tf.id, moduleId: { $in: [...pageMods] } }).lean();

  let folder = (await Folder.find({ gridId, parentId: tf.id, name: "Schedule" }).lean())[0];
  if (!folder) {
    log(`+ folder Templates/Schedule`);
    if (!dryRun) folder = (await Folder.create({ id: uid(), userId: tf.userId, gridId, parentId: tf.id, name: "Schedule", sortOrder: 0 })).toObject();
    else folder = { id: "(new folder)" };
  } else log("Templates/Schedule already exists");

  if (pages.length > 1) throw new Error(`0395: expected at most one Schedule Template page, found ${pages.length}`);
  const page = pages[0];
  if (page) {
    const kids = await Occurrence.find({ gridId, id: { $in: page.occurrences || [] } }).lean();
    const kidById = Object.fromEntries(kids.map((k) => [k.id, k]));
    const order = (page.occurrences || []).filter((id) => kidById[id]);
    for (const [i, cid] of order.entries()) {
      const c = kidById[cid]; const name = c.label || modById[c.moduleId]?.label || "Template";
      log(`+ page "${name}" holding container ${cid}`);
      if (dryRun) continue;
      const modId = uid(); const occId = uid();
      await Module.create({ id: modId, userId: page.userId, gridId, role: "page", kind: "board", label: name, fieldBindings: [] });
      await Occurrence.create({ id: occId, userId: page.userId, gridId, moduleId: modId, parentId: folder.id, occurrences: [cid],
        fields: {}, filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } }, sortOrder: i });
      await Occurrence.updateOne({ gridId, id: cid }, { $set: { parentId: occId } });
    }
    // the emptied page: off every panel that lists it, and no view left showing it
    const schedMods = new Set(mods.filter((m) => m.role === "page" && m.label === "Schedule").map((m) => m.id));
    const listers = await Occurrence.find({ gridId, occurrences: page.id }).lean();
    for (const l of listers) {
      log(`- unlist the page from ${l.id}`);
      if (!dryRun) await Occurrence.updateOne({ gridId, id: l.id }, { $pull: { occurrences: page.id } });
      if (l.viewId) {
        const v = await View.findOne({ id: l.viewId }).lean();
        if (v?.activeOccurrenceId === page.id) {
          const schedOcc = await Occurrence.findOne({ gridId, id: { $in: l.occurrences || [] }, moduleId: { $in: [...schedMods] } }).lean();
          log(`  view ${l.viewId} showed it -> ${schedOcc ? `Schedule page ${schedOcc.id}` : "nothing"}`);
          if (!dryRun) await View.updateOne({ id: l.viewId }, { $set: { activeOccurrenceId: schedOcc?.id || null } });
        }
      }
    }
    log(`- delete the Schedule Template page ${page.id} (module ${page.moduleId})`);
    if (!dryRun) { await Occurrence.deleteOne({ gridId, id: page.id }); await Module.deleteOne({ gridId, id: page.moduleId }); }
  } else log("no Schedule Template page left");

  const op = await Operation.findOne({ gridId, name: "Schedule: Fill Day" }).lean();
  if (op) {
    const { steps, loops, sets } = repointFillDay(op.pipeline?.steps || []);
    log(`Fill Day: ${loops} loop(s) repointed, ${sets} template lookup(s) simplified`);
    if (!dryRun && (loops || sets)) await Operation.updateOne({ _id: op._id }, { $set: { "pipeline.steps": steps } });
  }
  log("done. Restart the server (pm2).");
}
