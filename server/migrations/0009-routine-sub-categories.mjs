// User, 2026-07-30: "we need to split up the routines into smaller categories
// too with containers within containers. like nutrition should be in physical
// in its own container etc"
//
// Each of the nine Routines dimensions now holds SUB-CATEGORY containers rather
// than a flat list of actions. Mirrors ROUTINE_GROUPS in createLiveData.js —
// keep the two in sync.
//
// Matching is BY ACTION LABEL within a dimension, because the action modules
// carry no key. A label the grid doesn't have is skipped; an action the taxonomy
// doesn't mention is left directly on the dimension (never dropped) and logged,
// so a hand-added action can't silently disappear.
import { nanoid } from "nanoid";

export const id = "0009-routine-sub-categories";
export const describe =
  "Groups each Routines dimension's actions into sub-category containers (Physical → Nutrition / " +
  "Fitness / Rest / Care, and so on for the other eight). MOVES existing action occurrences into " +
  "new containers — creates and re-parents only, deletes nothing. Any action not named in the " +
  "taxonomy stays put and is logged.";

const uid = () => nanoid(12);

const GROUPS = {
  Physical:      { Nutrition: ["Eat", "Cook", "Drink"], Fitness: ["Exercise", "Stretch", "Walk", "Run", "Recover"], Rest: ["Sleep"], Care: ["Hygiene", "Groom"] },
  Emotional:     { Reflection: ["Journal", "Reflect", "Check In"], Expression: ["Express", "Vent", "Celebrate", "Forgive"], Recovery: ["Relax", "Decompress"] },
  Intellectual:  { Study: ["Read", "Study", "Memorize", "Research"], Media: ["Watch", "Listen"], Skill: ["Practice", "Teach", "Analyze", "Explore"], Focus: ["Pomodoro"] },
  Social:        { "Reach Out": ["Text", "Call", "Chat"], Together: ["Meet", "Date", "Visit", "Host"], Give: ["Collaborate", "Mentor", "Volunteer"] },
  Spiritual:     { Practice: ["Pray", "Meditate", "Worship", "Mindfulness"], Study: ["Read Scripture", "Read Philosophy"], Gratitude: ["Gratitude", "Nature", "Serve"] },
  Occupational:  { Planning: ["Plan", "Prioritize", "Review", "Appointment"], "Deep Work": ["Focus", "Build", "Code", "Design"], People: ["Email", "Network"] },
  Financial:     { Earning: ["Earn"], Spending: ["Spend", "Buy", "Pay", "Donate"], Saving: ["Budget", "Save", "Invest"], Admin: ["Track", "Reconcile", "Pay Bill", "Cancel Subscription"] },
  Environmental: { Cleaning: ["Clean", "Declutter", "Organize", "Vacuum"], Chores: ["Laundry", "Dishes", "Recycle"], Upkeep: ["Repair", "Maintain", "Garden"] },
  Creative:      { Visual: ["Draw", "Paint", "Sketch", "Photograph", "Film", "Edit"], Words: ["Write", "Journal Creatively"], Music: ["Compose", "Sing", "Dance"], Making: ["Craft", "Brainstorm", "Prototype", "Invent"] },
};

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const userId = (await Occurrence.findOne({ gridId }).select({ userId: 1 }).lean()).userId;

  const routinesMod = await Module.findOne({ gridId, role: "page", label: "Routines" }).select({ id: 1 }).lean();
  if (!routinesMod) { log("no Routines page — nothing to do"); return; }
  const routines = await Occurrence.findOne({ gridId, moduleId: routinesMod.id }).select({ id: 1, occurrences: 1 }).lean();
  const modOf = async (o) => await Module.findOne({ gridId, id: o.moduleId }).select({ label: 1, role: 1 }).lean();

  for (const dimOccId of routines.occurrences || []) {
    const dim = await Occurrence.findOne({ gridId, id: dimOccId }).select({ id: 1, occurrences: 1, moduleId: 1 }).lean();
    if (!dim) continue;
    const dimMod = await modOf(dim);
    const groups = GROUPS[dimMod?.label];
    if (!groups) { log(`no taxonomy for "${dimMod?.label}" — left alone`); continue; }

    // Current direct children, by label. Anything already a container means
    // this dimension was grouped on an earlier run.
    const byLabel = {}; let alreadyGrouped = 0;
    for (const kid of dim.occurrences || []) {
      const k = await Occurrence.findOne({ gridId, id: kid }).select({ id: 1, moduleId: 1, label: 1 }).lean();
      if (!k) continue;
      const km = await modOf(k);
      if (km?.role === "container") { alreadyGrouped++; continue; }
      byLabel[k.label || km?.label] = k.id;
    }
    if (alreadyGrouped && !Object.keys(byLabel).length) { log(`${dimMod.label}: already grouped`); continue; }

    const placed = new Set(), newChildren = [];
    for (const [groupLabel, actionLabels] of Object.entries(groups)) {
      const kids = actionLabels.map(l => byLabel[l]).filter(Boolean);
      actionLabels.forEach(l => { if (byLabel[l]) placed.add(l); });
      if (!kids.length) continue;
      const gModId = uid(), gOccId = uid();
      log(`  ${dimMod.label} → ${groupLabel}: ${kids.length} action(s)`);
      newChildren.push(gOccId);
      if (dryRun) continue;
      await new Module({ id: gModId, userId, gridId, role: "container", kind: "board", label: groupLabel }).save();
      await new Occurrence({ id: gOccId, userId, gridId, moduleId: gModId, timestamp: new Date(),
        parentId: dim.id, occurrences: kids, fields: {}, meta: {}, filterOverride: {}, hidden: false }).save();
      await Occurrence.updateMany({ gridId, id: { $in: kids } }, { $set: { parentId: gOccId } });
    }
    // Anything the taxonomy doesn't name stays a direct child rather than
    // vanishing from the page.
    const leftovers = Object.entries(byLabel).filter(([l]) => !placed.has(l)).map(([, id]) => id);
    if (leftovers.length) log(`  ${dimMod.label}: ${leftovers.length} action(s) not in the taxonomy — kept at top level`);
    if (dryRun) continue;
    await Occurrence.updateOne({ gridId, id: dim.id }, { $set: { occurrences: [...newChildren, ...leftovers] } });
    // The dimension now renders CONTAINERS.
    await Module.updateOne({ gridId, id: dim.moduleId }, { $set: { "meta.allowChildContainers": true } });
  }
}
