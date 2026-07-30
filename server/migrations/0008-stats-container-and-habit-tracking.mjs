// User, 2026-07-30:
//   "dont let sleep count for the completed tasks goal … make one for habits
//    completed. put completed tasks and completed habits and now and streak in a
//    seperate container at the top of trackers called Todays Stats"
//   "the one that goes in stats for completed also should be all, not just physical"
//   "move the container for workouts into physical (a container inside a
//    container), and the other relevant ones"
//   "sleep shouldnt have a duration field. the operation should just count each
//    one as 30 min"
//
// Four changes, all mirroring what the seed now produces:
//
// 1. A "Stats" container FIRST on the Trackers page holding Completed Tasks ·
//    Completed Habits · Now · Streak (the first, third and fourth MOVE out of
//    Physical). The date-prefix op renders it "Today's Stats". Note the
//    Completed tracker was ALREADY grid-wide — `scopePageOccId` is the Schedule
//    page — so it only READ as physical because of where it sat.
// 2. Habit vs task: a hidden "Habit" field bound on every routine action module.
//    Completed Habits counts items carrying it, Completed Tasks counts items
//    that don't. The discriminator is the module BINDING (`_boundFieldIds`), not
//    a stored value, so it holds for every copy — the 2026-07-11 idiom.
// 3. Workout + Nutrition nest under Physical, Media under Intellectual,
//    Planning under Occupational. Re-parenting is invisible to the tracker ops:
//    each targets its tile by OCCURRENCE ID.
// 4. Sleep loses Duration (done in 0007) and gains a tile fed by counting each
//    completed Sleep occurrence as 30 minutes (`perItem: 30`).
import { makeTrackerOp } from "../utils/liveSystemBuilders.js";
import { nanoid } from "nanoid";

export const id = "0008-stats-container-and-habit-tracking";
export const describe =
  "Adds a Stats container at the top of Trackers (Completed Tasks · Completed Habits · Now · " +
  "Streak, the existing three MOVED out of Physical), a hidden Habit marker bound on every routine " +
  "action, a Sleep tile counting 30 min per completed Sleep, and nests Workout+Nutrition under " +
  "Physical / Media under Intellectual / Planning under Occupational. Renames the Completed tile " +
  "and op to 'Completed Tasks'. Creates and moves; deletes nothing.";

