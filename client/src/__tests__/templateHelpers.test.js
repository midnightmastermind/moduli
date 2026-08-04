import { describe, it, expect } from "vitest";
import {
  templatesFolderFor, templateKindOf, templatesByKind, templateLabelOf,
} from "../helpers/templateHelpers";

const lookups = {
  foldersById: {
    "tpl-f": { id: "tpl-f", gridId: "g1", name: "Templates", meta: { protected: true } },
    other:   { id: "other", gridId: "g1", name: "Notes" },
  },
  occurrencesById: {
    board: { id: "board", parentId: "tpl-f", moduleId: "m-board" },
    doc:   { id: "doc",   parentId: "tpl-f", moduleId: "m-doc" },
    loose: { id: "loose", parentId: "other", moduleId: "m-board" },
  },
  modulesById: {
    "m-board": { id: "m-board", role: "page", kind: "board", label: "Schedule Template" },
    "m-doc":   { id: "m-doc",   role: "page", kind: "doc",   label: "Day Page" },
  },
};

describe("templateHelpers", () => {
  it("finds the protected Templates folder", () => {
    expect(templatesFolderFor(lookups, "g1")?.id).toBe("tpl-f");
  });

  it("reports the GRANULAR kind, not just 'page'", () => {
    // The old templateKindOf returned role||kind, collapsing every page to
    // "page" — which cannot tell a board template from a doc one.
    expect(templateKindOf(lookups, lookups.occurrencesById.board)).toBe("board");
    expect(templateKindOf(lookups, lookups.occurrencesById.doc)).toBe("doc");
  });

  it("lists only templates of the requested kind", () => {
    expect(templatesByKind(lookups, "g1", "board").map(o => o.id)).toEqual(["board"]);
    expect(templatesByKind(lookups, "g1", "doc").map(o => o.id)).toEqual(["doc"]);
  });

  it("ignores pages outside the folder", () => {
    expect(templatesByKind(lookups, "g1", "board").map(o => o.id)).not.toContain("loose");
  });

  it("returns nothing when the folder does not exist", () => {
    expect(templatesByKind({ foldersById: {}, occurrencesById: {}, modulesById: {} }, "g1", "board")).toEqual([]);
  });
});

describe("templateLabelOf", () => {
  // Migration 0035 unsets meta.templateName — a template is named by its module
  // label like any other page. Reading templateName here would render every
  // template as "(unnamed)".
  it("names a template by its module label", () => {
    expect(templateLabelOf(lookups, lookups.occurrencesById.doc)).toBe("Day Page");
  });

  it("prefers a per-occurrence label override when one is set", () => {
    const occ = { id: "x", parentId: "tpl-f", moduleId: "m-doc", label: "Renamed" };
    expect(templateLabelOf(lookups, occ)).toBe("Renamed");
  });

  it("falls back to a readable placeholder rather than blank", () => {
    expect(templateLabelOf(lookups, { id: "y", moduleId: "missing" })).toBe("(unnamed)");
    expect(templateLabelOf(lookups, null)).toBe("(unnamed)");
  });
});
