// server/__tests__/createDefaultUserData.test.js
// Validates the shape of data produced by createDefaultUserData:
// - centerHub panel has 3 page occurrences (Schedule / Notebook / Freepad)
// - No "Global" folder (removed — root folder used directly)
// - Panel count = 5 (dailyToolkit, todoList, centerHub, dailyGoals, accounts)
// - centerHub view has activeOccurrenceId pointing to the Schedule page
//
// Uses real MongoDB (mongodb://127.0.0.1/moduli_test_create) — skips if DB unreachable.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";

let createDefaultUserData;
let Grid, Module, Occurrence, View, Folder, Manifest;
let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect("mongodb://127.0.0.1/moduli_test_create", {
      serverSelectionTimeoutMS: 2000,
    });
    connected = true;
  } catch {
    console.warn("MongoDB not reachable — createDefaultUserData tests skipped");
    return;
  }

  // Clean slate
  await mongoose.connection.db.dropDatabase();

  const mod = await import("../utils/createDefaultUserData.js");
  createDefaultUserData = mod.createDefaultUserData;

  Grid       = (await import("../models/Grid.js")).default;
  Module     = (await import("../models/Module.js")).default;
  Occurrence = (await import("../models/Occurrence.js")).default;
  View       = (await import("../models/View.js")).default;
  Folder     = (await import("../models/Folder.js")).default;
  Manifest   = (await import("../models/Manifest.js")).default;
});

afterAll(async () => {
  if (connected) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("createDefaultUserData — panel shape", () => {
  let result;
  const USER_ID = "test-user-001";

  beforeAll(async () => {
    if (!connected) return;
    result = await createDefaultUserData(USER_ID);
  });

  it("skips if DB not available", () => {
    if (!connected) return;
    expect(result?.gridId).toBeTruthy();
  });

  it("creates exactly 5 panel modules", async () => {
    if (!connected) return;
    const panels = await Module.find({ userId: USER_ID, role: "panel" });
    expect(panels.length).toBe(5);
    const labels = panels.map(p => p.label).sort();
    // All panels have generic label "Panel A"–"Panel E"
    expect(labels).toEqual(["Panel A", "Panel B", "Panel C", "Panel D", "Panel E"]);
  });

  it("grid occurrences has exactly 5 panel occurrences", async () => {
    if (!connected) return;
    const grid = await Grid.findOne({ userId: USER_ID });
    expect(grid.occurrences.length).toBe(5);
  });

  it("centerHub panel occurrence is at col:1 spanning 2 rows", async () => {
    if (!connected) return;
    // Find all panel occurrences with placement.col === 1
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const col1Panels = panelOccs.filter(o => o.placement?.col === 1);
    expect(col1Panels.length).toBe(1); // only one panel at col:1 (was 3 before)
    const hub = col1Panels[0];
    expect(hub.placement.height).toBe(2);
  });

  it("centerHub panel occurrence has exactly 3 child page occurrences", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);
    expect(hubOcc).toBeTruthy();
    expect(hubOcc.occurrences.length).toBe(3);
  });

  it("the 3 centerHub page modules have correct labels", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);

    const pageOccs = await Occurrence.find({ id: { $in: hubOcc.occurrences } });
    const pageMods = await Module.find({ id: { $in: pageOccs.map(o => o.targetId) } });
    const labels = pageMods.map(m => m.label).sort();
    expect(labels).toEqual(["Freepad", "Notebook", "Schedule"]);
  });

  it("the 3 centerHub page modules have correct kinds", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);

    const pageOccs = await Occurrence.find({ id: { $in: hubOcc.occurrences } });
    const pageMods = await Module.find({ id: { $in: pageOccs.map(o => o.targetId) } });
    const kindByLabel = Object.fromEntries(pageMods.map(m => [m.label, m.kind]));
    expect(kindByLabel["Schedule"]).toBe("board");
    expect(kindByLabel["Notebook"]).toBe("board");
    expect(kindByLabel["Freepad"]).toBe("canvas");
  });

  it("the 3 page modules have role: page", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);

    const pageOccs = await Occurrence.find({ id: { $in: hubOcc.occurrences } });
    const pageMods = await Module.find({ id: { $in: pageOccs.map(o => o.targetId) } });
    expect(pageMods.every(m => m.role === "page")).toBe(true);
  });

  it("centerHub has a viewId pointing to a View", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);
    expect(hubOcc.viewId).toBeTruthy();
    const view = await View.findOne({ id: hubOcc.viewId });
    expect(view).toBeTruthy();
  });

  it("centerHub view activeOccurrenceId points to the Schedule page occurrence", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);

    const view = await View.findOne({ id: hubOcc.viewId });
    const schedPageOcc = await Occurrence.findOne({ id: view.activeOccurrenceId });
    expect(schedPageOcc).toBeTruthy();
    const schedMod = await Module.findOne({ id: schedPageOcc.targetId });
    expect(schedMod?.label).toBe("Schedule");
  });

  it("centerHub has filterOverride set for scheduledDate", async () => {
    if (!connected) return;
    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);
    expect(hubOcc.filterOverride).toBeTruthy();
    const keys = Object.keys(hubOcc.filterOverride);
    expect(keys.length).toBe(1); // exactly 1 filter key (scheduledDateFieldId)
  });
});

describe("createDefaultUserData — manifest / folder shape", () => {
  const USER_ID = "test-user-001";

  it("no folder with folderType 'global' exists", async () => {
    if (!connected) return;
    const globalFolder = await Folder.findOne({ userId: USER_ID, folderType: "global" });
    expect(globalFolder).toBeNull();
  });

  it("user manifest root folder exists and is type 'normal'", async () => {
    if (!connected) return;
    const grid = await Grid.findOne({ userId: USER_ID });
    const manifest = await Manifest.findOne({ id: grid.manifestId });
    expect(manifest).toBeTruthy();
    const rootFolder = await Folder.findOne({ id: manifest.rootFolderId });
    expect(rootFolder).toBeTruthy();
    expect(rootFolder.folderType).toBe("normal");
  });

  it("page occurrences use the manifest root folder as parentId", async () => {
    if (!connected) return;
    const grid = await Grid.findOne({ userId: USER_ID });
    const manifest = await Manifest.findOne({ id: grid.manifestId });

    const panelOccs = await Occurrence.find({ userId: USER_ID });
    const hubOcc = panelOccs.find(o => o.placement?.col === 1);
    const pageOccs = await Occurrence.find({ id: { $in: hubOcc.occurrences } });

    for (const pageOcc of pageOccs) {
      expect(pageOcc.parentId).toBe(manifest.rootFolderId);
    }
  });
});
