// server/__tests__/createLiveData.test.js
// Structural assertions for createLiveData:
// - grid.name === "Live Grid"
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
  it("grid.name === 'Live Grid'", async () => {
    if (!connected) return;
    const grid = await Grid.findOne({ userId: USER_ID });
    expect(grid).toBeTruthy();
    expect(grid.name).toBe("Live Grid");
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
  it("exactly one occurrence with meta.templateName === 'Daily Routine' exists", async () => {
    if (!connected) return;
    const { gridId } = result;
    const occs = await Occurrence.find({ gridId, "meta.templateName": "Daily Routine" }).lean();
    expect(occs).toHaveLength(1);
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
