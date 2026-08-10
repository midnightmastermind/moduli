// 0064 writes tag values onto protected live data, so the tests are about the
// SELECTOR: what it picks, and — carrying more weight — what it refuses to touch.
import { describe, it, expect } from "vitest";
import {
  deriveTags, resolveFieldByName, missingOptionValues, readValue,
} from "../migrations/0064-universal-fields-and-tags.mjs";

const TAGS = "f-tags";
const BC = "f-bc";
const mods = (rows) => new Map(rows.map((m) => [m.id, m]));
const folders = (rows) => new Map(rows.map((f) => [f.id, f]));
const run = (occurrences, opts = {}) => deriveTags({
  occurrences,
  modulesById: opts.modulesById || mods([]),
  foldersById: opts.foldersById || folders([]),
  boardCategoryFieldId: "boardCategoryFieldId" in opts ? opts.boardCategoryFieldId : BC,
  tagsFieldId: TAGS,
});

describe("0064 resolveFieldByName", () => {
  const fields = [
    { id: "a", name: "Due", type: "number" },
    { id: "b", name: "Due", type: "date" },
    { id: "c", name: "Tags", type: "select" },
  ];

  it("discriminates two same-named fields by TYPE", () => {
    // poms grid really does carry two fields called "Due"; name alone picks
    // whichever Mongo returns first (the 0053 trap).
    expect(resolveFieldByName(fields, "Due", "date").id).toBe("b");
  });

  it("returns null when the name is ambiguous WITHOUT a type, so the caller fails closed", () => {
    expect(resolveFieldByName(fields, "Due")).toBeNull();
  });

  it("returns null for a name nothing carries", () => {
    expect(resolveFieldByName(fields, "Nope", "select")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(resolveFieldByName(fields, "tags", "select").id).toBe("c");
  });
});

describe("0064 deriveTags — board category", () => {
  it("tags an occurrence with its own board-category value", () => {
    const occs = [{ id: "o1", fields: { [BC]: { value: "emotion" } } }];
    expect(run(occs).get("o1")).toEqual(["emotion"]);
  });

  it("handles a multi-select category as several tags", () => {
    const occs = [{ id: "o1", fields: { [BC]: { value: ["grocery", "ingredient"] } } }];
    expect(run(occs).get("o1")).toEqual(["grocery", "ingredient"]);
  });

  it("NEVER tags a feed copy — feedSync re-mints it from its source", () => {
    // THE DISCRIMINATING REFUSAL. 156 of poms grid's 538 board-category
    // occurrences are copies; a tag written here is a write to something about
    // to be overwritten.
    const occs = [{ id: "o1", meta: { feedSourceId: "src" }, fields: { [BC]: { value: "emotion" } } }];
    expect(run(occs).size).toBe(0);
  });

  it("NEVER overwrites a tag the user already set", () => {
    const occs = [{ id: "o1", fields: { [BC]: { value: "emotion" }, [TAGS]: { value: ["mine"] } } }];
    expect(run(occs).size).toBe(0);
  });

  it("treats an EMPTY tags array as untagged, so a cleared field still fills", () => {
    const occs = [{ id: "o1", fields: { [BC]: { value: "emotion" }, [TAGS]: { value: [] } } }];
    expect(run(occs).get("o1")).toEqual(["emotion"]);
  });

  it("does nothing when the grid has no Board Category field", () => {
    const occs = [{ id: "o1", fields: { [BC]: { value: "emotion" } } }];
    expect(run(occs, { boardCategoryFieldId: null }).size).toBe(0);
  });
});

describe("0064 deriveTags — file kind from the Files folder", () => {
  const modulesById = mods([{ id: "m-art", role: "artifact" }, { id: "m-inst", role: "instance" }]);
  const foldersById = folders([
    { id: "fld-img", name: "Images" },
    { id: "fld-doc", name: "Documents" },
    { id: "fld-other", name: "Tasks" },
  ]);

  it("maps the folder name to a kind tag", () => {
    const occs = [
      { id: "a", moduleId: "m-art", parentId: "fld-img" },
      { id: "b", moduleId: "m-art", parentId: "fld-doc" },
    ];
    const out = run(occs, { modulesById, foldersById });
    expect(out.get("a")).toEqual(["image"]);
    expect(out.get("b")).toEqual(["document"]);
  });

  it("ignores a NON-artifact sitting in the same folder", () => {
    const occs = [{ id: "a", moduleId: "m-inst", parentId: "fld-img" }];
    expect(run(occs, { modulesById, foldersById }).size).toBe(0);
  });

  it("ignores a folder that is not one of the Files kinds", () => {
    const occs = [{ id: "a", moduleId: "m-art", parentId: "fld-other" }];
    expect(run(occs, { modulesById, foldersById }).size).toBe(0);
  });
});

describe("0064 deriveTags — routine dimension", () => {
  const modulesById = mods([{ id: "m-page", role: "page", label: "Routines" }, { id: "m-c" }]);
  const world = [
    { id: "routines", moduleId: "m-page", occurrences: ["dim-phys"] },
    { id: "dim-phys", moduleId: "m-c", label: "Physical", occurrences: ["sub"] },
    { id: "sub", moduleId: "m-c", label: "Nutrition", occurrences: ["act"] },
    { id: "act", moduleId: "m-c", label: "Drink Water" },
  ];

  it("tags the WHOLE subtree with its dimension, not just direct children", () => {
    // The dimensions hold sub-category containers, and the actions are
    // grandchildren — measured 9 dimensions / 31 direct children on poms grid,
    // with the ~97 actions one level deeper.
    const out = run(world, { modulesById });
    expect(out.get("sub")).toEqual(["physical"]);
    expect(out.get("act")).toEqual(["physical"]);
  });

  it("does not tag the dimension container itself", () => {
    expect(run(world, { modulesById }).has("dim-phys")).toBe(false);
  });

  it("reads the dimension NAME from the data, so a renamed one follows", () => {
    const renamed = world.map((o) => (o.id === "dim-phys" ? { ...o, label: "Bodily" } : o));
    expect(run(renamed, { modulesById }).get("act")).toEqual(["bodily"]);
  });

  it("survives a cycle in occurrences[] instead of hanging", () => {
    const cyclic = [
      { id: "routines", moduleId: "m-page", occurrences: ["dim"] },
      { id: "dim", moduleId: "m-c", label: "Physical", occurrences: ["a"] },
      { id: "a", moduleId: "m-c", occurrences: ["b"] },
      { id: "b", moduleId: "m-c", occurrences: ["a"] },
    ];
    const out = run(cyclic, { modulesById });
    expect(out.get("a")).toEqual(["physical"]);
    expect(out.get("b")).toEqual(["physical"]);
  });
});

describe("0064 deriveTags — combining rules", () => {
  it("merges tags from several rules onto one occurrence, deduped and sorted", () => {
    const modulesById = mods([{ id: "m-page", role: "page", label: "Routines" }, { id: "m-art", role: "artifact" }]);
    const foldersById = folders([{ id: "fld-img", name: "Images" }]);
    const occs = [
      { id: "routines", moduleId: "m-page", occurrences: ["dim"] },
      { id: "dim", label: "Physical", occurrences: ["a"] },
      { id: "a", moduleId: "m-art", parentId: "fld-img", fields: { [BC]: { value: "movement" } } },
    ];
    expect(run(occs, { modulesById, foldersById }).get("a")).toEqual(["image", "movement", "physical"]);
  });

  it("returns an EMPTY plan for a grid with none of the three sources", () => {
    // test grid 1 is exactly this — it gets the universalFieldIds stamp only.
    expect(run([{ id: "a" }, { id: "b" }]).size).toBe(0);
  });
});

describe("0064 missingOptionValues", () => {
  it("returns only values the field does not already offer", () => {
    const field = { meta: { options: [{ value: "journal" }, { value: "idea" }] } };
    expect(missingOptionValues(field, ["idea", "emotion", "image"])).toEqual(["emotion", "image"]);
  });

  it("reads the MANUAL optionsSource shape when the grid uses it", () => {
    // Some grids store options at meta.optionsSource.values and some at
    // meta.options; appending to the wrong one leaves a list nothing reads.
    const field = { meta: { optionsSource: { values: [{ value: "emotion" }] }, options: [] } };
    expect(missingOptionValues(field, ["emotion", "grocery"])).toEqual(["grocery"]);
  });

  it("is case-insensitive about what already exists", () => {
    const field = { meta: { options: [{ value: "Emotion" }] } };
    expect(missingOptionValues(field, ["emotion"])).toEqual([]);
  });

  it("handles a field with no options at all", () => {
    expect(missingOptionValues({}, ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("0064 readValue", () => {
  it("reads both the wrapper and the bare value, and treats an array as bare", () => {
    expect(readValue({ fields: { x: { value: 5 } } }, "x")).toBe(5);
    expect(readValue({ fields: { x: 5 } }, "x")).toBe(5);
    expect(readValue({ fields: { x: ["a"] } }, "x")).toEqual(["a"]);
    expect(readValue({}, "x")).toBeUndefined();
  });
});
