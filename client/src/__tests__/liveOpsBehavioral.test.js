// Behavioral audit of the LIVE-GRID operations, driven by the exported seed
// (server/seed/*.json — refreshed on every reseed). This is the repeatable
// form of the 2026-07-07 headless probes: it boots the executor on the real
// seeded pipelines, replays the onLoad sweep (which mints today's schedule +
// goal occurrences), then fires REAL transactions — every input type the user
// exercises (boolean toggle, number, select, duration, amount+flow, reps) plus
// occurrence adds/deletes (drops) — and asserts the tracker/goal VALUES that
// land, not just that ops matched.
//
// Tests in each describe block are SEQUENTIAL — they share the mutated
// occurrence store the way a real session does (each fire sees prior writes).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/seed");
const loadSeed = (name) => JSON.parse(readFileSync(path.join(seedDir, name), "utf8"));

// ── Shared executor world ──────────────────────────────────────────────────
let operations, operationsById, fieldsById, fieldIdByName, modulesById, occurrencesById, grid;

const uid = () => `test-${Math.random().toString(36).slice(2, 10)}`;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function buildCtx() {
  const state = {
    grid,
    gridId: grid?._id,
    fields: Object.values(fieldsById),
    modules: Object.values(modulesById),
    occurrencesById,
    modulesById,
    fieldsById,
    operationsById,
    operations,
  };
  return { state, fieldsById, operationsById, occurrencesById, modulesById };
}

function fire(transactionType, transaction) {
  const updates = runMatchingOperations(operations, transactionType, transaction, buildCtx());
  applyEffectsToLiveOccs(occurrencesById, updates);
  return updates;
}

// Reverse-map ancestor chain (occurrences[] primary, parentId fallback) —
// mirrors CommitHelpers._ancestorChain so ancestorLabel-scoped triggers match.
function ancestorChain(occId) {
  const parentByChild = {};
  for (const o of Object.values(occurrencesById)) {
    for (const cid of o.occurrences || []) parentByChild[cid] = o.id;
  }
  const ids = [], labels = [];
  let cur = occurrencesById[occId];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const nextId = parentByChild[cur.id] ?? cur.parentId;
    const next = nextId ? occurrencesById[nextId] : null;
    if (!next) break;
    ids.push(next.id);
    labels.push(next.label || modulesById[next.moduleId]?.label || "");
    cur = next;
  }
  return { ids, labels };
}

function moduleByLabel(label, role) {
  return Object.values(modulesById).find(m => m.label === label && (!role || m.role === role));
}
// First occurrence of a module (by label) that carries the named field key —
// how the goal tiles are read (each goal instance owns its written fields).
function goalOcc(moduleLabel, fieldName = null) {
  const mods = Object.values(modulesById).filter(m => m.label === moduleLabel);
  const modIds = new Set(mods.map(m => m.id));
  const all = Object.values(occurrencesById).filter(o => modIds.has(o.moduleId));
  if (fieldName) {
    const fid = fieldIdByName[fieldName];
    const withField = all.find(o => o.fields && fid in o.fields);
    if (withField) return withField;
  }
  return all.find(o => Object.keys(o.fields || {}).length > 0) || all[0];
}
function goalValue(moduleLabel, fieldName) {
  const occ = goalOcc(moduleLabel, fieldName);
  const fid = fieldIdByName[fieldName];
  const v = occ?.fields?.[fid];
  return v && typeof v === "object" && "value" in v ? v.value : v;
}
// Scan EVERY occurrence for a field value — for trackers whose goal tile
// module label is ambiguous; asserts the write landed somewhere real.
function anyFieldValues(fieldName) {
  const fid = fieldIdByName[fieldName];
  const out = [];
  for (const o of Object.values(occurrencesById)) {
    const v = o.fields?.[fid];
    if (v !== undefined) out.push(v && typeof v === "object" && "value" in v ? v.value : v);
  }
  return out;
}