const uid = () => nanoid(12);
const NEST = { Workout: "Physical", Nutrition: "Physical", Media: "Intellectual", Planning: "Occupational" };

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation } = models;
  const userId = (await Occurrence.findOne({ gridId }).select({ userId: 1 }).lean()).userId;

  const fieldByName = async (n) => await Field.findOne({ gridId, name: n }).lean();
  const trackersPage = await Module.findOne({ gridId, role: "page", label: "Trackers" }).select({ id: 1 }).lean();
  if (!trackersPage) { log("no Trackers page — nothing to do"); return; }
  const page = await Occurrence.findOne({ gridId, moduleId: trackersPage.id }).lean();
  const labelOf = async (o) => o.label
    || (await Module.findOne({ gridId, id: o.moduleId }).select({ label: 1 }).lean())?.label || null;

  // Map the page's containers by label (top level + already-nested).
  const containers = {};
  const walk = async (ids) => {
    for (const cid of ids || []) {
      const c = await Occurrence.findOne({ gridId, id: cid }).lean();
      if (!c) continue;
      const mod = await Module.findOne({ gridId, id: c.moduleId }).select({ label: 1, role: 1, meta: 1 }).lean();
      if (mod?.role !== "container") continue;
      containers[mod.label] = { occ: c, mod };
      await walk(c.occurrences);
    }
  };
  await walk(page.occurrences);
  log(`containers on Trackers: ${Object.keys(containers).join(", ")}`);

  // ── 1. Fields ─────────────────────────────────────────────────────────────
  const ensureField = async (name, shape) => {
    const found = await fieldByName(name);
    if (found) { log(`field "${name}" exists`); return found.id; }
    const fid = uid();
    log(`create field "${name}"`);
    if (!dryRun) await new Field({ id: fid, userId, gridId, name, ...shape }).save();
    return fid;
  };
  const sched = (await fieldByName("Completed"))?.folderId ?? null;
  const habitFid = await ensureField("Habit", {
    type: "boolean", inputEnabled: true, displayEnabled: false,
    meta: { variant: "switch", defaultValue: false }, folderId: sched });
  const habitsDoneFid = await ensureField("Habits Completed", {
    type: "number", inputEnabled: false, displayEnabled: true,
    displayConfig: { showArrows: true }, folderId: sched });
  const sleepFid = await ensureField("Sleep Time", {
    type: "duration", inputEnabled: false, displayEnabled: true,
    displayConfig: { showArrows: true }, folderId: sched });

  // ── 2. Bind the Habit marker on every routine action module ───────────────
  const routinesMod = await Module.findOne({ gridId, role: "page", label: "Routines" }).select({ id: 1 }).lean();
  const routines = routinesMod && await Occurrence.findOne({ gridId, moduleId: routinesMod.id }).lean();
  const actionModIds = new Set();
  for (const cid of routines?.occurrences || []) {
    const c = await Occurrence.findOne({ gridId, id: cid }).select({ occurrences: 1 }).lean();
    for (const kid of c?.occurrences || []) {
      const k = await Occurrence.findOne({ gridId, id: kid }).select({ moduleId: 1 }).lean();
      if (k) actionModIds.add(k.moduleId);
    }
  }
  const needMarker = await Module.find({
    gridId, id: { $in: [...actionModIds] }, "fieldBindings.fieldId": { $ne: habitFid },
  }).select({ id: 1 }).lean();
  log(`bind the Habit marker on ${needMarker.length} of ${actionModIds.size} routine action module(s)`);
  if (!dryRun && needMarker.length) {
    await Module.updateMany({ gridId, id: { $in: needMarker.map(m => m.id) } },
      { $push: { fieldBindings: { fieldId: habitFid, role: "input", order: 91, hidden: true } } });
  }

  // ── 3. New tiles + the Stats container ────────────────────────────────────
  // Find a tile by the DISPLAY FIELD it binds, never by label: the routine
  // catalog also has an action called "Sleep", and a label lookup matched THAT
  // and would have wired the Sleep tracker to write onto the routine source.
  const ensureTile = async (label, displayFieldId) => {
    let mod = await Module.findOne({ gridId, role: "instance", "fieldBindings.fieldId": displayFieldId })
      .select({ id: 1 }).lean();
    let occ = mod && await Occurrence.findOne({ gridId, moduleId: mod.id }).select({ id: 1 }).lean();
    if (occ) { log(`tile "${label}" exists`); return occ.id; }
    const modId = mod?.id ?? uid(), occId = uid();
    log(`create tile "${label}"`);
    if (dryRun) return occId;
    if (!mod) await new Module({ id: modId, userId, gridId, role: "instance", label, defaultDragMode: "move",
      fieldBindings: [{ fieldId: displayFieldId, role: "display", order: 0 }] }).save();
    await new Occurrence({ id: occId, userId, gridId, moduleId: modId, timestamp: new Date(),
      fields: {}, meta: {}, occurrences: [], hidden: false }).save();
    return occId;
  };

  // Rename the existing Completed tile + find Now / Streak.
  const completedTile = await Module.findOne({ gridId, role: "instance", label: { $in: ["Completed", "Completed Tasks"] } }).lean();
  if (completedTile && completedTile.label !== "Completed Tasks") {
    log(`rename tile "Completed" → "Completed Tasks"`);
    if (!dryRun) await Module.updateOne({ gridId, id: completedTile.id }, { $set: { label: "Completed Tasks" } });
  }
  const occIdOfTile = async (label) => {
    const mod = await Module.findOne({ gridId, role: "instance", label }).select({ id: 1 }).lean();
    if (!mod) return null;
    const occ = await Occurrence.findOne({ gridId, moduleId: mod.id }).select({ id: 1 }).lean();
    return occ?.id ?? null;
  };
  // Resolve by MODULE ID, not by label: the rename above already landed, so a
  // lookup using the pre-rename label finds nothing and the tile silently fails
  // to move into Stats (hit this on the first apply).
  const completedOccId = completedTile
    ? (await Occurrence.findOne({ gridId, moduleId: completedTile.id }).select({ id: 1 }).lean())?.id ?? null
    : null;
  const nowOccId = await occIdOfTile("Now");
  const streakOccId = await occIdOfTile("Streak");
  const habitsOccId = await ensureTile("Completed Habits", habitsDoneFid);
  const sleepOccId = await ensureTile("Sleep", sleepFid);

  let statsOccId = containers["Stats"]?.occ?.id ?? null;
  if (statsOccId) log(`Stats container exists (${statsOccId})`);
  else {
    const modId = uid(); statsOccId = uid();
    const physBg = containers["Physical"]?.mod?.ownStyle?.bg ?? null;
    log(`create Stats container + place it FIRST on the Trackers page`);
    if (!dryRun) {
      await new Module({ id: modId, userId, gridId, role: "container", kind: "board", label: "Stats",
        ...(physBg ? { styleMode: "own", ownStyle: { bg: physBg } } : {}) }).save();
      await new Occurrence({ id: statsOccId, userId, gridId, moduleId: modId, timestamp: new Date(),
        occurrences: [], fields: {}, meta: {}, hidden: false }).save();
    }
  }

  // Move the four stat tiles into Stats, in order.
  const statKids = [completedOccId, habitsOccId, nowOccId, streakOccId].filter(Boolean);
  log(`Stats will hold ${statKids.length} tile(s); pulling the moved ones out of their old container`);
  if (!dryRun) {
    for (const kid of statKids) {
      await Occurrence.updateMany({ gridId, occurrences: kid, id: { $ne: statsOccId } }, { $pull: { occurrences: kid } });
      await Occurrence.updateOne({ gridId, id: kid }, { $set: { parentId: statsOccId } });
    }
    await Occurrence.updateOne({ gridId, id: statsOccId }, { $set: { occurrences: statKids } });
    // Sleep tile joins Physical.
    const phys = containers["Physical"]?.occ;
    if (phys && sleepOccId) {
      await Occurrence.updateMany({ gridId, occurrences: sleepOccId }, { $pull: { occurrences: sleepOccId } });
      await Occurrence.updateOne({ gridId, id: sleepOccId }, { $set: { parentId: phys.id } });
      await Occurrence.updateOne({ gridId, id: phys.id }, { $addToSet: { occurrences: sleepOccId } });
    }
  }

  // ── 4. Nest the sub-domain containers ─────────────────────────────────────
  for (const [childLabel, parentLabel] of Object.entries(NEST)) {
    const child = containers[childLabel], parent = containers[parentLabel];
    if (!child || !parent) { log(`cannot nest ${childLabel} → ${parentLabel} (missing)`); continue; }
    if ((parent.occ.occurrences || []).includes(child.occ.id)) { log(`${childLabel} already nested in ${parentLabel}`); continue; }
    log(`nest ${childLabel} inside ${parentLabel}`);
    if (dryRun) continue;
    await Occurrence.updateMany({ gridId, occurrences: child.occ.id }, { $pull: { occurrences: child.occ.id } });
    await Occurrence.updateOne({ gridId, id: child.occ.id }, { $set: { parentId: parent.occ.id } });
    await Occurrence.updateOne({ gridId, id: parent.occ.id }, { $addToSet: { occurrences: child.occ.id } });
    // The parent must be willing to RENDER a child container.
    await Module.updateOne({ gridId, id: parent.mod.id }, { $set: { "meta.allowChildContainers": true } });
  }

  // Stats goes first on the page; the nested four leave the top level.
  if (!dryRun) {
    const fresh = await Occurrence.findOne({ gridId, id: page.id }).select({ occurrences: 1 }).lean();
    const nestedIds = new Set();
    for (const childLabel of Object.keys(NEST)) if (containers[childLabel]) nestedIds.add(containers[childLabel].occ.id);
    const rest = (fresh.occurrences || []).filter(cid => cid !== statsOccId && !nestedIds.has(cid));
    await Occurrence.updateOne({ gridId, id: page.id }, { $set: { occurrences: [statsOccId, ...rest] } });
    log(`Trackers page → ${1 + rest.length} top-level container(s), Stats first`);
  }

  // ── 5. The three tracker ops ──────────────────────────────────────────────
  const dateFieldId = (await fieldByName("Date"))?.id;
  const completedFieldId = (await fieldByName("Completed"))?.id;
  const tasksDoneFid = (await fieldByName("Tasks Completed"))?.id;
  const oldOp = await Operation.findOne({ gridId, name: { $in: ["Completed", "Completed Tasks"] } }).lean();
  const schedPageMod = await Module.findOne({ gridId, role: "page", label: "Schedule" }).select({ id: 1 }).lean();
  const schedPage = await Occurrence.findOne({ gridId, moduleId: schedPageMod.id }).select({ id: 1 }).lean();
  const base = { userId, gridId, dateFieldId, completedFieldId,
    folderId: oldOp?.folderId ?? null, scopePageOccId: schedPage.id };
  const notHabit = [{ id: uid(), left: "$item._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: habitFid }];
  const isHabit  = [{ id: uid(), left: "$item._boundFieldIds", comparator: "ARRAY_INCLUDES",     right: habitFid }];

  if (oldOp) {
    const rebuilt = makeTrackerOp({ ...base, name: "Completed Tasks", goalLabel: "Completed Tasks",
      goalOccurrenceId: completedOccId, goalFieldId: tasksDoneFid, agg: "countTrue",
      timeFilter: "daily", matchRules: notHabit });
    log(`re-gate the Completed op → "Completed Tasks" (excludes routines)`);
    if (!dryRun) await Operation.updateOne({ _id: oldOp._id },
      { $set: { name: "Completed Tasks", pipeline: rebuilt.pipeline } });
  }
  const sleepMod = await Module.findOne({ gridId, role: "instance", label: "Sleep" }).select({ id: 1 }).lean();
  const newOps = [
    ["Completed Habits", { goalLabel: "Completed Habits", goalOccurrenceId: habitsOccId,
      goalFieldId: habitsDoneFid, agg: "countTrue", timeFilter: "daily", matchRules: isHabit }],
    ["Sleep Time", { goalLabel: "Sleep", goalOccurrenceId: sleepOccId, goalFieldId: sleepFid,
      agg: "countTrue", timeFilter: "daily", perItem: 30,
      matchRules: sleepMod ? [{ id: uid(), left: "$item.templateId", comparator: "IS", right: sleepMod.id }] : [] }],
  ];
  for (const [name, args] of newOps) {
    if (await Operation.findOne({ gridId, name }).select({ id: 1 }).lean()) { log(`op "${name}" exists`); continue; }
    log(`create op "${name}"`);
    if (!dryRun) await new Operation(makeTrackerOp({ ...base, name, ...args })).save();
  }
}
