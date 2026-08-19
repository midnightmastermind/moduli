// 0143 rearranges PROTECTED LIVE DATA and deletes two panel occurrences, so the
// tests weigh what it REFUSES far more than what it writes. Every refusal here
// stands for a way this could quietly destroy something the user asked to keep.
//
// `up` is driven directly against fake models rather than testing an extracted
// helper: the guards ARE the migration, and a helper tested in isolation would
// not prove the delete is gated on them.
import { describe, it, expect } from "vitest";
import { up } from "../migrations/0143-poms-mosaic-three-panels.mjs";

const GID = "grid-1";
const ROUTINES = "YGVS8DQ_vphC", TRACKERS = "78gtKMbXSiuP", SCHEDULE = "rkN14S6dVkeG";
const CLOSE_B = "CMjTDM0Bja3O", CLOSE_E = "bIk31RnE-giv";
const SCHED_PAGE = "llpF10Bda5nu";

function world(over = {}) {
  const occurrences = [
    { id: ROUTINES, gridId: GID, moduleId: "mA", viewId: "vA", placement: { row: 0, col: 0, width: 1, height: 1 }, occurrences: [] },
    { id: CLOSE_B,  gridId: GID, moduleId: "mB", viewId: "vB", placement: { row: 1, col: 0, width: 1, height: 1 }, occurrences: ["pgTasks"] },
    { id: SCHEDULE, gridId: GID, moduleId: "mC", viewId: "vC", placement: { row: 0, col: 1, width: 1, height: 2 }, occurrences: ["pgDay", SCHED_PAGE] },
    { id: TRACKERS, gridId: GID, moduleId: "mD", viewId: "vD", placement: { row: 0, col: 2, width: 1, height: 1 }, occurrences: [] },
    { id: CLOSE_E,  gridId: GID, moduleId: "mE", viewId: "vE", placement: { row: 1, col: 2, width: 1, height: 1 }, occurrences: ["pgBoards"] },
    // The tabs. Parented to FOLDERS, which is what makes closing a panel safe.
    { id: "pgTasks",  gridId: GID, moduleId: "mp1", parentId: "folder-1", occurrences: [] },
    { id: "pgBoards", gridId: GID, moduleId: "mp2", parentId: "folder-2", occurrences: [] },
    { id: "pgDay",    gridId: GID, moduleId: "mp3", parentId: "folder-3", occurrences: [] },
    { id: SCHED_PAGE, gridId: GID, moduleId: "mp4", parentId: "folder-3", occurrences: [] },
  ];
  const modules = [
    { id: "mA", gridId: GID, label: "Panel A" }, { id: "mB", gridId: GID, label: "Panel B" },
    { id: "mC", gridId: GID, label: "Panel C" }, { id: "mD", gridId: GID, label: "Panel D" },
    { id: "mE", gridId: GID, label: "Panel E" },
    { id: "mp1", gridId: GID, label: "Tasks" }, { id: "mp2", gridId: GID, label: "Boards" },
    { id: "mp3", gridId: GID, label: "Day Page" }, { id: "mp4", gridId: GID, label: "Schedule" },
  ];
  const views = [{ id: "vC", activeOccurrenceId: "pgDay" }];
  const grid = { _id: "g1", rows: 2, cols: 3, occurrences: [ROUTINES, CLOSE_B, SCHEDULE, TRACKERS, CLOSE_E], meta: {} };
  return { occurrences, modules, views, grid, ...over };
}

function models(w, writes) {
  const coll = (rows) => ({
    find: () => ({ lean: async () => rows }),
    findOne: (q) => ({ lean: async () => rows.find(r => r.id === q.id) ?? null }),
    updateOne: async (q, u) => { writes.push({ op: "update", q, u }); },
    deleteOne: async (q) => { writes.push({ op: "delete", q }); },
  });
  return {
    Occurrence: coll(w.occurrences),
    Module: coll(w.modules),
    View: coll(w.views),
    Grid: coll([{ ...w.grid, id: w.grid._id }]),
  };
}

async function run(w, { dryRun = false } = {}) {
  const writes = [], logs = [];
  await up({ gridId: GID, grid: w.grid, models: models(w, writes), log: (m) => logs.push(m), dryRun });
  return { writes, logs, text: logs.join("\n") };
}