// Read a tracker op's ACTUAL write target straight from its pipeline:
// $goalItem = $allItemsById.<occId>  +  UPDATE $goalItem.fields.<fid>.value.
// Immune to duplicate field NAMES and mirror-copy ambiguity.
function trackerValue(opName) {
  const op = operations.find(o => o.name === opName);
  expect(op, `op "${opName}"`).toBeTruthy();
  const raw = JSON.stringify(op.pipeline);
  const goalId = raw.match(/"\$goalItem", "expr": "\$allItemsById\.([^"]+)"/)?.[1]
    || raw.match(/\$allItemsById\.([A-Za-z0-9_-]+)/)?.[1];
  const fid = raw.match(/\$goalItem\.fields\.([A-Za-z0-9_-]+)\.value/)?.[1];
  expect(goalId, `goal occ for "${opName}"`).toBeTruthy();
  expect(fid, `goal field for "${opName}"`).toBeTruthy();
  const v = occurrencesById[goalId]?.fields?.[fid];
  return v && typeof v === "object" && "value" in v ? v.value : v;
}

// Find one of TODAY's schedule slot containers (built by the onLoad sweep).
function scheduleSlotOcc(slotLabel) {
  return Object.values(occurrencesById).find(o => {
    const m = modulesById[o.moduleId];
    if ((o.label || m?.label) !== slotLabel) return false;
    return ancestorChain(o.id).labels.includes("Schedule");
  });
}

// Simulate a DROP: mint an occurrence of `moduleLabel` under a schedule slot
// (Date + Time Slot stamped like the drop path does) and fire OccurrenceCreateOp.
function addToSlot(moduleLabel, slotLabel, extraFields = {}) {
  const mod = moduleByLabel(moduleLabel, "instance");
  expect(mod, `module "${moduleLabel}"`).toBeTruthy();
  const slot = scheduleSlotOcc(slotLabel);
  expect(slot, `slot "${slotLabel}"`).toBeTruthy();
  const id = uid();
  const fields = {
    [fieldIdByName["Date"]]: { value: todayIso(), flow: "in" },
    [fieldIdByName["Time Slot"]]: { value: slotLabel, flow: "in" },
    ...Object.fromEntries(Object.entries(extraFields).map(([name, value]) =>
      [fieldIdByName[name], { value, flow: "in" }])),
  };
  occurrencesById[id] = {
    id, moduleId: mod.id, parentId: slot.id, fields,
    occurrences: [], role: "instance", kind: mod.kind, label: mod.label,
  };
  occurrencesById[slot.id] = { ...slot, occurrences: [...(slot.occurrences || []), id] };
  const anc = ancestorChain(id);
  fire("OccurrenceCreateOp", {
    type: "OccurrenceCreateOp",
    occurrenceId: id, instanceId: mod.id, containerId: slot.moduleId,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])),
    _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
  });
  return id;
}

// Simulate an INPUT: write the field value on the occurrence (optimistic),
// then fire the per-field MeasureOp exactly like CommitHelpers does.
function inputField(occId, fieldName, value, flow = "in") {
  const occ = occurrencesById[occId];
  expect(occ, `occurrence ${occId}`).toBeTruthy();
  const fid = fieldIdByName[fieldName];
  expect(fid, `field "${fieldName}"`).toBeTruthy();
  occurrencesById[occId] = {
    ...occ,
    fields: { ...(occ.fields || {}), [fid]: { ...(occ.fields?.[fid] || {}), value, flow } },
  };
  const anc = ancestorChain(occId);
  return fire("MeasureOp", {
    type: "MeasureOp",
    occurrenceId: occId, instanceId: occ.moduleId,
    fields: { [fid]: value },
    _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
  });
}

