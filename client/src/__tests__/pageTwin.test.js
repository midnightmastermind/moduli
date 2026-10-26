import { describe, it, expect } from "vitest";
import { pageTwin, twinRenameWrite } from "../helpers/pageTwin";

const occs = {
  page: { id: "page", moduleId: "mp", occurrences: ["sec"] },
  sec: { id: "sec", moduleId: "ms", parentId: "page", occurrences: [] },
  page2: { id: "page2", moduleId: "mp2", occurrences: ["a", "b"] },
  a: { id: "a", moduleId: "ma", parentId: "page2" }, b: { id: "b", moduleId: "mb", parentId: "page2" },
};
const mods = {
  mp: { id: "mp", role: "page", label: "bo 1" }, ms: { id: "ms", role: "container", label: "bo 1" },
  mp2: { id: "mp2", role: "page", label: "X" }, ma: { id: "ma", role: "container", label: "X" }, mb: { id: "mb", role: "container", label: "Y" },
};
const look = { getOcc: (id) => occs[id], getMod: (id) => mods[id] };

describe("a page and its one same-named section are renamed together", () => {
  it("finds the page of a lone same-named section, and the section of the page", () => {
    expect(pageTwin(occs.sec, look).occurrence.id).toBe("page");
    expect(pageTwin(occs.page, look).occurrence.id).toBe("sec");
  });
  it("not when the page holds more than one section, or the names differ", () => {
    expect(pageTwin(occs.a, look)).toBeNull();
    expect(pageTwin(occs.page2, look)).toBeNull();
    expect(pageTwin(occs.sec, { ...look, getMod: (id) => (id === "mp" ? { ...mods.mp, label: "other" } : mods[id]) })).toBeNull();
  });
  it("writes the twin's own label when it has one, else its module's", () => {
    expect(twinRenameWrite({ occurrence: { id: "p", label: "old" }, module: mods.mp }, "new")).toEqual({ occurrence: { id: "p", label: "new" } });
    expect(twinRenameWrite({ occurrence: { id: "p" }, module: mods.mp }, "new").module.label).toBe("new");
  });
});
