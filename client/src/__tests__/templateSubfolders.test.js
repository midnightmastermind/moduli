// A template page inside a SUBFOLDER of Templates (Templates/Schedule, 2026-10-12: "there should be a
// page for each template") is still a template — location is the marker, and a folder under the
// Templates folder is still under it. A page in an unrelated folder is not.
import { describe, it, expect } from "vitest";
import { templatesByKind, templateOccurrences } from "../helpers/templateHelpers";

const lookups = {
  foldersById: {
    "tpl-f": { id: "tpl-f", gridId: "g1", name: "Templates", meta: { protected: true } },
    sched: { id: "sched", gridId: "g1", name: "Schedule", parentId: "tpl-f" },
    deeper: { id: "deeper", gridId: "g1", name: "Weekdays", parentId: "sched" },
    notes: { id: "notes", gridId: "g1", name: "Notes", parentId: "root" },
  },
  occurrencesById: {
    top: { id: "top", parentId: "tpl-f", moduleId: "m-board" },
    sub: { id: "sub", parentId: "sched", moduleId: "m-board" },
    deep: { id: "deep", parentId: "deeper", moduleId: "m-board" },
    loose: { id: "loose", parentId: "notes", moduleId: "m-board" },
  },
  modulesById: { "m-board": { id: "m-board", role: "page", kind: "board", label: "x" } },
};

describe("templates in subfolders of Templates", () => {
  it("lists pages in any folder under Templates", () => {
    expect(templatesByKind(lookups, "g1", "board").map((o) => o.id).sort()).toEqual(["deep", "sub", "top"]);
  });
  it("never lists a page outside the Templates tree", () => {
    expect(templateOccurrences(lookups, "g1").map((o) => o.id)).not.toContain("loose");
  });
  it("a folder cycle cannot hang the walk", () => {
    const cyc = { ...lookups, foldersById: { ...lookups.foldersById, a: { id: "a", parentId: "b" }, b: { id: "b", parentId: "a" } },
      occurrencesById: { ...lookups.occurrencesById, c: { id: "c", parentId: "a", moduleId: "m-board" } } };
    expect(templateOccurrences(cyc, "g1").map((o) => o.id)).not.toContain("c");
  });
});
