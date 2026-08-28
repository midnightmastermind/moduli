/**
 * 0277 — a cloned doc page embedded the TEMPLATE's children.
 *
 * A `page/doc` renders its TEXTMAP, not its `occurrences[]`. `cloneSubtree`
 * regenerated the child list with fresh ids and carried the textmap over
 * verbatim, so every server-side clone pointed at the SOURCE's children and
 * rendered the source's content or nothing.
 *
 * The client's APPLY_TEMPLATE has done this remap since it was written. The
 * server twin never had it — so `apply_template`, `clone_subtree_as_template`,
 * `save_over_template`, the v1 API route and every cloning migration were all
 * affected. Nothing caught it because the DATA is correct in every other way:
 * right children, right parent, right labels. Only rendering the page shows it.
 */
import { describe, it, expect } from "vitest";
import { cloneSubtree, remapEmbeddedRefs } from "../utils/cloneSubtree.js";
import { embeddedIds, planEmbedRepair } from "../migrations/0277-cloned-page-embedded-the-template.mjs";

const fakePersist = () => {
  const modules = [], occurrences = [];
  return { modules, occurrences, saveModule: async m => { modules.push(m); }, saveOccurrence: async o => { occurrences.push(o); } };
};

/** A doc page whose textmap EMBEDS its one child — the shape that broke. */
const ucDocPage = () => ({
  modulesById: {
    "m-p": { id: "m-p", userId: "u", role: "page", kind: "doc", label: "Project: {ProjectName}", meta: {} },
    "m-k": { id: "m-k", userId: "u", role: "container", kind: "board", label: "Kanban", meta: {} },
  },
  occurrencesById: {
    "o-p": { id: "o-p", userId: "u", moduleId: "m-p", gridId: "g1", occurrences: ["o-k"], meta: {},
      textmap: { type: "doc", content: [
        { type: "moduleEmbed", attrs: { occurrenceId: "o-k", instanceId: "m-k" } },
        { type: "paragraph", content: [{ type: "text", text: "prose" }] },
      ]}},
    "o-k": { id: "o-k", userId: "u", moduleId: "m-k", gridId: "g1", occurrences: [], meta: {} },
  },
});

describe("cloneSubtree — the clone must embed its OWN children", () => {
  it("repoints the embed at the cloned child, not the source's", async () => {
    const uc = ucDocPage();
    const persist = fakePersist();
    const { rootClonedOccurrenceId } = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, persist, newParentId: "folder-x",
    });
    const clonedPage = persist.occurrences.find(o => o.id === rootClonedOccurrenceId);
    const embed = clonedPage.textmap.content[0].attrs;

    expect(rootClonedOccurrenceId).not.toBe("o-p");
    expect(clonedPage.occurrences).toHaveLength(1);
    // THE ASSERTION. Before the fix this read "o-k" — the TEMPLATE's child.
    expect(embed.occurrenceId, "the clone still embeds the source's child").toBe(clonedPage.occurrences[0]);
    expect(embed.occurrenceId).not.toBe("o-k");
  });

  it("repoints instanceId (the child's MODULE) too", async () => {
    const uc = ucDocPage();
    const persist = fakePersist();
    const { rootClonedOccurrenceId } = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, persist, newParentId: "f",
    });
    const page = persist.occurrences.find(o => o.id === rootClonedOccurrenceId);
    const child = persist.occurrences.find(o => o.id === page.occurrences[0]);
    expect(page.textmap.content[0].attrs.instanceId).toBe(child.moduleId);
  });

  it("leaves the SOURCE textmap untouched — it is shared, and a template is applied many times", async () => {
    const uc = ucDocPage();
    await cloneSubtree({ rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, persist: fakePersist(), newParentId: "f" });
    expect(uc.occurrencesById["o-p"].textmap.content[0].attrs.occurrenceId).toBe("o-k");
  });

  it("keeps non-embed content verbatim — the control", async () => {
    const uc = ucDocPage();
    const persist = fakePersist();
    const { rootClonedOccurrenceId } = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, persist, newParentId: "f",
    });
    const page = persist.occurrences.find(o => o.id === rootClonedOccurrenceId);
    expect(page.textmap.content[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "prose" }] });
  });

  it("a node with no textmap still clones", async () => {
    const uc = ucDocPage();
    delete uc.occurrencesById["o-p"].textmap;
    const persist = fakePersist();
    const r = await cloneSubtree({ rootOccurrenceId: "o-p", userId: "u", gridId: "g1", uc, persist, newParentId: "f" });
    expect(r.rootClonedOccurrenceId).toBeTruthy();
  });
});

