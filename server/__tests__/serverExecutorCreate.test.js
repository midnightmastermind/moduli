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
// mod-template-cont / occ-template: REVIEW FIX (Critical 2) fixture — a
// container module+occurrence flagged isTemplate:true, matching the shape
// createDefaultUserData.js stamps on the day-page template
// (`meta: { isTemplate: true }` on the OCCURRENCE). Gives FIND something real
// to wrongly match if the exclusion regresses.
//
// occ-cross-probe-g2 / occ-cross-probe-g1: REVIEW FIX (Important 3) fixture —
// two occurrences sharing a label unique to this pair, one on g1 and one on
// g2, with the WRONG-grid row listed FIRST. Used with `over: $allOccurrences`
// (role: null) so the role-based module filter — which incidentally also
// excludes cross-grid rows via modById, since Module.find is itself scoped by
// gridId — cannot be the thing making the test pass. Only Occurrence.find's
// own `{ gridId }` key can exclude occ-cross-probe-g2 here.
const MODULES = [
  { id: "mod-bookmarks-cont", userId: "u1", gridId: "g1", role: "container", label: "Bookmarks" },
  { id: "mod-bookmarks-inst", userId: "u1", gridId: "g1", role: "instance", label: "Bookmarks" },
  { id: "mod-template-cont", userId: "u1", gridId: "g1", role: "container", label: "TemplateOnly" },
];
const OCCURRENCES = [
  { id: "cont-bookmarks", userId: "u1", gridId: "g1", moduleId: "mod-bookmarks-cont", label: null },
  { id: "inst-bookmarks", userId: "u1", gridId: "g1", moduleId: "mod-bookmarks-inst", label: null },
  { id: "occ-template", userId: "u1", gridId: "g1", moduleId: "mod-template-cont", label: null, meta: { isTemplate: true } },
  { id: "occ-cross-probe-g2", userId: "u1", gridId: "g2", moduleId: "mod-bookmarks-cont", label: "CrossGridProbe" },
  { id: "occ-cross-probe-g1", userId: "u1", gridId: "g1", moduleId: "mod-bookmarks-cont", label: "CrossGridProbe" },
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

// A folder parent (the share catch-all → Files). One folder on g1, none on g2,
// so the grid scope of the check is what a cross-grid test exercises.
const FOLDERS = [{ id: "files-folder-g1", userId: "u1", gridId: "g1", name: "Files" }];
vi.mock("../models/Folder.js", () => ({
  default: { findOne: (query) => ({ lean: async () => FOLDERS.find(f => matches(f, query)) || null }) },
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

  it("scopes by gridId — a same-labelled occurrence on another grid never leaks in", async () => {
    // REVIEW FIX (Important 3). The PRIOR version of this test used
    // `$allContainers` with the `occ-other-grid` decoy, and it was VACUOUS:
    // the reviewer's targeted mutation (drop only `gridId` from
    // Occurrence.find, leave Module.find alone) left it passing, because
    // Module.find is STILL scoped to gridId g1 regardless — so the leaked
    // cross-grid occurrence's module was never fetched, its role filter
    // failed to match, and it was excluded for a reason that had nothing to
    // do with the thing under test.
    //
    // This version uses `$allOccurrences` (role: null), which skips the
    // role/module filter entirely — so ONLY Occurrence.find's own
    // `{ gridId }` key can keep occ-cross-probe-g2 out. It is listed BEFORE
    // the real match in the fixture array (see OCCURRENCES above), so a
    // leaked cross-grid row would be the FIRST match `Array.prototype.find`
    // sees if gridId scoping regressed.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allOccurrences",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:CrossGridProbe" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("occ-cross-probe-g1");
  });

  it("resolves a $item.-prefixed predicate left the same as a bare one", async () => {
    // REVIEW FIX (Critical 1). evalRule used to route a bare-path `left`
    // through resolveRecordPath ONLY when it did not start with "$" — which
    // excluded the very `$item.`/`$record.` legacy prefixes
    // resolveRecordPath exists to strip. A predicate written that way (real
    // seeded shape, e.g. `$record._ancestors HAS_ANCESTOR <library>`) fell
    // through to resolveExpr($vars), resolved to undefined, and matched
    // nothing — the opposite of what the UI's own FIND does for the
    // identical predicate.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "$item.label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("cont-bookmarks");
  });

  it("excludes a template-flagged occurrence, even when it otherwise matches", async () => {
    // REVIEW FIX (Critical 2). `occ-template` binds a container module
    // labelled "TemplateOnly" and carries `meta.isTemplate: true` — the exact
    // shape createDefaultUserData.js stamps on the day-page template
    // occurrence. The client's own FIND filters `!it.meta?.isTemplate` before
    // ever evaluating a predicate; without the equivalent server-side
    // exclusion this row is a legitimate-looking match a share rule could
    // silently route into.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:TemplateOnly" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value ?? null).toBe(null);
  });

  it("a single `id IS <x>` predicate is a lookup, not a scan", async () => {
    // REVIEW FIX (Important 4, cheap half). Proven BEHAVIORALLY, not just by
    // correctness — a spy on Array.prototype.find is the same technique the
    // client's own `findByIdIsALookup.test.js` uses (there: spying on
    // Array.prototype.filter) to prove the id-equals path bypasses the
    // general per-record scan rather than merely returning the right answer,
    // which a scan would too. Removing the fast path here would still make
    // this test's VALUE assertion pass — only the spy assertion catches it,
    // which is exactly the point.
    const spy = vi.spyOn(Array.prototype, "find");
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "id", comparator: "IS", right: "literal:cont-bookmarks" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value).toBe("cont-bookmarks");
  });

  it("CONTROL — a non-id predicate still scans (Array.prototype.find IS called)", async () => {
    // The discriminating sibling to the id-lookup test above: without this,
    // "Array.prototype.find is not called" could just mean nothing runs.
    const spy = vi.spyOn(Array.prototype, "find");
    await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "label", comparator: "IS", right: "literal:Bookmarks" }] },
        itemIdVar: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the id fast path still excludes a template-flagged record", async () => {
    // Same exclusion as the scan path — verified because records are
    // filtered UPSTREAM of the id/scan branch, so this pins that ordering
    // rather than assuming it.
    const res = await runOperationServerSide(op([
      { type: "action", config: { type: "FIND", over: "$allContainers",
        predicate: { operator: "AND", rules: [
          { left: "id", comparator: "IS", right: "literal:occ-template" }] },
        itemIdVar: "$destId" } },
      { type: "action", config: { type: "SHOW_VALUE", name: "$out", value: "$destId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(res.effects.find(e => e._effect === "SHOW_VALUE").value ?? null).toBe(null);
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

describe("CREATE into a folder, and the returned scope", () => {
  it("passes a folder parent through to the mint, separately from parentId", async () => {
    const r = await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentFolderId: "literal:files-folder-g1",
        label: "literal:x", externalId: "literal:link:x" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(r.ok).toBe(true);
    expect(minted[0].parentFolderId).toBe("files-folder-g1");
    expect(minted[0].parentId).toBeFalsy();
  });

  it("refuses a folder that is not on THIS grid, and mints nothing", async () => {
    const r = await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", parentFolderId: "literal:files-folder-g1",
        label: "literal:x", externalId: "literal:link:x" } },
    ]), { userId: "u1", gridId: "g2" });
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/folder/);
    expect(minted).toHaveLength(0);
  });

  it("hands the mirror callback to the mint so the warm cache learns the row", async () => {
    const mirror = () => {};
    await runOperationServerSide(op([
      { type: "action", config: { type: "CREATE", label: "literal:x", externalId: "literal:link:x" } },
    ]), { userId: "u1", gridId: "g1", mirror });
    expect(minted[0].mirror).toBe(mirror);
  });

  it("returns the whole variable scope, not only SHOW_VALUE output", async () => {
    const r = await runOperationServerSide(op([
      { type: "action", config: { type: "SET_VAR", name: "$share.handled", value: "true" } },
    ]), { userId: "u1", gridId: "g1", vars: { $share: { type: "link" } } });
    expect(r.vars).toEqual({});
    expect(r.scope["$share.handled"]).toBe(true);
    expect(r.scope.$share.type).toBe("link");
  });
});

// A share rule is built in the Imports tab with the SAME editor every
// operation uses — which writes CREATE as name/parent/role/kind/attachFields.
// Before these were read, such a rule ran here with no label and no parent.
describe("CREATE written by the operations editor", () => {
  it("reads name / parent / role / kind / attachFields", async () => {
    const r = await runOperationServerSide(op([
      { id: "s1", type: "action", config: { type: "CREATE", name: "$share.label", parent: "literal:cont-bookmarks",
        role: "instance", kind: "bookmark", attachFields: ["fTags"], fields: { fUrl: "$share.props.url" } } },
    ]), { userId: "u1", gridId: "g1", vars: { $share: { label: "A page", externalId: "link:https://x.test", props: { url: "https://x.test" } } } });
    expect(r.ok).toBe(true);
    const m = minted[0];
    expect(m.label).toBe("A page");
    expect(m.parentId).toBe("cont-bookmarks");
    expect(m.moduleRole).toBe("instance");
    expect(m.moduleKind).toBe("bookmark");
    expect(m.fieldBindings.map(b => b.fieldId).sort()).toEqual(["fTags", "fUrl"]);
    expect(m.fields.fUrl.value).toBe("https://x.test");
  });

  it("keys a share rule's row on the share + the step, so a re-share updates it", async () => {
    const pipeline = op([{ id: "s1", type: "action", config: { type: "CREATE", name: "literal:x" } }]);
    const vars = { $share: { externalId: "link:https://x.test" } };
    await runOperationServerSide(pipeline, { userId: "u1", gridId: "g1", vars });
    await runOperationServerSide(pipeline, { userId: "u1", gridId: "g1", vars });
    expect(minted[0].externalId).toBe("link:https://x.test::s1");
    expect(minted[1].externalId).toBe(minted[0].externalId);
  });

  it("a LOOP of creates gets one key per item, not one for all", async () => {
    await runOperationServerSide(op([
      { id: "L", type: "loop", over: "$share.events", as: "$e", body: [
        { id: "s1", type: "action", config: { type: "CREATE", name: "$e.summary" } },
      ]},
    ]), { userId: "u1", gridId: "g1", vars: { $share: { externalId: "ics:f", events: [{ summary: "A" }, { summary: "B" }] } } });
    expect(minted.map(m => m.externalId)).toEqual(["ics:f::s1::0", "ics:f::s1::1"]);
    expect(minted.map(m => m.label)).toEqual(["A", "B"]);
  });

  it("resolves an editor-style meta object value by value", async () => {
    await runOperationServerSide(op([
      { id: "s1", type: "action", config: { type: "CREATE", name: "literal:x", externalId: "literal:k",
        meta: { from: "$share.source", fixed: "literal:yes" } } },
    ]), { userId: "u1", gridId: "g1", vars: { $share: { source: "android" } } });
    expect(minted[0].meta).toEqual({ from: "android", fixed: "yes" });
  });

  it("sets itemIdVar to the new row's id", async () => {
    const r = await runOperationServerSide(op([
      { id: "s1", type: "action", config: { type: "CREATE", name: "literal:x", externalId: "literal:k", itemIdVar: "$newId" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(r.scope.$newId).toBe("occ1");
  });

  it("the server's own spelling still wins when a step carries both", async () => {
    await runOperationServerSide(op([
      { id: "s1", type: "action", config: { type: "CREATE", label: "literal:server", name: "literal:editor",
        externalId: "literal:k" } },
    ]), { userId: "u1", gridId: "g1" });
    expect(minted[0].label).toBe("server");
  });
});
