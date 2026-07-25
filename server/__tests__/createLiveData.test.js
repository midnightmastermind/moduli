// server/__tests__/createLiveData.test.js
// Structural assertions for createLiveData:
// - grid.name === "Poms"
// - Zero operations with an AGGREGATE step (deep-walk + JSON stringify both checked)
// - Zero container modules at grid scope with meta.scheduleSlot === true (slot
//   containers must only exist in the Templates manifest subtree with
//   meta.templateModule === true)
// - Notebook panel View.activeOccurrenceId === schedPageOccId from return value
// - Exactly one occ with meta.templateName === "Daily Routine" and one with
//   meta.templateName === "Day Page" exist for the grid
//
// Uses real MongoDB (mongodb://127.0.0.1/moduli_test_live) — skips if DB unreachable.
// Same harness as createDefaultUserData.test.js: real DB, clean slate, drop after.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";

let createLiveData;
let Grid, Module, Occurrence, View, Operation, Folder;
let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect("mongodb://127.0.0.1/moduli_test_live", {
      serverSelectionTimeoutMS: 2000,
    });
    connected = true;
  } catch {
    console.warn("MongoDB not reachable — createLiveData tests skipped");
    return;
  }

  // Clean slate (separate DB from createDefaultUserData tests)
  await mongoose.connection.db.dropDatabase();

  const mod = await import("../scripts/createLiveData.js");
  createLiveData = mod.createLiveData;

  Grid      = (await import("../models/Grid.js")).default;
  Module    = (await import("../models/Module.js")).default;
  Occurrence = (await import("../models/Occurrence.js")).default;
  View      = (await import("../models/View.js")).default;
  Operation = (await import("../models/Operation.js")).default;
  Folder    = (await import("../models/Folder.js")).default;
});