describe("0143 — the refusals", () => {
  it("REFUSES when a closing panel is the PARENT of one of its tabs", async () => {
    // The one outcome this must never have: closing a panel deleting a page.
    const w = world();
    w.occurrences.find(o => o.id === "pgTasks").parentId = CLOSE_B;
    const { writes, text } = await run(w);
    expect(text).toMatch(/REFUSING/);
    expect(text).toMatch(/orphan Tasks/);
    expect(writes).toHaveLength(0);
  });

  it("REFUSES when a closing panel's module is shared by another occurrence", async () => {
    // A panel module has exactly one placement. More than one means this is not
    // the module we think it is, and sweeping it would break something else.
    const w = world();
    w.occurrences.push({ id: "elsewhere", gridId: GID, moduleId: "mE", occurrences: [] });
    const { writes, text } = await run(w);
    expect(text).toMatch(/REFUSING.*module mE has 2 occurrences/);
    expect(writes).toHaveLength(0);
  });

  it("REFUSES to re-point at a Schedule the panel does not carry as a tab", async () => {
    const w = world();
    const c = w.occurrences.find(o => o.id === SCHEDULE);
    c.occurrences = c.occurrences.filter(id => id !== SCHED_PAGE);
    const { writes, text } = await run(w);
    expect(text).toMatch(/REFUSING.*not a tab/);
    expect(writes).toHaveLength(0);
  });

  it("REFUSES when a named panel is missing rather than half-applying", async () => {
    const w = world();
    w.occurrences = w.occurrences.filter(o => o.id !== TRACKERS);
    const { writes, text } = await run(w);
    expect(text).toMatch(new RegExp(`REFUSING.*${TRACKERS}`));
    expect(writes).toHaveLength(0);
  });

  it("writes NOTHING on a dry run, having reported the whole plan", async () => {
    const { writes, text } = await run(world(), { dryRun: true });
    expect(writes).toHaveLength(0);
    expect(text).toMatch(/Trackers r1c0/);
  });
});

describe("0143 — what it writes", () => {
  it("lands the three panels at the specified cells and 2x2", async () => {
    const { writes } = await run(world());
    const placed = Object.fromEntries(
      writes.filter(w => w.op === "update" && w.u.$set?.placement).map(w => [w.q.id, w.u.$set.placement]));
    expect(placed[ROUTINES]).toEqual({ row: 0, col: 0, width: 1, height: 1 });
    expect(placed[TRACKERS]).toEqual({ row: 1, col: 0, width: 1, height: 1 });
    expect(placed[SCHEDULE]).toEqual({ row: 0, col: 1, width: 1, height: 2 });

    const g = writes.find(w => w.op === "update" && w.u.$set?.["meta.layoutTree"]);
    expect(g.u.$set.rows).toBe(2);
    expect(g.u.$set.cols).toBe(2);
    expect(g.u.$set.occurrences).toEqual([ROUTINES, TRACKERS, SCHEDULE]);
  });

  it("puts Trackers UNDER Routines in the left column, not beside the Schedule", async () => {
    // Dropping the two closed leaves from the old tree would collapse both
    // single-child splits and leave Trackers on the RIGHT. The tree is authored
    // for exactly this reason.
    const { writes } = await run(world());
    const tree = writes.find(w => w.u?.$set?.["meta.layoutTree"]).u.$set["meta.layoutTree"];
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].children.map(c => c.panelOccId)).toEqual([ROUTINES, TRACKERS]);
    expect(tree.children[1].panelOccId).toBe(SCHEDULE);
  });

  it("re-points the Schedule panel's View and mints no new panel", async () => {
    const { writes } = await run(world());
    const v = writes.find(w => w.op === "update" && w.u.$set?.activeOccurrenceId);
    expect(v.q.id).toBe("vC");
    expect(v.u.$set.activeOccurrenceId).toBe(SCHED_PAGE);
  });

  it("removes each closed panel's occurrence, module AND view — and no page", async () => {
    const { writes } = await run(world());
    const deleted = writes.filter(w => w.op === "delete").map(w => w.q.id).sort();
    expect(deleted).toEqual(["mB", "mE", CLOSE_B, CLOSE_E, "vB", "vE"].sort());
    for (const page of ["pgTasks", "pgBoards", "pgDay"]) expect(deleted).not.toContain(page);
  });

  it("is idempotent — a converged grid is left alone", async () => {
    const w = world();
    w.grid = { ...w.grid, rows: 2, cols: 2, occurrences: [ROUTINES, TRACKERS, SCHEDULE] };
    const { writes, text } = await run(w);
    expect(text).toMatch(/already a 2x2/);
    expect(writes).toHaveLength(0);
  });
});
