import { describe, it, expect } from "vitest";
import { planWidenings, COLLECTION_ROLE, WIDE } from "../migrations/0264-widen-role-filtered-option-sources.mjs";

// The live shape: Author is `type: occurrence`, its optionsSource collection is
// $allInstances, and every one of its 538 values points at a role:"artifact"
// row — so the dropdown offers nothing and each value renders as a raw id.
const field = (id, name, collection) => ({
  id, name, type: "occurrence",
  meta: collection ? { optionsSource: { collection } } : {},
});
const holder = (fieldId, ...vals) => ({ fields: { [fieldId]: { value: vals.length > 1 ? vals : vals[0] } } });
const roles = (m) => (id) => m[id] || null;

describe("planWidenings", () => {
  it("widens a collection that excludes the role its own values use", () => {
    const out = planWidenings({
      fields: [field("f1", "Author", "$allInstances")],
      occurrences: [holder("f1", "a1"), holder("f1", "a2")],
      roleOfOccurrence: roles({ a1: "artifact", a2: "artifact" }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Author", from: "$allInstances", to: WIDE, offeredRole: "instance" });
    expect(out[0].excluded).toEqual({ artifact: 2 });
  });

  it("LEAVES a correctly-scoped dropdown alone — never narrows, never churns", () => {
    // The control. Without it "widen everything" passes the test above.
    const out = planWidenings({
      fields: [field("f1", "Mood", "$allInstances")],
      occurrences: [holder("f1", "m1")],
      roleOfOccurrence: roles({ m1: "instance" }),
    });
    expect(out).toEqual([]);
  });

  it("ignores a field that already uses an unfiltered collection", () => {
    const out = planWidenings({
      fields: [field("f1", "Files", "$allItems")],
      occurrences: [holder("f1", "x1")],
      roleOfOccurrence: roles({ x1: "artifact" }),
    });
    expect(out).toEqual([]);
  });

  it("ignores a field with no options source at all", () => {
    // Album/Artist/Songs carry values but configure no collection — a different
    // render path, and not this migration's business.
    const out = planWidenings({
      fields: [field("f1", "Album", null)],
      occurrences: [holder("f1", "x1")],
      roleOfOccurrence: roles({ x1: "artifact" }),
    });
    expect(out).toEqual([]);
  });

  it("a DANGLING value is not a reason to widen — that is a different defect", () => {
    // 0114's class: a reference to an occurrence that no longer exists. Widening
    // the collection cannot fix it, and counting it as evidence would rewrite a
    // correctly-scoped field on the strength of broken data.
    const out = planWidenings({
      fields: [field("f1", "Author", "$allInstances")],
      occurrences: [holder("f1", "gone")],
      roleOfOccurrence: roles({}),
    });
    expect(out).toEqual([]);
  });

  it("a field carrying NO values is never touched", () => {
    const out = planWidenings({
      fields: [field("f1", "Author", "$allInstances")],
      occurrences: [],
      roleOfOccurrence: roles({}),
    });
    expect(out).toEqual([]);
  });

  it("handles multi-select arrays, which is how most of these fields store", () => {
    const out = planWidenings({
      fields: [field("f1", "Author", "$allInstances")],
      occurrences: [holder("f1", "a1", "a2")],
      roleOfOccurrence: roles({ a1: "artifact", a2: "instance" }),
    });
    // MIXED: one value the collection can see, one it cannot — still too narrow.
    expect(out).toHaveLength(1);
    expect(out[0].excluded).toEqual({ artifact: 1 });
  });

  it("the role map mirrors the client's COLLECTION_KEYS", () => {
    // If these drift, the migration widens the wrong things or nothing at all.
    expect(COLLECTION_ROLE.$allInstances).toBe("instance");
    expect(COLLECTION_ROLE.$allItems).toBe("all");
    expect(COLLECTION_ROLE.$allContainers).toBe("container");
  });
});