function deleteOcc(occId) {
  const occ = occurrencesById[occId];
  expect(occ).toBeTruthy();
  const anc = ancestorChain(occId);
  // Mirror CommitHelpers.deleteOccurrence: evict FIRST (executor state must
  // exclude the deleted occurrence), then ONE OccurrenceDeleteOp carrying the
  // snapshot as trigger context (_occurrenceSnapshot) so gates like
  // `$trigger.occurrence.fields.<date> DATE_IN_PERIOD $goalPeriod` still pass.
  for (const p of Object.values(occurrencesById)) {
    if (p.occurrences?.includes(occId)) {
      occurrencesById[p.id] = { ...p, occurrences: p.occurrences.filter(x => x !== occId) };
    }
  }
  delete occurrencesById[occId];
  fire("OccurrenceDeleteOp", {
    type: "OccurrenceDeleteOp",
    occurrenceId: occId, instanceId: occ.moduleId,
    fields: Object.fromEntries(Object.entries(occ.fields || {}).map(([k, v]) => [k, v?.value])),
    _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    _occurrenceSnapshot: occ,
  });
}

beforeAll(() => {
  const ops = loadSeed("operations.json");
  const occs = loadSeed("occurrences.json");
  const mods = loadSeed("modules.json");
  const flds = loadSeed("fields.json");
  const grids = loadSeed("grids.json");
  grid = grids.find(g => g.name === "Live Grid") || grids[0];

  operations = ops.filter(o => o.enabled !== false);
  operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  fieldsById = Object.fromEntries(flds.map(f => [f.id, f]));
  fieldIdByName = {};
  for (const f of flds) if (!(f.name in fieldIdByName)) fieldIdByName[f.name] = f.id;
  modulesById = Object.fromEntries(mods.map(m => [m.id, m]));
  occurrencesById = Object.fromEntries(occs.map(o => [o.id, o]));

  // Replay the onLoad sweep (Build Schedule, goal minting, tracker baselines) —
  // same call bindSocketToStore makes on full_state.
  const updates = runMatchingOperations(operations, null, null, buildCtx());
  applyEffectsToLiveOccs(occurrencesById, updates);
}, 60000);

// ── The audit ──────────────────────────────────────────────────────────────

describe("onLoad sweep (seed sanity)", () => {
  it("builds today's schedule slots", () => {
    expect(scheduleSlotOcc("6:00am")).toBeTruthy();
    expect(scheduleSlotOcc("1:00am")).toBeTruthy();
  });
  it("mints the day's goal occurrences with baseline values", () => {
    expect(goalOcc("Completed")).toBeTruthy();
    expect(typeof goalValue("Completed", "Tasks Completed")).toBe("number");
    expect(typeof goalValue("Completed", "Tasks Left")).toBe("number");
  });
});

describe("drops (onAdd/onDelete) re-aggregate trackers — 2026-07-07 trigger fix", () => {
  let addedId;
  it("dropping an ALREADY-COMPLETED item into a slot bumps Tasks Completed on the DROP", () => {
    const before = goalValue("Completed", "Tasks Completed");
    const leftBefore = goalValue("Completed", "Tasks Left");
    addedId = addToSlot("Stretching", "1:00am", { Completed: true });
    expect(goalValue("Completed", "Tasks Completed")).toBe(before + 1);
    expect(goalValue("Completed", "Tasks Left")).toBe(leftBefore - 1);
  });
  it("the completed drop also starts the streak", () => {
    expect(goalValue("Streak", "Current Streak")).toBeGreaterThanOrEqual(1);
  });
  it("a completed NON-workout item does NOT count as a workout (presenceFieldId gate)", () => {
    // Stretching carries no Muscle Group value → the Total Workouts tracker
    // (countTrue gated on muscleGroup presence) must ignore it.
    expect(trackerValue("Total Workouts") || 0).toBe(0);
  });
  it("deleting the dropped item re-aggregates back down", () => {
    const before = goalValue("Completed", "Tasks Completed");
    deleteOcc(addedId);
    expect(goalValue("Completed", "Tasks Completed")).toBe(before - 1);
  });
});

