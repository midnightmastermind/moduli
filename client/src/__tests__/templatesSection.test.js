// client/src/__tests__/templatesSection.test.js
//
// Tests the two DECISIONS as pure functions rather than through the DOM — the
// compatibility filter and the default apply mode are the logic worth pinning;
// a render test of a dropdown is slow and brittle by comparison.
import { describe, it, expect } from "vitest";
import { applicableTemplates, APPLY_MODES, DEFAULT_APPLY_MODE } from "../ui/TemplatesSection";

const lookups = {
  foldersById: { "tpl-f": { id: "tpl-f", gridId: "g1", name: "Templates", meta: { protected: true } } },
  occurrencesById: {
    boardTpl: { id: "boardTpl", parentId: "tpl-f", moduleId: "m-board" },
    docTpl:   { id: "docTpl",   parentId: "tpl-f", moduleId: "m-doc" },
  },
  modulesById: {
    "m-board": { id: "m-board", role: "page", kind: "board", label: "Schedule Template" },
    "m-doc":   { id: "m-doc",   role: "page", kind: "doc",   label: "Day Page" },
    "m-host":  { id: "m-host",  role: "page", kind: "board", label: "Some Board" },
    "m-dochost": { id: "m-dochost", role: "page", kind: "doc", label: "Some Doc" },
  },
};
const boardHost = { id: "host", moduleId: "m-host" };
const docHost = { id: "dhost", moduleId: "m-dochost" };

describe("which templates a page is offered", () => {
  it("offers a board template to a board page", () => {
    expect(applicableTemplates(lookups, "g1", boardHost).map(t => t.id)).toEqual(["boardTpl"]);
  });

  it("does NOT offer a doc template to a board page", () => {
    // Dropping a textmap body into a container list has no sensible meaning, so
    // it is not offered at all rather than offered and then failing.
    expect(applicableTemplates(lookups, "g1", boardHost).map(t => t.id)).not.toContain("docTpl");
  });

  it("offers a doc template to a doc page", () => {
    expect(applicableTemplates(lookups, "g1", docHost).map(t => t.id)).toEqual(["docTpl"]);
  });

  it("offers nothing when the host has no resolvable kind", () => {
    expect(applicableTemplates(lookups, "g1", { id: "x", moduleId: "nope" })).toEqual([]);
    expect(applicableTemplates(lookups, "g1", null)).toEqual([]);
  });

  it("never offers a template to ITSELF", () => {
    // A template is an ordinary page, so opening one in a panel shows this same
    // section — applying it to itself would clone it into itself.
    const self = lookups.occurrencesById.boardTpl;
    expect(applicableTemplates(lookups, "g1", self).map(t => t.id)).not.toContain("boardTpl");
  });
});

describe("apply mode", () => {
  it("defaults to merge — structure flows, the user's content is untouched", () => {
    expect(DEFAULT_APPLY_MODE).toBe("merge");
  });

  it("offers exactly merge and copy", () => {
    expect(APPLY_MODES.map(m => m.value)).toEqual(["merge", "append"]);
  });

  it("labels the copy mode without exposing the wire value", () => {
    expect(APPLY_MODES.find(m => m.value === "append").label).toBe("Copy");
  });
});
