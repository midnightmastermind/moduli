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
import { describe, it, expect, beforeAll, vi } from "vitest";

// Integration-scale tests: each fire runs the FULL op suite over the real
// seed (~2500 occurrences), so multi-fire tests legitimately take seconds.
vi.setConfig({ testTimeout: 20000 });
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs, executePipeline } from "../helpers/operationExecutor";
import { resolveOptions } from "../helpers/optionsResolver";
import { buildAlarmOperation } from "../helpers/alarmOps";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/seed");
const loadSeed = (name) => JSON.parse(readFileSync(path.join(seedDir, name), "utf8"));

// ── Shared executor world ──────────────────────────────────────────────────
let operations, operationsById, fieldsById, fieldIdByName, displayFieldIdByName, modulesById, occurrencesById, grid;

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
    const fid = displayFieldIdByName[fieldName] ?? fieldIdByName[fieldName];
    const withField = all.find(o => o.fields && fid in o.fields);
    if (withField) return withField;
  }
  return all.find(o => Object.keys(o.fields || {}).length > 0) || all[0];
}
function goalValue(moduleLabel, fieldName) {
  const occ = goalOcc(moduleLabel, fieldName);
  // A goal tile holds the DISPLAY twin (trackers write outputs), so prefer it
  // when the label is shared with an input field.
  const fid = displayFieldIdByName[fieldName] ?? fieldIdByName[fieldName];
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

// Resolve a board OPTION occurrence by its module label (e.g. the "Bench
// Press" movement on the Movements board). Board options are the pick targets
// for the occurrence-dropdown fields the actions bind (2026-07-25 rebuild).
function boardOptionId(label) {
  // Match on the Board Category TAG, not just the label — several non-board
  // things share these labels (the "Water" goal tile is a module labeled
  // "Water" too, and picking it made the Water tracker's Beverage gate never
  // match). A board option is exactly: tagged, and not a feed copy.
  const tagFid = Object.values(fieldsById).find(f => f.name === "Board Category")?.id;
  expect(tagFid, "Board Category field").toBeTruthy();
  const occ = Object.values(occurrencesById).find(o => {
    if (o.meta?.feedSourceId) return false;
    if (!o.fields?.[tagFid]?.value) return false;
    return (o.label || modulesById[o.moduleId]?.label) === label;
  });
  expect(occ, `board option occurrence "${label}"`).toBeTruthy();
  return occ.id;
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
  // Field NAMES are labels and may repeat now (the per-meal "Protein" you type
  // and the day's total "Protein" the tracker writes). Assertions about a
  // tracker's OUTPUT need the display twin specifically.
  displayFieldIdByName = {};
  for (const f of flds) if (f.displayEnabled && !(f.name in displayFieldIdByName)) displayFieldIdByName[f.name] = f.id;
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
    // Both halves of the split now live in the Stats container (2026-07-30).
    expect(goalOcc("Completed Tasks")).toBeTruthy();
    expect(goalOcc("Completed Habits")).toBeTruthy();
    expect(typeof goalValue("Completed Tasks", "Tasks Completed")).toBe("number");
    expect(typeof goalValue("Completed Tasks", "Tasks Left")).toBe("number");
    expect(typeof goalValue("Completed Habits", "Habits Completed")).toBe("number");
  });
});

