// 0501 — the root Glossary page. Plans the page with the migration's own planGlossary and drives its operations
// through the REAL executor: a category's button opens that category's links, Quick Links' opens them all, the
// panel button shows the page in the panel it was pressed in.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { planGlossary, CATEGORIES } from "../../../server/migrations/0501-root-glossary.mjs";

let k = 0;
const plan = planGlossary({
  userId: "u", gridId: "g", rootFolderId: "root", buttonFieldId: "btn",
  targets: { pages: [{ label: "Schedule", occId: "sched" }, { label: "Tasks", occId: "tasks" }], folders: [{ label: "Boards", occId: "boards-fp" }] },
  cpsLinks: [["Join class", "https://us06web.zoom.us/j/1"]],
  mint: () => `id${++k}`,
});
const occ = Object.fromEntries(plan.occurrences.map((o) => [o.id, { ...o }]));
const mods = Object.fromEntries(plan.modules.map((m) => [m.id, m]));
const ctx = () => ({ state: { grid: { _id: "g", activeFilterValues: {} }, gridId: "g", modules: plan.modules, occurrencesById: occ, modulesById: mods, fields: [], fieldsById: {}, operations: [] },
  occurrencesById: occ, modulesById: mods, fieldsById: {}, operationsById: {} });
const opNamed = (name) => { const o = plan.ops.find((x) => x.name === name); return { id: name, name, pipeline: { sources: [], steps: o.steps }, steps: o.steps }; };
const press = (opName, transaction) => (executePipeline(opNamed(opName), ctx(), transaction) || []).filter((u) => u._effect);
const labelOf = (id) => mods[occ[id].moduleId].label;
const sectionNamed = (name) => plan.occurrences.find((o) => labelOf(o.id) === name && mods[o.moduleId].role === "container");

describe("the Glossary page", () => {
  it("sits in the root folder and holds Places then Quick Links", () => {
    const page = occ[plan.pageOccId];
    expect(page.parentId).toBe("root");
    expect(page.occurrences.map(labelOf)).toEqual(["Places", "Quick Links"]);
  });
  it("every child is listed AND embedded by its parent", () => {
    for (const o of plan.occurrences) {
      if (!o.parentId || o.parentId === "root") continue;
      const parent = occ[o.parentId];
      expect(parent.occurrences).toContain(o.id);
      expect(JSON.stringify(parent.textmap)).toContain(o.id);
    }
  });
  it("in-app links point at the pages and folders; site links are url chips", () => {
    const links = plan.occurrences.filter((o) => o.meta?.link).map((o) => o.meta.link);
    expect(links).toContainEqual({ kind: "occurrence", occId: "sched" });
    expect(links).toContainEqual({ kind: "occurrence", occId: "boards-fp" });
    expect(links).toContainEqual({ kind: "url", url: "https://fetlife.com" });
    expect(links).toContainEqual({ kind: "url", url: "https://www.eweka.nl" });
    expect(links).toContainEqual({ kind: "url", url: "https://us06web.zoom.us/j/1" });
  });
  it("Quick Links and every category carry the Open in Browser button", () => {
    for (const id of plan.sectionOccIds) expect(mods[occ[id].moduleId].fieldBindings.map((b) => b.fieldId)).toEqual(["btn"]);
    expect(plan.sectionOccIds.map(labelOf)).toEqual(["Quick Links", ...CATEGORIES.map((c) => c.name)]);
  });
});

describe("its operations", () => {
  it("a category's button opens that category's links", () => {
    const social = sectionNamed("Social");
    const fx = press("Glossary: Open Links", { type: "ButtonOp", occurrenceId: social.id, fieldId: "btn" });
    expect(fx).toEqual([{ _effect: "OPEN_URLS", urls: expect.arrayContaining(["https://www.facebook.com", "https://www.instagram.com", "https://fetlife.com"]) }]);
    expect(fx[0].urls).toHaveLength(3);
  });
  it("Quick Links' button opens every site and no in-app link", () => {
    const fx = press("Glossary: Open Links", { type: "ButtonOp", occurrenceId: plan.sectionOccIds[0], fieldId: "btn" });
    const all = CATEGORIES.flatMap((c) => c.links.map(([, u]) => u)).concat(["https://us06web.zoom.us/j/1"]);
    expect(new Set(fx[0].urls)).toEqual(new Set(all));
  });
  it("the panel button shows the Glossary in the panel it was pressed in", () => {
    const fx = press("Panel: Open Glossary", { type: "ButtonOp", panelViewId: "view-7" });
    expect(fx).toEqual([{ _effect: "UPDATE_VIEW", viewId: "view-7", patch: { activeOccurrenceId: plan.pageOccId } }]);
  });
});
