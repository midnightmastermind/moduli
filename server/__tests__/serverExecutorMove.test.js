// MOVE_OCCURRENCE, server-side — so a share rule can file a shared upload
// (which lands in Files before any rule runs) somewhere else: shared PDFs →
// the Documents folder. Same config as the client executor's action.
import { describe, it, expect, vi, beforeEach } from "vitest";

const occs = new Map(), folders = new Map();
const matches = (d, q) => Object.entries(q).every(([k, v]) =>
  k === "occurrences"
    ? (v && typeof v === "object" && "$ne" in v ? !(d.occurrences || []).includes(v.$ne) : (d.occurrences || []).includes(v))
    : d[k] === v);
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => { const d = [...occs.values()].find(o => matches(o, q)); return d ? { ...d } : null; } }),
  findOneAndUpdate: async (q, u) => {
    const d = [...occs.values()].find(o => matches(o, q)); if (!d) return null;
    if (u.$set) Object.assign(d, u.$set);
    if (u.$pull) d.occurrences = (d.occurrences || []).filter(x => x !== u.$pull.occurrences);
    if (u.$push) d.occurrences = [...(d.occurrences || []), u.$push.occurrences];
    return { ...d };
  },
}}));
vi.mock("../models/Folder.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => [...folders.values()].find(f => matches(f, q)) || null }),
}}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));
vi.mock("../models/Module.js", () => ({ default: {} }));
vi.mock("../services/occurrenceMint.js", () => ({ mintOccurrence: async () => ({}) }));

const { runOperationServerSide } = await import("../services/serverExecutor.js");
const run = (cfg, vars = {}, gridId = "g1") => runOperationServerSide(
  { id: "op", pipeline: { steps: [{ id: "m", type: "action", config: { type: "MOVE_OCCURRENCE", ...cfg } }] } },
  { userId: "u1", gridId, vars, mirror: vi.fn() });

beforeEach(() => {
  occs.clear(); folders.clear();
  folders.set("files-docs", { id: "files-docs", userId: "u1", gridId: "g1", name: "Documents" });
  folders.set("documents", { id: "documents", userId: "u1", gridId: "g1", name: "Documents" });
  folders.set("other-grid", { id: "other-grid", userId: "u1", gridId: "g2", name: "X" });
  occs.set("pdf", { id: "pdf", userId: "u1", gridId: "g1", parentId: "files-docs", occurrences: [] });
  occs.set("box", { id: "box", userId: "u1", gridId: "g1", parentId: null, occurrences: ["row"] });
  occs.set("row", { id: "row", userId: "u1", gridId: "g1", parentId: "box", occurrences: [] });
  occs.set("box2", { id: "box2", userId: "u1", gridId: "g1", parentId: null, occurrences: [] });
});

describe("MOVE_OCCURRENCE", () => {
  it("moves a shared upload from Files into another FOLDER (by parentId)", async () => {
    const r = await run({ occurrenceIdExpr: "$share.props.occurrenceId", toContainerId: "literal:documents" },
      { $share: { props: { occurrenceId: "pdf" } } });
    expect(r.ok).toBe(true);
    expect(occs.get("pdf").parentId).toBe("documents");
  });

  it("moves between CONTAINERS: unlisted from the old, listed in the new", async () => {
    await run({ occurrenceIdExpr: "literal:row", toContainerId: "literal:box2" });
    expect(occs.get("row").parentId).toBe("box2");
    expect(occs.get("box").occurrences).toEqual([]);
    expect(occs.get("box2").occurrences).toEqual(["row"]);
  });

  it("refuses a destination on ANOTHER grid, and moves nothing", async () => {
    const r = await run({ occurrenceIdExpr: "literal:pdf", toContainerId: "literal:other-grid" });
    expect(r.ok).toBe(false);
    expect(occs.get("pdf").parentId).toBe("files-docs");
  });

  it("refuses a row that is not on this grid", async () => {
    const r = await run({ occurrenceIdExpr: "literal:pdf", toContainerId: "literal:documents" }, {}, "g2");
    expect(r.ok).toBe(false);
  });

  it("is a no-op when there is nothing to move (no file in the share)", async () => {
    const r = await run({ occurrenceIdExpr: "$share.props.occurrenceId", toContainerId: "literal:documents" }, { $share: { props: {} } });
    expect(r.ok).toBe(true);
    expect(r.effects).toEqual([]);
  });
});