describe("boolean input (Completed toggle)", () => {
  it("completing an incomplete slot item bumps Tasks Completed / drops Tasks Left", () => {
    const id = addToSlot("Stretching", "1:30am"); // incomplete
    const done = goalValue("Completed", "Tasks Completed");
    const left = goalValue("Completed", "Tasks Left");
    inputField(id, "Completed", true);
    expect(goalValue("Completed", "Tasks Completed")).toBe(done + 1);
    expect(goalValue("Completed", "Tasks Left")).toBe(left - 1);
  });
});

describe("number inputs", () => {
  // Trackers deliberately gate on Completed IS true (an incomplete task's
  // numbers are intent, not fact) — every input test completes its item.
  it("Steps on a COMPLETED schedule item lands in Daily Steps (incomplete = ignored)", () => {
    const id = addToSlot("Evening Run", "2:00am");
    inputField(id, "Steps", 4200);
    expect(goalValue("Steps", "Daily Steps") || 0).toBe(0); // not completed yet
    inputField(id, "Completed", true);
    expect(goalValue("Steps", "Daily Steps")).toBe(4200);
  });
  it("Water on completed schedule items sums into Daily Water", () => {
    const a = addToSlot("Drink Water", "2:30am", { Completed: true });
    inputField(a, "Water", 16);
    const afterFirst = goalValue("Water", "Daily Water");
    expect(afterFirst).toBeGreaterThanOrEqual(16);
    const b = addToSlot("Drink Water", "3:00am", { Completed: true });
    inputField(b, "Water", 8);
    expect(goalValue("Water", "Daily Water")).toBe(afterFirst + 8);
  });
  it("Pages on a completed schedule item lands in the reading Pages tracker", () => {
    const id = addToSlot("Spiritual Reading", "3:30am", { Completed: true });
    inputField(id, "Pages", 12);
    expect(goalValue("Pages Read", "Pages Read")).toBe(12);
  });
});