describe("the day's Daily Question is filled at BUILD time (2026-08-05)", () => {
  const QSIG = "daypage:Daily Question/question";
  let boardId, colIds, qFid;

  const buildToday = () => {
    const buildOp = operations.find(o => o.name === "Day Page: Build");
    expect(buildOp).toBeTruthy();
    boardId = buildOp.targetOccurrenceId;
    qFid = fieldIdByName["Daily Question"];
    const dateFid = fieldIdByName["Date"];
    const today = todayIso();
    const selection = { kind: "day", unit: "day", value: today, dates: [today] };
    occurrencesById[boardId] = { ...occurrencesById[boardId], filterOverride: { [dateFid]: selection } };
    const anc = ancestorChain(boardId);
    fire("NavigationOp", {
      type: "NavigationOp",
      sourceOccurrenceId: boardId, occurrenceId: boardId,
      fieldId: dateFid, date: today,
      activeFilterValues: { [dateFid]: selection },
      _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    });
    // The day COLUMN's question container — not the template's (which carries
    // the same signature, being what the clones are matched against).
    colIds = Object.values(occurrencesById)
      .filter(o => o.identitySignature === QSIG && ancestorChain(o.id).ids.includes(boardId))
      .map(o => o.id);
  };

  it("building a day mints its question container and fills it", () => {
    buildToday();
    expect(colIds.length).toBeGreaterThan(0);
    for (const id of colIds) {
      const v = occurrencesById[id].fields?.[qFid]?.value;
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("the question came from the reflection-question pool, not an arbitrary string", () => {
    const libFid = fieldIdByName["Library"];
    const pool = new Set(Object.values(occurrencesById)
      .filter(o => o.fields?.[libFid]?.value === "question")
      .map(o => o.label ?? modulesById[o.moduleId]?.label)
      .filter(Boolean));
    expect(pool.size).toBeGreaterThan(1);
    for (const id of colIds) {
      expect(pool.has(occurrencesById[id].fields[qFid].value)).toBe(true);
    }
  });

  it("a second build does NOT reshuffle it — the day keeps the question its answer belongs to", () => {
    const before = colIds.map(id => [id, occurrencesById[id].fields[qFid].value]);
    buildToday();
    for (const [id, value] of before) {
      expect(occurrencesById[id].fields[qFid].value).toBe(value);
    }
  });
});

describe("drops (onAdd/onDelete) re-aggregate trackers — 2026-07-07 trigger fix", () => {
  let addedId;
  // Stretch is a ROUTINE, so completing it moves Completed HABITS and must
  // leave Completed Tasks alone (user 2026-07-30: routines like sleep must not
  // inflate the task count). The discriminator is the hidden Habit binding.
  it("dropping an ALREADY-COMPLETED routine into a slot bumps Completed Habits on the DROP", () => {
    const before = goalValue("Completed Habits", "Habits Completed");
    const tasksBefore = goalValue("Completed Tasks", "Tasks Completed");
    addedId = addToSlot("Stretch", "1:00am", { Completed: true });
    expect(goalValue("Completed Habits", "Habits Completed")).toBe(before + 1);
    expect(goalValue("Completed Tasks", "Tasks Completed")).toBe(tasksBefore);
  });
  it("the completed drop also starts the streak", () => {
    expect(goalValue("Streak", "Current Streak")).toBeGreaterThanOrEqual(1);
  });
  it("a completed NON-workout item does NOT count as a workout (presenceFieldId gate)", () => {
    // Stretch carries no Movement pick → the Total Workouts tracker
    // (countTrue gated on Movement presence) must ignore it.
    expect(trackerValue("Total Workouts") || 0).toBe(0);
  });
  it("deleting the dropped item re-aggregates back down", () => {
    const before = goalValue("Completed Habits", "Habits Completed");
    deleteOcc(addedId);
    expect(goalValue("Completed Habits", "Habits Completed")).toBe(before - 1);
  });
});

describe("boolean input (Completed toggle)", () => {
  it("completing an incomplete routine bumps Completed Habits", () => {
    const id = addToSlot("Stretch", "1:30am"); // incomplete
    const done = goalValue("Completed Habits", "Habits Completed");
    const tasks = goalValue("Completed Tasks", "Tasks Completed");
    inputField(id, "Completed", true);
    expect(goalValue("Completed Habits", "Habits Completed")).toBe(done + 1);
    expect(goalValue("Completed Tasks", "Tasks Completed")).toBe(tasks);
  });
});

describe("number inputs", () => {
  // Trackers deliberately gate on Completed IS true (an incomplete task's
  // numbers are intent, not fact) — every input test completes its item.
  it("Steps on a COMPLETED schedule item lands in Daily Steps (incomplete = ignored)", () => {
    const id = addToSlot("Run", "2:00am");
    inputField(id, "Steps", 4200);
    expect(goalValue("Steps", "Daily Steps") || 0).toBe(0); // not completed yet
    inputField(id, "Completed", true);
    expect(goalValue("Steps", "Daily Steps")).toBe(4200);
  });
  it("Liquid Amount on completed Drinks sums into Daily Water — ONLY when the Beverage is Water", () => {
    // 2026-07-25: the input field is "Liquid Amount" (Drink logs any
    // beverage) and the Water tracker gates on the Beverage pick, so a
    // coffee's ounces never move the water goal.
    const waterOpt = boardOptionId("Water");
    const a = addToSlot("Drink", "2:30am", { Completed: true, Beverage: waterOpt });
    inputField(a, "Liquid Amount", 16);
    const afterFirst = goalValue("Water", "Daily Water");
    expect(afterFirst).toBeGreaterThanOrEqual(16);
    const b = addToSlot("Drink", "3:00am", { Completed: true, Beverage: waterOpt });
    inputField(b, "Liquid Amount", 8);
    expect(goalValue("Water", "Daily Water")).toBe(afterFirst + 8);

    // A non-water drink logs its ounces but does NOT count toward the goal.
    const coffee = addToSlot("Drink", "3:30am", { Completed: true, Beverage: boardOptionId("Coffee") });
    inputField(coffee, "Liquid Amount", 12);
    expect(goalValue("Water", "Daily Water")).toBe(afterFirst + 8);
  });
  it("Pages on a completed schedule item lands in the reading Pages tracker", () => {
    const id = addToSlot("Read Scripture", "3:30am", { Completed: true });
    inputField(id, "Pages", 12);
    expect(goalValue("Pages Read", "Pages Read")).toBe(12);
  });
});

describe("duration input", () => {
  it("Duration on a completed schedule item lands in the Time Spent tracker", () => {
    const id = addToSlot("Stretch", "4:00am", { Completed: true });
    inputField(id, "Duration", 25);
    const landed = anyFieldValues("Time Spent").filter(v => typeof v === "number" && v >= 25);
    expect(landed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("select input (Mood)", () => {
  it("Mood select updates Last Mood + pushes into Moods history", () => {
    const id = addToSlot("Check In", "4:30am", { Completed: true });
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
    const id = addToSlot("Buy", "5:00am", { Completed: true, Account: checking.id });
    inputField(id, "Amount", 45, "out");
    expect(trackerValue("Spent")).toBe(45);
  });
  it("Income on a completed, account-tagged item lands in Earned", () => {
    const checking = goalOcc("Checking Account", "Checking Balance");
    const id = addToSlot("Earn", "5:30am", { Completed: true, Account: checking.id });
    inputField(id, "Income", 120);
    expect(trackerValue("Earned")).toBe(120);
  });
  it("Set Account Balance (flow=replace) RESETS Checking; same-day transactions stack on top", () => {
    // 2026-07-11 supportsReplace: the latest completed in-Schedule item whose
    // amount carries flow:"replace" becomes the balance BASE; only non-replace
    // transactions dated on/after it add on top. Everything this block added
    // earlier is same-day, so post-reset balance = base + prior net.
    const checking = goalOcc("Checking Account", "Checking Balance");
    const before = trackerValue("Checking Balance") || 0;
    const id = addToSlot("Track", "6:00am", { Completed: true, Account: checking.id });
    inputField(id, "Amount", 500, "replace");
    expect(trackerValue("Checking Balance")).toBe(500 + before);
    // The replace entry itself never lands in the flow=out Spent tracker.
    expect(trackerValue("Spent")).toBe(45);
  });
});

describe("workout inputs (reps + Movement pick + presence-gated Workouts)", () => {
  // 2026-07-25: a workout is an EXERCISE action carrying a Movement pick; the
  // muscle group lives on the picked movement OPTION, so the volume trackers
  // resolve the pick and read ITS Muscle Group.
  let exerciseId;
  it("Set reps on a COMPLETED Exercise with a chest Movement land in Chest Volume + Total Reps", () => {
    // Volume/Reps gate on Completed (2026-07-10) — an uncompleted set is intent,
    // not fact (delta-based for the shared store).
    const beforeReps = goalValue("Reps", "Total Reps") || 0;
    const beforeVol = goalValue("Chest Volume", "Total Reps") || 0;
    exerciseId = addToSlot("Exercise", "6:30am", {
      Movement: [boardOptionId("Bench Press")], Completed: true,
    });
    inputField(exerciseId, "Set 1", 10);
    inputField(exerciseId, "Set 2", 8);
    expect(goalValue("Reps", "Total Reps")).toBe(beforeReps + 18);
    expect(goalValue("Chest Volume", "Total Reps")).toBe(beforeVol + 18);
  });
  it("completing the Exercise (Movement present) NOW counts in Total Workouts", () => {
    inputField(exerciseId, "Completed", true);
    expect(trackerValue("Total Workouts")).toBe(1);
  });
});

describe("nutrition inputs", () => {
  // 2026-07-29: the three per-macro trackers (Protein/Carbs/Fats) and their
  // standalone tiles were removed — Meal Nutrition already summed all four
  // macros onto one tile, so they were a second tile for the same fields.
  it("macros on a completed meal land on the Meal Nutrition tile", () => {
    const id = addToSlot("Eat", "7:30am", { Completed: true });
    inputField(id, "Protein", 21);
    inputField(id, "Carbs", 40);
    inputField(id, "Fats", 9);
    expect(goalValue("Meal Nutrition", "Protein")).toBe(21);
    expect(goalValue("Meal Nutrition", "Carbs")).toBe(40);
    expect(goalValue("Meal Nutrition", "Fats")).toBe(9);
  });
});

describe("feed copies vs trackers (2026-07-08)", () => {
  it("a feed COPY sitting in a mirror page never counts (its source is already counted)", () => {
    // Simulate what feedSync mints: a copy-linked mirror of a completed task,
    // parented OUTSIDE Schedule (the mirror page), marked meta.feedSourceId.
    const src = addToSlot("Stretch", "8:30am", { Completed: true });
    const after = goalValue("Completed Habits", "Habits Completed");
    const copyId = uid();
    const srcOcc = occurrencesById[src];
    occurrencesById[copyId] = {
      id: copyId, moduleId: srcOcc.moduleId, parentId: null,
      fields: JSON.parse(JSON.stringify(srcOcc.fields)),
      meta: { feedSourceId: src }, occurrences: [],
      role: "instance", label: "Stretch",
    };
    const anc = ancestorChain(copyId);
    fire("MeasureOp", {
      type: "MeasureOp", occurrenceId: copyId, instanceId: srcOcc.moduleId,
      fields: { [fieldIdByName["Completed"]]: true },
      _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    });
    expect(goalValue("Completed Habits", "Habits Completed")).toBe(after); // unchanged
  });

  it("dragging OUT of a feed into the Schedule mints a CLEAN copy that counts", () => {
    // The drag-copy path (copyInstanceToContainer) copies FIELDS, not meta —
    // the new occurrence carries no feedSourceId, so trackers treat it like
    // any toolkit drop (user question 2026-07-08: "if I drag from there to a
    // schedule, will it still count" — yes).
    const before = goalValue("Completed Habits", "Habits Completed");
    const id = addToSlot("Recover", "9:00am", { Completed: true });
    expect(occurrencesById[id].meta?.feedSourceId).toBeUndefined();
    expect(goalValue("Completed Habits", "Habits Completed")).toBe(before + 1);
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
    const id = addToSlot("Exercise", "5:00am", {
      "Set 1": 12, "Set 2": 10, "Set 3": 8,
      Movement: [boardOptionId("Bench Press")], Completed: true,
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
    const before = trackerValue("Meal Nutrition") || 0;
    const id = addToSlot("Eat", "5:30am", {
      "Protein": 24, Completed: true,
    });
    expect(trackerValue("Meal Nutrition")).toBe(before + 24);
    addFeedCopyOf(id, "Schedule Table");
    expect(trackerValue("Meal Nutrition")).toBe(before + 24);
  });

  it("per-meal Nutrition carries ALL FOUR macros, not just protein (2026-07-14)", () => {
    // Read the op's OWN write targets — "Calories"/"Protein"/"Carbs"/"Fats"
    // each name BOTH an input field and a display field, so fieldIdByName is
    // ambiguous here. The op writes [protein, calories, carbs, fats] in order.
    const op = operations.find(o => o.name === "Meal Nutrition");
    const targets = [...JSON.stringify(op.pipeline)
      .matchAll(/\$goalItem\.fields\.([A-Za-z0-9_-]+)\.value/g)].map(m => m[1]);
    expect(targets.length).toBe(4);
    const [pFid, calFid, carbFid, fatFid] = targets;
    const goalId = JSON.stringify(op.pipeline).match(/\$allItemsById\.([A-Za-z0-9_-]+)/)?.[1];
    const before = occurrencesById[goalId]?.fields || {};
    const b = (fid) => before[fid]?.value || 0;
    const [pB, calB, carbB, fatB] = [b(pFid), b(calFid), b(carbFid), b(fatFid)];
    addToSlot("Eat", "4:30am", {
      Completed: true,
      "Calories": 320, "Protein": 11, "Carbs": 58, "Fats": 6,
    });
    const after = occurrencesById[goalId].fields;
    expect(after[pFid]?.value).toBe(pB + 11);
    expect(after[calFid]?.value).toBe(calB + 320);
    expect(after[carbFid]?.value).toBe(carbB + 58);
    expect(after[fatFid]?.value).toBe(fatB + 6);
  });
});

describe("Workout History fills for exercise instances (2026-07-14 muscleGroup gate)", () => {
  it("a completed exercise with a Muscle Group lands as a history row", () => {
    // The tracker used to gate its loop on workoutType — a field exercise
    // instances never carry (only the generic "Morning Workout" task binds
    // it) — so the Exercise/Reps/Wt history stayed empty forever. The gate
    // is muscleGroup now. Completed Bench Press rows exist from the earlier
    // describes; the history must reflect them.
    const rows = trackerValue("Workout History");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
  it("rows carry ALL THREE set counts (2026-07-14: 'only showing 1 of the rep counts')", () => {
    const rows = trackerValue("Workout History");
    // The feed-copy describe logged a Bench Press with Set 1/2/3 = 12/10/8.
    const full = rows.find(r => r.s1 === 12 && r.s2 === 10 && r.s3 === 8);
    expect(full, "row with s1/s2/s3 = 12/10/8").toBeTruthy();
    for (const r of rows) {
      expect("s1" in r && "s2" in r && "s3" in r).toBe(true);
      expect("w1" in r && "w2" in r && "w3" in r).toBe(true); // per-set weights (2026-07-14)
      expect("reps" in r).toBe(false); // old single-count key is gone
    }
  });
});

describe("Pomodoro: Start targets TODAY's slot only (2026-07-14 stale-slot orphan)", () => {
  // Prod repro: started at 12:02am, the label-only slot FIND matched the
  // PREVIOUS day's "12:00am" slot copy — the session was created invisible
  // (wrong day-col's date cascade) and orphaned when the new-day rebuild
  // swept that slot. The FIND is now scoped to the day-col whose date is
  // $today; a slot that only exists under another day must never match.
  const fmtName = "Schedule Format";

  function todaysDayCol() {
    const fmtFid = fieldIdByName[fmtName];
    const dateFid = fieldIdByName["Date"];
    return Object.values(occurrencesById).find(o =>
      o.fields?.[fmtFid]?.value === "day-col" &&
      o.fields?.[dateFid]?.value === todayIso() &&
      ancestorChain(o.id).labels.includes("Schedule"));
  }

  let sessionId;
  it("fires like the timer and creates the session under TODAY's day-col", () => {
    const dayCol = todaysDayCol();
    expect(dayCol, "today's day-col").toBeTruthy();
    const before = new Set(Object.keys(occurrencesById));
    // The timer sends minutes: 0 at start — the session's time is its
    // RUNNING time (2026-07-14), kept current by PomoTickOp below.
    fire("PomoStartOp", {
      type: "PomoStartOp", slotLabel: "6:00am", minutes: 0,
      pomoNumber: 1, phase: "work", targetContainerId: null,
    });
    const pomoNumFid = fieldIdByName["Pomodoro #"];
    const session = Object.keys(occurrencesById).filter(id => !before.has(id))
      .map(id => occurrencesById[id]).find(o => o.fields?.[pomoNumFid]);
    expect(session, "pomodoro session").toBeTruthy();
    sessionId = session.id;
    // The parent slot must sit inside TODAY's day-col — not just anywhere
    // under Schedule.
    expect(ancestorChain(session.id).ids).toContain(dayCol.id);
    expect(occurrencesById[session.parentId], "parent slot exists").toBeTruthy();
    const minFid = fieldIdByName["Pomodoro Minutes"];
    expect(occurrencesById[sessionId].fields?.[minFid]?.value).toBe(0);
  });

  it("PomoTickOp (each running minute / pause) writes elapsed minutes onto the open session", () => {
    fire("PomoTickOp", { type: "PomoTickOp", minutes: 7 });
    const minFid = fieldIdByName["Pomodoro Minutes"];
    expect(occurrencesById[sessionId].fields?.[minFid]?.value).toBe(7);
  });

  it("natural timeout (PomoCompleteOp) settles minutes at the full phase length + completes", () => {
    fire("PomoCompleteOp", { type: "PomoCompleteOp", minutes: 25 });
    const minFid = fieldIdByName["Pomodoro Minutes"];
    const doneFid = fieldIdByName["Completed"];
    expect(occurrencesById[sessionId].fields?.[minFid]?.value).toBe(25);
    expect(occurrencesById[sessionId].fields?.[doneFid]?.value).toBe(true);
  });

  it("completing EARLY keeps the ticked (shorter) time — a second session, ticked to 12, completed by checkbox", () => {
    fire("PomoStartOp", {
      type: "PomoStartOp", slotLabel: "6:00am", minutes: 0,
      pomoNumber: 2, phase: "work", targetContainerId: null,
    });
    const pomoNumFid = fieldIdByName["Pomodoro #"];
    const minFid = fieldIdByName["Pomodoro Minutes"];
    const open = Object.values(occurrencesById).find(o =>
      o.fields?.[pomoNumFid]?.value === 2 && o.fields?.[fieldIdByName["Completed"]]?.value !== true);
    expect(open, "second session (multiple pomodoros share the slot)").toBeTruthy();
    fire("PomoTickOp", { type: "PomoTickOp", minutes: 12 });
    expect(occurrencesById[open.id].fields?.[minFid]?.value).toBe(12);
    // Early completion = the user checks Completed on the occurrence.
    inputField(open.id, "Completed", true);
    expect(occurrencesById[open.id].fields?.[minFid]?.value).toBe(12); // shorter pomodoro kept
  });

  it("a slot that only exists under a STALE day-col never matches (op no-ops)", () => {
    // A leftover yesterday day-col with a slot whose label today's day-col
    // does NOT have. The old label-only FIND would have created the session
    // there; the day-scoped FIND must no-op instead.
    const fmtFid = fieldIdByName[fmtName];
    const dateFid = fieldIdByName["Date"];
    const tsFid = fieldIdByName["Time Slot"];
    const schedPage = Object.values(occurrencesById).find(o =>
      (modulesById[o.moduleId]?.role === "page") &&
      (o.label || modulesById[o.moduleId]?.label) === "Schedule");
    expect(schedPage).toBeTruthy();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    const staleColId = uid(), staleSlotId = uid();
    occurrencesById[staleColId] = {
      id: staleColId, moduleId: null, parentId: schedPage.id, role: "container",
      fields: { [fmtFid]: { value: "day-col" }, [dateFid]: { value: yIso } },
      occurrences: [staleSlotId], label: `day-col-${yIso}`,
    };
    occurrencesById[staleSlotId] = {
      id: staleSlotId, moduleId: null, parentId: staleColId, role: "container",
      fields: { [fmtFid]: { value: "slot" }, [tsFid]: { value: "13:37zz" } },
      occurrences: [], label: "13:37zz",
    };
    occurrencesById[schedPage.id] = {
      ...schedPage, occurrences: [...(schedPage.occurrences || []), staleColId],
    };
    const before = new Set(Object.keys(occurrencesById));
    fire("PomoStartOp", {
      type: "PomoStartOp", slotLabel: "13:37zz", minutes: 25,
      pomoNumber: 2, phase: "work", targetContainerId: null,
    });
    const pomoNumFid = fieldIdByName["Pomodoro #"];
    const created = Object.keys(occurrencesById).filter(id => !before.has(id))
      .map(id => occurrencesById[id]).filter(o => o.fields?.[pomoNumFid]);
    expect(created).toEqual([]); // never into the stale day's slot
  });
});

describe("Alarm op drops an instance onto today's Schedule (2026-07-20 alarm→schedule)", () => {
  // A fired alarm/reminder resolves today's day-col, targets the slot matching
  // its timeslot (else the day-col), and creates ONE instance/day — matching +
  // de-duping on the TIME SLOT field, stamped on the created instance. Fires
  // via executePipeline (the useScheduler path), not a transaction trigger.
  // The destination page is addressed by ID (the builder resolves it with a
  // FIND on `id`, never on the name) — the seed stamps this on
  // grid.meta.scheduleFieldIds; here we look it up in the fixture.
  const schedulePageOccId = () => {
    for (const occ of Object.values(occurrencesById)) {
      const mod = modulesById[occ.moduleId || occ.targetId];
      if (mod?.role === "page" && mod.label === "Schedule") return occ.id;
    }
    return null;
  };
  const sched = () => ({
    dateFieldId: fieldIdByName["Date"],
    timeslotFieldId: fieldIdByName["Time Slot"],
    scheduleFormatFieldId: fieldIdByName["Schedule Format"],
    pageOccurrenceId: schedulePageOccId(),
  });
  const runAlarm = (op) => {
    const updates = executePipeline(op, buildCtx(), {
      type: "ScheduleTick", scheduleId: op.id, at: new Date().toISOString(),
    });
    applyEffectsToLiveOccs(occurrencesById, updates);
    return updates;
  };

  it("creates the alarm instance in TODAY's 5:00pm slot, timeslot field stamped", () => {
    const op = buildAlarmOperation({ gridId: grid?._id, type: "alarm", label: "5 PM", time: "17:00", sched: sched() });
    const slot = scheduleSlotOcc("5:00pm");
    expect(slot, "today's 5:00pm slot").toBeTruthy();
    const before = new Set(Object.keys(occurrencesById));
    runAlarm(op);
    const created = [...Object.keys(occurrencesById)].filter((id) => !before.has(id))
      .map((id) => occurrencesById[id]);
    const inst = created.find((o) => o.label === "⏰ 5 PM");
    expect(inst, "alarm instance").toBeTruthy();
    // Landed inside the 5:00pm slot, timeslot field carries the slot label.
    expect(inst.parentId).toBe(slot.id);
    expect(inst.fields?.[fieldIdByName["Time Slot"]]?.value).toBe("5:00pm");
    expect(inst.fields?.[fieldIdByName["Date"]]?.value).toBe(todayIso());
  });

  it("is idempotent — firing again the same day creates nothing (dedup on timeslot)", () => {
    const op = buildAlarmOperation({ gridId: grid?._id, type: "alarm", label: "5 PM", time: "17:00", sched: sched() });
    const before = new Set(Object.keys(occurrencesById));
    runAlarm(op);
    const created = [...Object.keys(occurrencesById)].filter((id) => !before.has(id));
    expect(created).toEqual([]);
  });

  it("without sched, the pipeline is a plain NOTIFY (no schedule write)", () => {
    const op = buildAlarmOperation({ gridId: grid?._id, type: "reminder", label: "Bare", time: "17:00" });
    expect(op.pipeline.steps).toHaveLength(1);
    const before = new Set(Object.keys(occurrencesById));
    runAlarm(op);
    expect([...Object.keys(occurrencesById)].filter((id) => !before.has(id))).toEqual([]);
  });
});

// ── Option boards (2026-07-25 nine-dimensions rebuild) ─────────────────────
// The boards are the pick-source for every action dropdown: options carry a
// Board Category tag, and each dropdown's find predicate matches on that tag
// (excluding feed copies, which carry the same tag as their source).
describe("board dropdowns resolve their options from the tagged boards", () => {
  // Mirrors helpers/optionsResolver's find-mode evaluation over $allInstances.
  // Calls the REAL resolver rather than re-implementing its matching. The
  // previous version mirrored it by hand and went stale the moment Board
  // Category became multi-value (it compared a Set against an array and
  // silently matched nothing).
  function resolveBoardOptions(fieldName) {
    const field = Object.values(fieldsById).find(f => f.name === fieldName);
    expect(field, `field "${fieldName}"`).toBeTruthy();
    const cfg = field.meta?.optionsSource?.find || field.meta?.optionsSource;
    expect(cfg?.mode === "find" || cfg?.over, `"${fieldName}" is a find-mode source`).toBeTruthy();
    const { options } = resolveOptions(field, { occurrencesById, modulesById, fieldsById, foldersById: {} });
    return options.map(o => occurrencesById[o.value]).filter(Boolean);
  }

  it("Beverage lists the Beverages board's options (and nothing else)", () => {
    const opts = resolveBoardOptions("Beverage");
    const labels = opts.map(o => o.label || modulesById[o.moduleId]?.label);
    expect(labels).toContain("Water");
    expect(labels).toContain("Green Tea");
    expect(labels).not.toContain("Bench Press"); // a movement, different tag
  });

  it("a MULTI-board dropdown (Purchase Item) unions every board it queries", () => {
    const labels = resolveBoardOptions("Purchase Item")
      .map(o => o.label || modulesById[o.moduleId]?.label);
    expect(labels).toContain("Milk");            // Grocery List
    expect(labels).toContain("Standing Desk");   // Wish List
    expect(labels).toContain("Chicken Breast");  // Ingredients
  });

  it("every board dropdown can mint new options (addNew is wired on all of them)", () => {
    const tagFid = Object.values(fieldsById).find(f => f.name === "Board Category")?.id;
    expect(tagFid).toBeTruthy();
    const boardFields = Object.values(fieldsById).filter(f =>
      f.type === "occurrence" && JSON.stringify(f.meta?.optionsSource || {}).includes(tagFid));
    expect(boardFields.length).toBeGreaterThan(20);
    for (const f of boardFields) {
      const addNew = f.meta?.optionsSource?.addNew;
      const targets = addNew?.targets?.length ? addNew.targets
        : (addNew?.parentOccurrenceId ? [addNew.parentOccurrenceId] : []);
      expect(targets.length, `addNew targets for "${f.name}"`).toBeGreaterThan(0);
      // Every target resolves to a real container occurrence carrying its own
      // tag — what the add flow stamps onto the new option at run time.
      for (const t of targets) {
        const occ = occurrencesById[t];
        expect(occ, `addNew target ${t} of "${f.name}"`).toBeTruthy();
        expect(occ.fields?.[tagFid]?.value, `tag on "${f.name}" target`).toBeTruthy();
      }
    }
  });
});

describe("an action's board pick lands in its tracker rows", () => {
  it("Call with a People pick fills a Phone Calls row carrying the person's name", () => {
    const person = Object.values(occurrencesById).find(o =>
      modulesById[o.moduleId]?.label === "Ava Martinez");
    expect(person, "Ava Martinez person occurrence").toBeTruthy();
    const id = addToSlot("Call", "7:00am", { Completed: true, People: [person.id] });
    expect(occurrencesById[id]).toBeTruthy();
    const rows = trackerValue("Phone Calls");
    expect(Array.isArray(rows)).toBe(true);
    expect(JSON.stringify(rows)).toContain("Ava Martinez");
  });

  it("Exercise with a Movement pick names the MOVEMENT in the Workout History row", () => {
    // The row label resolves the picked movement occurrence — not the action's
    // own label ("Exercise"), which would read identically for every workout.
    const rows = trackerValue("Workout History");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some(r => r.label === "Bench Press")).toBe(true);
    expect(rows.some(r => r.label === "Exercise")).toBe(false);
  });
});

describe("Grid: Snap Filter To Today (first load of the day)", () => {
  // The date a page carries is persisted in its own filterOverride, and the
  // full_state bootstrap never overwrites an explicit value — so without this op
  // the grid still shows yesterday when you open it the next morning.
  const snapOp = () => operations.find(o => o.name === "Grid: Snap Filter To Today");
  const marker = () => Object.values(occurrencesById)
    .find(o => o.fields && lastOpenedFieldId() in (o.fields || {}))
    || Object.values(occurrencesById).find(o => modulesById[o.moduleId]?.label === "Last Opened");
  const lastOpenedFieldId = () => fieldIdByName["Last Opened Date"];
  const dateFieldId = () => fieldIdByName["Date"];
  const runSnap = () => {
    const updates = executePipeline(snapOp(), buildCtx(), { type: "OnLoadOp" });
    applyEffectsToLiveOccs(occurrencesById, updates);
    return updates;
  };
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("is seeded, onLoad-only, and runs before the trackers", () => {
    const op = snapOp();
    expect(op, "Grid: Snap Filter To Today").toBeTruthy();
    expect(op.triggerTypes).toEqual(["onLoad"]);
    // The executor sorts on the TRIGGER's priority (op.priority is not in the
    // Operation schema — Mongoose strips it, so every seeded op exports null).
    // 0 puts this ahead of the trackers, which must aggregate against the date
    // this op just moved.
    expect(op.triggerObjects[0].priority).toBe(0);
  });

  it("moves a stale page date to today and stamps the marker", () => {
    const m = marker();
    expect(m, "Last Opened marker").toBeTruthy();
    m.fields = { ...(m.fields || {}), [lastOpenedFieldId()]: { value: "2020-01-01", flow: "in" } };

    // A page carrying a stale date of its own.
    const page = Object.values(occurrencesById).find(o =>
      modulesById[o.moduleId]?.role === "page" && o.filterOverride && dateFieldId() in o.filterOverride);
    const target = page || (() => {
      const p = Object.values(occurrencesById).find(o => modulesById[o.moduleId]?.role === "page");
      p.filterOverride = { ...(p.filterOverride || {}), [dateFieldId()]: "2020-01-01" };
      return p;
    })();
    target.filterOverride = { ...(target.filterOverride || {}), [dateFieldId()]: "2020-01-01" };

    const updates = runSnap();
    const overrideWrite = updates.find(u =>
      u._effect === "UPDATE_ITEM_FILTER_OVERRIDE" && u.itemId === target.id);
    expect(overrideWrite, "filterOverride write for the stale page").toBeTruthy();
    expect(overrideWrite.value).toBe(localToday());

    const stamp = updates.find(u => u._effect === "UPDATE_ITEM_FIELD" && u.fieldId === lastOpenedFieldId());
    expect(stamp, "marker stamp").toBeTruthy();
    expect(stamp.value).toBe(localToday());
  });

  it("does nothing at all when it already ran today", () => {
    const m = marker();
    m.fields = { ...(m.fields || {}), [lastOpenedFieldId()]: { value: localToday(), flow: "in" } };
    const updates = runSnap();
    expect(updates.filter(u => u._effect === "UPDATE_ITEM_FILTER_OVERRIDE")).toHaveLength(0);
    expect(updates.filter(u => u._effect === "UPDATE_ITEM_FIELD" && u.fieldId === lastOpenedFieldId())).toHaveLength(0);
  });
});

// ── Schedule: Stamp Date & Time Slot — the slot GATE ────────────────────────
// User 2026-07-29: "in workouts, time is set to schedule canvas and not a time
// right now." Time Slot is a select of the 48 generated slot labels, but the op
// wrote the destination CONTAINER'S LABEL unconditionally — so anything created
// under the hub panel that isn't a slot stamped a page/container NAME as the
// "time" (live grid held "Schedule Canvas" ×6, "Due" ×2, "No timeslot" ×2), and
// every history row reading the field showed it.
describe("Schedule: Stamp Date & Time Slot — only stamps a REAL timeslot", () => {
  const stampOp = () => Object.values(operationsById).find(o => o.name === "Schedule: Stamp Date & Time Slot");
  const tsFieldId = () => fieldIdByName["Time Slot"];
  const sfFieldId = () => fieldIdByName["Schedule Format"];

  // Fire the create the way bindSocketToStore actually does: containerId is the
  // destination's OCCURRENCE id (occurrence.parentId), and panelId is the hub
  // panel module the op's trigger is scoped to.
  function createUnder(containerOcc) {
    const hubPanelModuleId = stampOp().triggerObjects[0].targetId;
    const mod = moduleByLabel("Exercise", "instance");
    const id = uid();
    occurrencesById[id] = {
      id, moduleId: mod.id, parentId: containerOcc.id, fields: {},
      occurrences: [], role: "instance", label: mod.label,
    };
    occurrencesById[containerOcc.id] = {
      ...containerOcc, occurrences: [...(containerOcc.occurrences || []), id],
    };
    const anc = ancestorChain(id);
    const label = containerOcc.label
      || modulesById[containerOcc.moduleId]?.label
      || "";
    fire("OccurrenceCreateOp", {
      type: "OccurrenceCreateOp",
      occurrenceId: id, instanceId: mod.id,
      containerId: containerOcc.id, containerLabel: label, panelId: hubPanelModuleId,
      fields: {}, _ancestorIds: anc.ids, _ancestorLabels: anc.labels,
    });
    return occurrencesById[id];
  }

  it("the op is gated on Schedule Format, not on the container's name", () => {
    expect(JSON.stringify(stampOp().pipeline)).toContain(sfFieldId());
  });

  it("creating in a real slot DOES stamp that slot's time", () => {
    const slot = scheduleSlotOcc("6:00am");
    expect(slot, "6:00am slot").toBeTruthy();
    expect(slot.fields?.[sfFieldId()]?.value).toBe("slot");
    const made = createUnder(slot);
    expect(made.fields?.[tsFieldId()]?.value).toBe("6:00am");
  });

  it("creating in a NON-slot container under the hub panel stamps NOTHING", () => {
    // Any container/page under the Schedule that is not a slot — this is the
    // class that produced "Schedule Canvas" / "Due" / "No timeslot".
    const nonSlot = Object.values(occurrencesById).find((o) => {
      if (!o || o.fields?.[sfFieldId()]?.value === "slot") return false;
      const label = o.label || modulesById[o.moduleId]?.label || "";
      if (!/^(Due|No timeslot|Schedule Canvas|Schedule Table)$/i.test(label)) return false;
      return ancestorChain(o.id).labels.includes("Schedule") || /^Schedule /i.test(label);
    });
    expect(nonSlot, "a non-slot container under the Schedule").toBeTruthy();
    const made = createUnder(nonSlot);
    const written = made.fields?.[tsFieldId()]?.value ?? null;
    expect(written).toBeNull();
    // The regression this locks: it must never be the container's own name.
    const label = nonSlot.label || modulesById[nonSlot.moduleId]?.label;
    expect(written).not.toBe(label);
  });
});