afterAll(async () => {
  if (connected) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

// ── Helper: recursively walk pipeline steps and collect all nodes ──────────────
// Returns a flat list of every step/sub-step in the tree.
function collectAllSteps(steps) {
  if (!Array.isArray(steps)) return [];
  const result = [];
  for (const step of steps) {
    result.push(step);
    // IF step has then/else branches
    if (step.if) {
      if (Array.isArray(step.if.then)) result.push(...collectAllSteps(step.if.then));
      if (Array.isArray(step.if.else)) result.push(...collectAllSteps(step.if.else));
    }
    // LOOP step has a body array
    if (Array.isArray(step.loop?.body)) result.push(...collectAllSteps(step.loop.body));
    // Nested steps array (future-proof)
    if (Array.isArray(step.steps)) result.push(...collectAllSteps(step.steps));
  }
  return result;
}

describe("createLiveData — structural assertions", () => {
  let result;
  const USER_ID = "live-test-user-001";

  beforeAll(async () => {
    if (!connected) return;
    result = await createLiveData(USER_ID);
  }, 120_000); // large timeout — seeding full live grid takes ~30–60 s

  it("skips gracefully if DB not available", () => {
    if (!connected) return;
    expect(result?.gridId).toBeTruthy();
  });

  // ── 1. Grid name ─────────────────────────────────────────────────────────────
  it("grid.name === 'Poms'", async () => {
    if (!connected) return;
    const grid = await Grid.findOne({ userId: USER_ID, name: "Poms" });
    expect(grid).toBeTruthy();
    expect(grid.name).toBe("Poms");
  });

  // ── 2. Zero AGGREGATE steps (deep structural scan + JSON string guard) ───────
  it("no operation has a step with config.type === 'AGGREGATE' (deep walk)", async () => {
    if (!connected) return;
    const { gridId } = result;
    const ops = await Operation.find({ gridId });
    expect(ops.length).toBeGreaterThan(0); // sanity: ops were created

    for (const op of ops) {
      const steps = op.pipeline?.steps ?? [];
      const allNodes = collectAllSteps(steps);
      for (const node of allNodes) {
        // node.config may be present on action steps
        expect(node.config?.type).not.toBe("AGGREGATE");
      }
    }
  });

  it("no operation pipeline JSON contains the string 'AGGREGATE'", async () => {
    if (!connected) return;
    const { gridId } = result;
    const ops = await Operation.find({ gridId });
    for (const op of ops) {
      const pipelineStr = JSON.stringify(op.pipeline ?? {});
      expect(pipelineStr).not.toContain('"AGGREGATE"');
    }
  });

  // ── 2b. Mirror ops carry the INCLUSIVE scope guard (toolkit-drop freeze fix) ──
  // Canvas: Build and People Table: Build must rebuild ONLY on a genuine source
  // change — a bulk fire OR a trigger occurrence under the source page. The old
  // EXCLUSIVE self-trigger guard (skip only when the trigger is provably one of
  // the op's OWN copies) failed on DELETEs (deleted occ has no resolvable
  // ancestors) and let the orphan-sweep deletes re-fire the op → exponential
  // OccurrenceDeleteOp cascade. The inclusive guard is marked by the
  // $isSourceChange flag + a $trigger.occurrence._ancestors HAS_ANCESTOR rule.
  it("Canvas: Build uses the inclusive scope guard ($isSourceChange + ancestor scope)", async () => {
    if (!connected) return;
    const { gridId } = result;
    const op = await Operation.findOne({ gridId, name: "Canvas: Build" });
    expect(op).toBeTruthy();
    const json = JSON.stringify(op.pipeline ?? {});
    expect(json).toContain("$isSourceChange");
    expect(json).toContain("$trigger.occurrence._ancestors");
    // Scoped to the Schedule page, not to the canvas's own children.
    expect(json).toContain("$schedPageId");
  });

  it("People Table: Build uses the inclusive scope guard ($isSourceChange + ancestor scope)", async () => {
    if (!connected) return;
    const { gridId } = result;
    const op = await Operation.findOne({ gridId, name: "People Table: Build" });
    expect(op).toBeTruthy();
    const json = JSON.stringify(op.pipeline ?? {});
    expect(json).toContain("$isSourceChange");
    expect(json).toContain("$trigger.occurrence._ancestors");
  });

  // Table: Build must mirror the Schedule by PERIOD, not a single day. The
  // pre-multiday op resolved a single $schedDate and matched tasks with
  // SAME_DAY; once the picker started writing period OBJECTS ({value,unit} /
  // {kind:"multi",dates}) into the effective filter, SAME_DAY compared a date
  // string against an object and matched nothing → the table produced zero
  // rows. Migrated to $schedPeriod + DATE_IN_PERIOD (mirrors the trackers'
  // $goalPeriod chain). Guard against regression to the single-date model.
  it("Table: Build is period-aware (DATE_IN_PERIOD $schedPeriod, no SAME_DAY $schedDate)", async () => {
    if (!connected) return;
    const { gridId } = result;
    const op = await Operation.findOne({ gridId, name: "Table: Build" });
    expect(op).toBeTruthy();
    const json = JSON.stringify(op.pipeline ?? {});
    expect(json).toContain("$schedPeriod");
    expect(json).toContain("DATE_IN_PERIOD");
    // The old single-date variable must be gone from the live pipeline.
    expect(json).not.toContain("$schedDate");
  });

  // Canvas: Build had the IDENTICAL single-date bug Table: Build did (SAME_DAY
  // $schedDate against the picker's period object → zero cards). Phase 1 of the
  // Schedule Canvas fix migrated it to the same $schedPeriod + DATE_IN_PERIOD
  // model. Guard against regression.
  it("Canvas: Build is period-aware (DATE_IN_PERIOD $schedPeriod, no SAME_DAY $schedDate)", async () => {
    if (!connected) return;
    const { gridId } = result;
    const op = await Operation.findOne({ gridId, name: "Canvas: Build" });
    expect(op).toBeTruthy();
    const json = JSON.stringify(op.pipeline ?? {});
    expect(json).toContain("$schedPeriod");
    expect(json).toContain("DATE_IN_PERIOD");
    expect(json).not.toContain("$schedDate");
  });

  // Phase 2 mindmap layer: cards are stamped as representation preview nodes and
  // threaded into a chain via auto-generated edges on the canvas page's
  // meta.edges (hand-drawn edges preserved). Guard the wiring stays present.
  it("Canvas: Build stamps preview nodes + builds the mindmap edge chain", async () => {
    if (!connected) return;
    const { gridId } = result;
    const op = await Operation.findOne({ gridId, name: "Canvas: Build" });
    expect(op).toBeTruthy();
    const json = JSON.stringify(op.pipeline ?? {});
    expect(json).toContain('"$copy.meta.viewMode"');
    expect(json).toContain("representation");
    expect(json).toContain('"$canvas.meta.edges"');
    expect(json).toContain("auto-");
  });

  // Schedule: Mark Passed Slots must be a TIME-BASED op (schedule set, no event
  // triggers) and drive coloring through the generic ownStyle + the new
  // TIME_BEFORE/DATE_BEFORE comparators — never via hardcoded schedule logic in
  // the renderer.
  it("Schedule: Mark Passed Slots is time-based and writes ownStyle via TIME_BEFORE/DATE_BEFORE", async () => {
    if (!connected) return;
    const { gridId } = result;
    const op = await Operation.findOne({ gridId, name: "Schedule: Mark Passed Slots" });
    expect(op).toBeTruthy();
    expect(op.schedule).toBeTruthy();
    expect(op.schedule.kind).toBe("interval");
    expect(Array.isArray(op.triggerObjects) ? op.triggerObjects.length : 0).toBe(0);
    const json = JSON.stringify(op.pipeline ?? {});
    expect(json).toContain("TIME_BEFORE");
    expect(json).toContain("DATE_BEFORE");
    expect(json).toContain("ownStyle.bg");
    expect(json).toContain("$currentTime");
  });

  // ── 3. No scheduleSlot container modules at grid scope ───────────────────────
  it("no container module at grid scope has meta.scheduleSlot === true", async () => {
    if (!connected) return;
    const { gridId } = result;
    // Query all container modules for this grid with meta.scheduleSlot set
    const slotContainers = await Module.find({
      gridId,
      role: "container",
      "meta.scheduleSlot": true,
    }).lean();
    expect(slotContainers).toHaveLength(0);
  });

  it("any scheduleSlot module that exists carries meta.templateModule === true", async () => {
    if (!connected) return;
    const { gridId } = result;
    // This broader query covers modules from ALL manifests (including Templates).
    // All must have templateModule:true — none are naked "live" slot containers.
    const slotMods = await Module.find({ gridId, "meta.scheduleSlot": true }).lean();
    for (const mod of slotMods) {
      expect(mod.meta?.templateModule).toBe(true);
    }
  });

  // ── 4. Notebook hub View.activeOccurrenceId === schedPageOccId ───────────────
  it("notebook hub View.activeOccurrenceId points to the Schedule page occurrence", async () => {
    if (!connected) return;
    const { notebookHubViewId, schedPageOccId } = result;
    expect(notebookHubViewId).toBeTruthy();
    expect(schedPageOccId).toBeTruthy();

    const view = await View.findOne({ id: notebookHubViewId });
    expect(view).toBeTruthy();
    expect(view.activeOccurrenceId).toBe(schedPageOccId);
  });

  // ── 5. Template occurrences exist ────────────────────────────────────────────
  // The Schedule Template page lives in Library > Templates (it's a real
  // library page, not a templates-manifest entry). Schedule: Build COPY_LINKs
  // its Day container into the Schedule page per visible day.
  it("exactly one 'Schedule Template' page exists with a Day container as its child", async () => {
    if (!connected) return;
    const { gridId } = result;
    const Module = mongoose.model("Module");
    const pageMods = await Module.find({ gridId, role: "page", label: "Schedule Template" }).lean();
    expect(pageMods).toHaveLength(1);
    const pageOccs = await Occurrence.find({ gridId, moduleId: pageMods[0].id }).lean();
    expect(pageOccs).toHaveLength(1);
    const dayOccs = await Occurrence.find({ gridId, identitySignature: "day-container" }).lean();
    expect(dayOccs).toHaveLength(1);
    expect(dayOccs[0].parentId).toBe(pageOccs[0].id);
  });

  it("exactly one occurrence with meta.templateName === 'Day Page' exists", async () => {
    if (!connected) return;
    const { gridId } = result;
    const occs = await Occurrence.find({ gridId, "meta.templateName": "Day Page" }).lean();
    expect(occs).toHaveLength(1);
  });

  // ── 6. Tracker op count (recommended, high-value) ────────────────────────────
  // Tracker ops are routed into the per-grid "Trackers" folder (Command
  // Center category) via makeTrackerOp's folderId arg and inline folderId
  // on the muscle/meal trackers. Count by folderId, not name-prefix —
  // names were stripped of the "Tracker:" prefix once the folder existed.
  it("at least 19 tracker operations exist in the Trackers folder", async () => {
    if (!connected) return;
    const { gridId } = result;
    const trackersFolder = await Folder.findOne({ gridId, name: "Trackers", folderType: "category" });
    expect(trackersFolder, "Missing Trackers category folder").toBeTruthy();
    const trackerOps = await Operation.find({ gridId, folderId: trackersFolder.id });
    expect(trackerOps.length).toBeGreaterThanOrEqual(19);
  });

  it("the 4 named shared schedule/day-page ops exist", async () => {
    if (!connected) return;
    const { gridId } = result;
    const names = [
      "Schedule: Build Day",
      "Day Page: Build",
      "Schedule: Stamp Date & Time Slot",
      "Schedule: Clear Date on Move-Out",
    ];
    for (const name of names) {
      const op = await Operation.findOne({ gridId, name });
      expect(op, `Missing op: "${name}"`).toBeTruthy();
    }
  });
});