describe("duration input", () => {
  it("Duration on a completed schedule item lands in the Time Spent tracker", () => {
    const id = addToSlot("Stretching", "4:00am", { Completed: true });
    inputField(id, "Duration", 25);
    const landed = anyFieldValues("Time Spent").filter(v => typeof v === "number" && v >= 25);
    expect(landed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("select input (Mood)", () => {
  it("Mood select updates Last Mood + pushes into Moods history", () => {
    const id = addToSlot("Mood Check-in", "4:30am");
    inputField(id, "Mood", "focused");
    expect(goalValue("Mood", "Last Mood")).toContain("focused");
    const hist = goalValue("Mood", "Moods");
    expect(Array.isArray(hist)).toBe(true);
    expect(JSON.stringify(hist)).toContain("focused");
  });
});

describe("amount + flow input (money)", () => {
  it("Amount with flow=out on a completed, account-tagged Purchase lands in Spent", () => {
    const checking = goalOcc("Checking Account", "Checking Balance");
    expect(checking).toBeTruthy();
    const id = addToSlot("Purchase", "5:00am", { Completed: true, Account: checking.id });
    inputField(id, "Amount", 45, "out");
    expect(trackerValue("Spent")).toBe(45);
  });
  it("Income on a completed, account-tagged item lands in Earned", () => {
    const checking = goalOcc("Checking Account", "Checking Balance");
    const id = addToSlot("Check Investments", "5:30am", { Completed: true, Account: checking.id });
    inputField(id, "Income", 120);
    expect(trackerValue("Earned")).toBe(120);
  });
});

describe("workout inputs (reps + muscle group + presence-gated Workouts)", () => {
  it("Set reps on a COMPLETED chest workout land in Chest Volume + Total Reps", () => {
    // Volume/Reps gate on Completed (2026-07-10) — an uncompleted set is intent,
    // not fact. Completed items count under BOTH the current and gated ops, so
    // this stays green across a reseed (delta-based for the shared store).
    const beforeReps = goalValue("Reps", "Total Reps") || 0;
    const beforeVol = goalValue("Chest Volume", "Total Reps") || 0;
    const id = addToSlot("Bench Press", "6:30am", { "Muscle Group": "chest", Completed: true });
    inputField(id, "Set 1", 10);
    inputField(id, "Set 2", 8);
    expect(goalValue("Reps", "Total Reps")).toBe(beforeReps + 18);
    expect(goalValue("Chest Volume", "Total Reps")).toBe(beforeVol + 18);
  });
  it("completing the workout (muscleGroup present) NOW counts in Total Workouts", () => {
    const workoutOcc = Object.values(occurrencesById).find(o =>
      o.label === "Bench Press" && ancestorChain(o.id).labels.includes("Schedule"));
    expect(workoutOcc).toBeTruthy();
    inputField(workoutOcc.id, "Completed", true);
    expect(trackerValue("Total Workouts")).toBe(1);
  });
});

describe("nutrition inputs", () => {
  it("Protein on a completed meal lands in the Protein tracker", () => {
    const id = addToSlot("Protein Bar", "7:30am", { Completed: true, "Meal Type": "Snack" });
    inputField(id, "Protein", 21);
    expect(trackerValue("Protein")).toBe(21);
  });
});

describe("feed copies vs trackers (2026-07-08)", () => {
  it("a feed COPY sitting in a mirror page never counts (its source is already counted)", () => {
    // Simulate what feedSync mints: a copy-linked mirror of a completed task,
    // parented OUTSIDE Schedule (the mirror page), marked meta.feedSourceId.
    const src = addToSlot("Stretching", "8:30am", { Completed: true });
    const after = goalValue("Completed", "Tasks Completed");
    const copyId = uid();
    const srcOcc = occurrencesById[src];
    occurrencesById[copyId] = {
      id: copyId, moduleId: srcOcc.moduleId, parentId: null,
      fields: JSON.parse(JSON.stringify(srcOcc.fields)),
      meta: { feedSourceId: src }, occurrences: [],
      role: "instance", label: "Stretching",
    };
    const anc = ancestorChain(copyId);
    fire("MeasureOp", {
      type: "MeasureOp", occurrenceId: copyId, instanceId: srcOcc.moduleId,
      fields: { [fieldIdByName["Completed"]]: true },
      _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    });
    expect(goalValue("Completed", "Tasks Completed")).toBe(after); // unchanged
  });

  it("dragging OUT of a feed into the Schedule mints a CLEAN copy that counts", () => {
    // The drag-copy path (copyInstanceToContainer) copies FIELDS, not meta —
    // the new occurrence carries no feedSourceId, so trackers treat it like
    // any toolkit drop (user question 2026-07-08: "if I drag from there to a
    // schedule, will it still count" — yes).
    const before = goalValue("Completed", "Tasks Completed");
    const id = addToSlot("Take Vitamins", "9:00am", { Completed: true });
    expect(occurrencesById[id].meta?.feedSourceId).toBeUndefined();
    expect(goalValue("Completed", "Tasks Completed")).toBe(before + 1);
  });
});

describe("date-picker selections rebuild the Schedule (multi-day)", () => {
  it("a 3-day multi selection mints a day-column per selected date", () => {
    const buildOp = operations.find(o => o.name === "Schedule: Build Schedule");
    expect(buildOp).toBeTruthy();
    const schedPageId = buildOp.targetOccurrenceId;
    expect(occurrencesById[schedPageId]).toBeTruthy();

    const dayCols = () => Object.values(occurrencesById).filter(o => {
      const m = modulesById[o.moduleId];
      const label = o.label || m?.label || "";
      return label.startsWith("Schedule - ") && ancestorChain(o.id).ids.includes(schedPageId);
    });
    const before = dayCols().length;
    expect(before).toBeGreaterThanOrEqual(1); // today's column from the sweep

    // Pick today + 2 non-consecutive future days — the picker's kind:"multi"
    // shape (classifySelection output) written as the page's filterOverride,
    // exactly what NavPickerPopover commits through
    // CommitHelpers.updateOccurrenceFilterOverride.
    const mk = (offset) => {
      const dt = new Date(); dt.setDate(dt.getDate() + offset);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };
    const dates = [mk(0), mk(2), mk(5)];
    const dateFid = fieldIdByName["Date"];
    const selection = { kind: "multi", unit: "day", value: dates[0], dates };
    const page = occurrencesById[schedPageId];
    occurrencesById[schedPageId] = { ...page, filterOverride: { [dateFid]: selection } };

    const anc = ancestorChain(schedPageId);
    fire("NavigationOp", {
      type: "NavigationOp",
      sourceOccurrenceId: schedPageId,
      occurrenceId: schedPageId,
      fieldId: dateFid,
      date: dates[0],
      activeFilterValues: { [dateFid]: selection },
      _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    });

    const cols = dayCols();
    expect(cols.length).toBe(3);
    // ≤7 days → timeslot format: every day-column carries slot children.
    for (const col of cols) {
      expect((col.occurrences || []).length).toBeGreaterThan(0);
    }
  });
});

describe("feed copies never double-count (2026-07-09 audit — 'Total Reps 90' bug)", () => {
  // A feed (Schedule Table / Schedule Canvas) materializes copy-linked mirrors
  // of schedule items, marked meta.feedSourceId. The per-muscle Volume + per-meal
  // Nutrition custom pipelines lacked the feedSourceId guard (and any page scope),
  // so one 30-rep workout counted 3x (source + table copy + canvas copy) = 90.
  function addFeedCopyOf(srcId, parentLabel) {
    const src = occurrencesById[srcId];
    const parent = Object.values(occurrencesById).find(o => {
      const m = modulesById[o.moduleId];
      return m?.role === "page" && m?.label === parentLabel;
    });
    expect(parent, `page "${parentLabel}"`).toBeTruthy();
    const id = uid();
    occurrencesById[id] = {
      id, moduleId: src.moduleId, parentId: parent.id,
      fields: JSON.parse(JSON.stringify(src.fields || {})),
      occurrences: [], role: "instance", label: src.label,
      meta: { feedSourceId: srcId }, linkedGroupId: srcId,
    };
    const anc = ancestorChain(id);
    fire("OccurrenceCreateOp", {
      type: "OccurrenceCreateOp",
      occurrenceId: id, instanceId: src.moduleId,
      fields: Object.fromEntries(Object.entries(src.fields || {}).map(([k, v]) => [k, v?.value])),
      _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    });
    return id;
  }

  it("a scheduled chest workout counts ONCE in Chest Volume; its feed copies add nothing", () => {
    const before = trackerValue("Chest Volume") || 0;
    const totalBefore = trackerValue("Total Reps") || 0;
    const id = addToSlot("Bench Press", "5:00am", {
      "Set 1": 12, "Set 2": 10, "Set 3": 8, "Muscle Group": "chest", Completed: true,
    });
    expect(trackerValue("Chest Volume")).toBe(before + 30);
    expect(trackerValue("Total Reps")).toBe(totalBefore + 30);
    // Feed mirrors on the Table + Canvas pages — the exact 3x-count shape.
    addFeedCopyOf(id, "Schedule Table");
    addFeedCopyOf(id, "Schedule Canvas");
    expect(trackerValue("Chest Volume")).toBe(before + 30);
    expect(trackerValue("Total Reps")).toBe(totalBefore + 30);
  });

  it("a scheduled meal counts ONCE in its per-meal Nutrition tracker", () => {
    const before = trackerValue("Breakfast Nutrition") || 0;
    const id = addToSlot("Scrambled Eggs + Veg", "5:30am", {
      "Protein": 24, "Meal Type": "Breakfast", Completed: true,
    });
    expect(trackerValue("Breakfast Nutrition")).toBe(before + 24);
    addFeedCopyOf(id, "Schedule Table");
    expect(trackerValue("Breakfast Nutrition")).toBe(before + 24);
  });
});
