import { describe, it, expect } from "vitest";
import { planJellyfinMigration, applyMigrationPlan, OP_NAME, BOARD_LABEL } from "../migrations/0479-jellyfin-media.mjs";

function state() {
  const fields = [
    { id: "fCat", name: "Board Category", type: "select", folderId: "fc", meta: { optionsSource: { values: ["movie", "documentary"] } } },
    { id: "fLW", name: "Last Watched", type: "date", folderId: "fc", meta: {} },
  ];
  const modules = [
    { id: "mMovie", role: "artifact", kind: "movie", label: "Movie", fieldBindings: [{ fieldId: "fCat" }], meta: { mediaRow: true } },
    { id: "mEp", role: "artifact", kind: "episode", label: "Episode", fieldBindings: [{ fieldId: "fCat", order: 0 }] },
    { id: "mBox", role: "container", kind: "board", label: "Movies", fieldBindings: [{ fieldId: "drill" }] },
    { id: "mPage", role: "page", kind: "board", label: "Movies", fieldBindings: [] },
  ];
  const occurrences = [
    { id: "box", moduleId: "mBox", userId: "u", feed: { enabled: true, roles: ["instance"], limit: 5000, conditions: [{ fieldId: "fCat", comparator: "CONTAINS", value: "movie" }] },
      fields: { fCat: { value: ["movie"], flow: "in" } }, meta: { layoutCascadeOverride: { mode: "wrap" } }, occurrences: ["m1"] },
    { id: "page", moduleId: "mPage", userId: "u", parentId: "media", occurrences: ["box"], sortOrder: 3, filterOverride: null },
    { id: "m1", moduleId: "mMovie", parentId: "box", label: "Heat", fields: { fCat: { value: ["movie"] } } },
    { id: "e1", moduleId: "mEp", parentId: "eps", label: "S01E01", fields: { fCat: { value: ["episode"] } } },
  ];
  const folders = [{ id: "lib", name: "Library Ops", folderType: "category", categoryKind: "op" }];
  return { gridId: "g", userId: "u", fields, modules, occurrences, operations: [], folders };
}
let n = 0;
const newId = () => `id${n++}`;
const now = new Date("2026-11-01T12:00:00Z");

describe("0479 planJellyfinMigration", () => {
  it("one board, one Watched At, one op; Last Watched bound visibly and Watched At hidden on Movie, Episode and Documentary", () => {
    const s = state();
    const p = planJellyfinMigration(s, { newId, now });
    expect(p.fields.map((f) => f.name)).toEqual(["Watched At"]);
    expect(p.board.page.parentId).toBe("media");
    expect(p.board.container.identitySignature).toBe("jellyfin:danny");
    expect(p.board.container.parentId).toBe(p.board.page.id);   // a page delete takes its board with it
    expect(p.board.container.feed.conditions).toEqual([{ fieldId: "fCat", comparator: "CONTAINS", value: "documentary" }]);
    expect(p.board.modules.find((m) => m.role === "page").label).toBe(BOARD_LABEL);
    const docMod = p.board.modules.find((m) => m.label === "Documentary");
    expect(p.board.container.meta.documentaryModuleId).toBe(docMod.id);
    const wa = p.fields[0].id;
    const binds = Object.fromEntries(p.bindings.map((b) => [b.moduleId, b.add]));
    for (const mid of ["mMovie", "mEp"]) {
      expect(binds[mid]).toEqual([expect.objectContaining({ fieldId: "fLW" }), expect.objectContaining({ fieldId: wa, hidden: true })]);
      expect(binds[mid][0].hidden).toBeFalsy();
    }
    expect(docMod.fieldBindings.map((b) => b.fieldId)).toEqual(expect.arrayContaining(["fCat", "fLW", wa]));
    expect(p.op).toMatchObject({ name: OP_NAME, folderId: "lib", enabled: false, schedule: { kind: "atTimes", times: ["05:00"] } });
    expect(p.op.triggerObjects[0]).toMatchObject({ eventType: "onLoad" });
    expect(p.op.pipeline.steps[0].config).toMatchObject({ type: "CALL_API", url: "/api/v1/jellyfin/sync", method: "POST" });
  });

  it("run twice adds one board and one op", () => {
    const s = state();
    applyMigrationPlan(s, planJellyfinMigration(s, { newId, now }));
    const again = planJellyfinMigration(s, { newId, now });
    expect(again).toMatchObject({ fields: [], bindings: [], board: null, op: null });
    expect(s.occurrences.filter((o) => o.identitySignature === "jellyfin:danny")).toHaveLength(1);
    expect(s.operations.filter((o) => o.name === OP_NAME)).toHaveLength(1);
  });

  it("refuses without a Movies page + board to copy", () => {
    const s = state();
    s.occurrences = s.occurrences.filter((o) => o.id !== "page");
    expect(() => planJellyfinMigration(s, { newId, now })).toThrow(/Movies/);
  });
});

import { planParentFix } from "../migrations/0480-danny-board-parent.mjs";
describe("0480 planParentFix", () => {
  it("parents the Danny board to the page that lists it, and only that", () => {
    const occs = [{ id: "box", identitySignature: "jellyfin:danny", parentId: null }, { id: "page", occurrences: ["box"] },
      { id: "other", parentId: null }];
    expect(planParentFix(occs)).toEqual({ id: "box", parentId: "page" });
    expect(planParentFix([{ ...occs[0], parentId: "page" }, occs[1]])).toBeNull();
  });
  it("refuses when no page, or several, list it", () => {
    expect(() => planParentFix([{ id: "box", identitySignature: "jellyfin:danny", parentId: null }])).toThrow();
    expect(() => planParentFix([{ id: "box", identitySignature: "jellyfin:danny", parentId: null }, { id: "a", occurrences: ["box"] }, { id: "b", occurrences: ["box"] }])).toThrow();
  });
  it("nothing to do on a grid without the board", () => expect(planParentFix([{ id: "x" }])).toBeNull());
});
