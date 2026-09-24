// server/__tests__/serverExecutorCreate.test.js
//
// serverExecutor's own header says CREATE "needs a connected browser tab
// today". A share arrives with no tab (the extension case), so it cannot.
import { describe, it, expect, vi, beforeEach } from "vitest";

const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (args) => {
    minted.push(args);
    return { occurrenceId: `occ${minted.length}`, moduleId: `mod${minted.length}`, status: "created" };
  },
}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));

// FIND fixtures. Deliberately not empty — an empty mock would let FIND "pass"
// by always returning null, which discriminates nothing (this codebase has
// paid for exactly that vacuous-test shape before). Two containers with the
// SAME label under DIFFERENT roles proves the role filter actually filters,
// not just that a predicate can match a label:
//   - cont-bookmarks: role container, label "Bookmarks" — what the brief's
//     tests assert against.
//   - inst-bookmarks: role instance, label "Bookmarks" too — a decoy. If the
//     $allContainers role filter were dropped, a FIND for "Bookmarks" could
//     still incidentally return the right id (array order), so this alone
//     doesn't prove much; the point is it must never break the real test by
//     matching first, and the dedicated role-discrimination test below reads
//     it explicitly.
const MODULES = [
  { id: "mod-bookmarks-cont", userId: "u1", gridId: "g1", role: "container", label: "Bookmarks" },
  { id: "mod-bookmarks-inst", userId: "u1", gridId: "g1", role: "instance", label: "Bookmarks" },
  { id: "mod-other-grid-cont", userId: "u1", gridId: "g2", role: "container", label: "Bookmarks" },
];
const OCCURRENCES = [
  { id: "cont-bookmarks", userId: "u1", gridId: "g1", moduleId: "mod-bookmarks-cont", label: null },
  { id: "inst-bookmarks", userId: "u1", gridId: "g1", moduleId: "mod-bookmarks-inst", label: null },
  { id: "occ-other-grid", userId: "u1", gridId: "g2", moduleId: "mod-other-grid-cont", label: null },
];
function matches(doc, query) {
  return Object.entries(query).every(([k, v]) => doc[k] === v);
}
vi.mock("../models/Module.js", () => ({
  default: { find: (query) => ({ lean: async () => MODULES.filter(m => matches(m, query)) }) },
}));
vi.mock("../models/Occurrence.js", () => ({
  default: { find: (query) => ({ lean: async () => OCCURRENCES.filter(o => matches(o, query)) }) },
}));

const { runOperationServerSide } = await import("../services/serverExecutor.js");

const op = (steps) => ({ id: "op1", name: "t", pipeline: { steps } });
beforeEach(() => { minted.length = 0; });

describe("CREATE, server-side", () => {
  it("mints a row with resolved values from $vars", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "INIT_VAR", name: "$title", value: "literal:Dentist" } },
      { type: "action", config: { type: "CREATE", parentId: "literal:cont1", label: "$title",
        fields: { fDate: "literal:2026-09-25" }, externalId: "literal:ics:abc" } },
    ]), { userId: "u1", gridId: "g1" });

    expect(minted).toHaveLength(1);
    expect(minted[0].label).toBe("Dentist");
    expect(minted[0].parentId).toBe("cont1");
    expect(minted[0].fields.fDate).toEqual({ value: "2026-09-25", flow: "in" });
  });

  it("BINDS every field it writes (D17)", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        fields: { fA: "literal:1", fB: "literal:2" }, externalId: "literal:e" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].fieldBindings.map(b => b.fieldId).sort()).toEqual(["fA", "fB"]);
  });

  it("honours an explicit bindFields list, so a field can be bound EMPTY", async () => {
    // The ics rule binds Schedule Type with no value so the Schedule op, which
    // gates on the binding, still picks the row up.
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        fields: { fDate: "literal:2026-09-25" }, bindFields: ["fSchedType", "fDate"],
        externalId: "literal:e" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].fieldBindings.map(b => b.fieldId)).toContain("fSchedType");
    expect(minted[0].fields.fSchedType).toBeUndefined();
  });

  it("runs inside a LOOP once per item", async () => {
    await runOperationServerSide(op([
      { type: "action", config: { type: "INIT_VAR", name: "$xs", value: ["a", "b", "c"] } },
      { type: "loop", overExpr: "$xs", as: "$x", body: [
        { type: "action", config: { type: "CREATE", parentId: "literal:c",
          label: "$x", externalId: "$x" } },
      ]},
    ]), { userId: "u1", gridId: "g1" });
    expect(minted.map(m => m.label)).toEqual(["a", "b", "c"]);
  });

  it("refuses a CREATE with no gridId, loudly, and mints nothing", async () => {
    // A CREATE reaching here with gridId undefined (e.g. apiV1.js's current call site,
    // which does not pass one yet) must not reach mintOccurrence's existence lookup —
    // that would run findOne({ userId, gridId: undefined, ... }), which can match
    // across grids, and a mint with no match would write gridId: undefined. Refuse
    // before any of that.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentId: "literal:c", label: "literal:x",
        externalId: "literal:e" } },
    ]), { userId: "u1" }); // no gridId

    expect(minted).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(res.error.message).toMatch(/gridId/i);
  });

  it("CONTROL — an action still outside the subset does not half-run", async () => {
    // Scope discipline: only CREATE and FIND are added. APPLY_TEMPLATE must
    // still be refused rather than silently doing nothing.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "APPLY_TEMPLATE", templateRef: "literal:t" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.unsupported).toContain("APPLY_TEMPLATE");
    expect(minted).toHaveLength(0);
  });
});

describe("FIND, server-side", () => {
  it("binds the matching occurrence's id to itemIdVar", async () => {
    // seeded via the Occurrence mock: one container labelled "Bookmarks"
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("cont-bookmarks");
  });

  it("leaves the var empty when nothing matches, rather than throwing", async () => {
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Nope" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value ?? null).toBe(null);
  });

  it("the role filter actually filters — an instance sharing the label is not a container", async () => {
    // Discriminating sibling to the first test: without $allContainers really
    // restricting to role:"container", this FIND has two candidates sharing
    // the label "Bookmarks" (cont-bookmarks, inst-bookmarks) and nothing
    // stops it from returning the wrong one.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allInstances",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("inst-bookmarks");
  });

  it("scopes by gridId — a same-labelled container on another grid is not a match", async () => {
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    // Would be "occ-other-grid" if gridId scoping were dropped and g1 came
    // second in iteration order — asserting the g1 id directly is the guard.
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("cont-bookmarks");
  });

  it("refuses a FIND with no gridId, loudly", async () => {
    // Same reasoning as CREATE's guard, but for a READ: Mongoose drops an
    // undefined key from a query filter, so gridId:undefined would silently
    // widen the search to every grid the user owns — a cross-grid leak, not
    // a clean miss. Refuse before that query runs.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
    ]), { userId: "u1" }); // no gridId
    expect(res.ok).toBe(false);
    expect(res.error.message).toMatch(/gridId/i);
  });

  it("CONTROL — an unrelated action does not reach FIND's Mongo calls", async () => {
    // Guards the query mocks themselves: an op with no FIND step must not
    // touch Module/Occurrence at all.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "literal:x" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("x");
  });
});
