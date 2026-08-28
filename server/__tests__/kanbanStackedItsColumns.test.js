import { describe, it, expect } from "vitest";
import { planProjectPages, reorderEmbeds }
  from "../migrations/0279-a-kanban-that-stacked-its-columns.mjs";
import { PROJECT_KANBAN_LAYOUT } from "../utils/liveSystemBuilders.js";

const STATUS = ["Backburner", "Docket", "Working On", "In Review", "Test", "Complete"];

// A project page: page → [kanban(6 cols), scope]. `signed` mirrors the live
// split — the template and Paul's carry project: signatures, Via Fluere does
// not, and the selector must not care either way.
function world({ signed = true, kanbanMeta = null, order = ["kan", "scope"], cols = STATUS } = {}) {
  const modulesById = {
    pageM:   { id: "pageM",  role: "page",      kind: "doc" },
    kanM:    { id: "kanM",   role: "container", kind: "board", label: "Kanban" },
    scopeM:  { id: "scopeM", role: "container", kind: "doc",   label: "Project Scope" },
    colM:    { id: "colM",   role: "container", kind: "board" },
  };
  const colOccs = cols.map((label, i) => ({
    id: `col${i}`, moduleId: "colM", label, occurrences: [],
    ...(signed ? { identitySignature: `kanbanCol:${i}` } : {}),
  }));
  const occurrences = [
    { id: "page", moduleId: "pageM", label: "Project: X", occurrences: order.map(k => (k === "kan" ? "kan" : "scope")) },
    { id: "kan", moduleId: "kanM", occurrences: colOccs.map(c => c.id),
      ...(kanbanMeta ? { meta: kanbanMeta } : {}),
      ...(signed ? { identitySignature: "project:Kanban" } : {}) },
    { id: "scope", moduleId: "scopeM", occurrences: [],
      ...(signed ? { identitySignature: "project:Project Scope" } : {}) },
    ...colOccs,
  ];
  return { occurrences, modulesById };
}

describe("0279 — planProjectPages", () => {
  it("finds a project page and names its kanban and scope", () => {
    const { occurrences, modulesById } = world();
    const plan = planProjectPages(occurrences, modulesById, STATUS);
    expect(plan).toHaveLength(1);
    expect(plan[0].kanbanId).toBe("kan");
    expect(plan[0].scopeIds).toEqual(["scope"]);
    expect(plan[0].needsLayout).toBe(true);
    expect(plan[0].needsReorder).toBe(true);
  });

  // THE DISCRIMINATING CASE, and the reason the selector is not signature-based.
  // Via Fluere was cloned by the client long ago and carries NO project:
  // signature anywhere in its subtree. A signature selector reads clean and
  // silently skips a real project.
  it("finds an UNSIGNED project page identically (the Via Fluere case)", () => {
    const signedPlan   = planProjectPages(...Object.values(world({ signed: true })), STATUS);
    const unsignedPlan = planProjectPages(...Object.values(world({ signed: false })), STATUS);
    expect(unsignedPlan).toHaveLength(1);
    expect(unsignedPlan[0].kanbanId).toBe(signedPlan[0].kanbanId);
  });

  // FAIL CLOSED. With no options to compare against every board matches the
  // empty set, and this would rewrite the layout of every container on the grid.
  it("refuses to match anything when the status options are missing", () => {
    const { occurrences, modulesById } = world();
    for (const opts of [null, undefined, [], ["Docket"]]) {
      expect(planProjectPages(occurrences, modulesById, opts)).toEqual([]);
    }
  });

  it("ignores a board whose columns are not the status set", () => {
    const { occurrences, modulesById } = world({ cols: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] });
    expect(planProjectPages(occurrences, modulesById, STATUS)).toEqual([]);
  });

  it("is idempotent — a kanban already carrying the shape needs no layout", () => {
    const { occurrences, modulesById } = world({ kanbanMeta: { layoutCascade: { ...PROJECT_KANBAN_LAYOUT } } });
    const plan = planProjectPages(occurrences, modulesById, STATUS);
    expect(plan[0].needsLayout).toBe(false);
  });

  it("is idempotent — a page already leading with its scope needs no reorder", () => {
    const { occurrences, modulesById } = world({ order: ["scope", "kan"] });
    const plan = planProjectPages(occurrences, modulesById, STATUS);
    expect(plan[0].needsReorder).toBe(false);
  });

  it("keeps a partially-configured kanban on the work list", () => {
    const { occurrences, modulesById } = world({ kanbanMeta: { layoutCascade: { mode: "flex-row" } } });
    expect(planProjectPages(occurrences, modulesById, STATUS)[0].needsLayout).toBe(true);
  });
});

describe("0279 — reorderEmbeds", () => {
  const emb = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });

  it("swaps the kanban behind the scope", () => {
    const out = reorderEmbeds([emb("kan"), emb("scope")], "kan", ["scope"]);
    expect(out.map(n => n.attrs.occurrenceId)).toEqual(["scope", "kan"]);
  });

  // A SWAP, NOT A REWRITE. Rebuilding the body from the child list would delete
  // anything the user typed around the embeds.
  it("preserves every other node in the body", () => {
    const para = { type: "paragraph", content: [{ type: "text", text: "keep me" }] };
    const out = reorderEmbeds([para, emb("kan"), para, emb("scope"), para], "kan", ["scope"]);
    expect(out.map(n => n.type)).toEqual(["paragraph", "moduleEmbed", "paragraph", "moduleEmbed", "paragraph"]);
    expect(out.filter(n => n.type === "paragraph")).toHaveLength(3);
    expect(out[1].attrs.occurrenceId).toBe("scope");
    expect(out[3].attrs.occurrenceId).toBe("kan");
  });

  it("returns null when the scope already leads, or the kanban is not embedded", () => {
    expect(reorderEmbeds([emb("scope"), emb("kan")], "kan", ["scope"])).toBeNull();
    expect(reorderEmbeds([emb("scope")], "kan", ["scope"])).toBeNull();
    expect(reorderEmbeds(null, "kan", ["scope"])).toBeNull();
  });

  it("moves the kanban behind the FIRST scope section when there are several", () => {
    const out = reorderEmbeds([emb("kan"), emb("s1"), emb("s2")], "kan", ["s1", "s2"]);
    expect(out.map(n => n.attrs.occurrenceId)).toEqual(["s1", "kan", "s2"]);
  });
});