describe("remapEmbeddedRefs", () => {
  const tm = { type: "doc", content: [
    { type: "moduleEmbed", attrs: { occurrenceId: "a", instanceId: "ma" } },
    { type: "bulletList", content: [{ type: "listItem", content: [
      { type: "instanceTextblock", attrs: { occurrenceId: "b" } }] }] },
  ]};

  it("remaps at any depth", () => {
    const out = remapEmbeddedRefs(tm, new Map([["a", "A"], ["b", "B"]]), new Map([["ma", "MA"]]));
    expect(out.content[0].attrs.occurrenceId).toBe("A");
    expect(out.content[0].attrs.instanceId).toBe("MA");
    expect(out.content[1].content[0].content[0].attrs.occurrenceId).toBe("B");
  });

  it("leaves an id that is NOT in the map alone", () => {
    const out = remapEmbeddedRefs(tm, new Map([["a", "A"]]), new Map());
    expect(out.content[1].content[0].content[0].attrs.occurrenceId).toBe("b");
  });

  it("does not mutate the input", () => {
    remapEmbeddedRefs(tm, new Map([["a", "A"]]), new Map());
    expect(tm.content[0].attrs.occurrenceId).toBe("a");
  });

  it("passes null through", () => {
    expect(remapEmbeddedRefs(null, new Map([["a", "A"]]), new Map())).toBe(null);
  });
});

describe("planEmbedRepair — narrow on purpose", () => {
  const mods = { m: { label: "Page" } };
  const tpl = { id: "T", moduleId: "m", occurrences: ["tk", "ts"], meta: {} };
  const clone = (textmapIds, kids = ["ck", "cs"]) => ({
    id: "C", moduleId: "m", occurrences: kids, meta: { appliedFromTemplateId: "T" },
    textmap: { type: "doc", content: textmapIds.map(id => ({ type: "moduleEmbed", attrs: { occurrenceId: id } })) },
  });

  it("flags a clone still embedding the template's children", () => {
    const plan = planEmbedRepair([tpl, clone(["tk", "ts"])], mods);
    expect(plan).toHaveLength(1);
    expect(plan[0].stale.sort()).toEqual(["tk", "ts"]);
    expect(plan[0].remap.get("tk")).toBe("ck");
  });

  // THE CONTROL that keeps this from being a sweep. 2026-08-23 (2) measured 474
  // embeds across 233 hosts reachable ONLY through a textmap — embedding a
  // non-child is a legitimate, common shape on this grid.
  it("does NOT flag a clone that already embeds its own children", () => {
    expect(planEmbedRepair([tpl, clone(["ck", "cs"])], mods)).toEqual([]);
  });

  it("does NOT flag an occurrence that is not a template clone at all", () => {
    const stray = { ...clone(["tk"]), meta: {} };
    expect(planEmbedRepair([tpl, stray], mods)).toEqual([]);
  });

  it("does NOT flag an embed of something unrelated to the template", () => {
    expect(planEmbedRepair([tpl, clone(["some-other-page"])], mods)).toEqual([]);
  });

  // Position is only identity when the lists correspond one-to-one.
  it("REFUSES when the child lists are different lengths", () => {
    expect(planEmbedRepair([tpl, clone(["tk", "ts"], ["ck"])], mods)).toEqual([]);
  });

  it("refuses when the template no longer exists", () => {
    expect(planEmbedRepair([clone(["tk", "ts"])], mods)).toEqual([]);
  });

  it("embeddedIds finds ids at any depth and none where there are none", () => {
    expect(embeddedIds({ type: "doc", content: [{ content: [{ attrs: { occurrenceId: "deep" } }] }] })).toEqual(["deep"]);
    expect(embeddedIds({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
  });
});
