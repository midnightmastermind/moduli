import { describe, it, expect } from "vitest";
import { planMerge, repointFields } from "../migrations/0366-merge-duplicate-people.mjs";
const f = { foundVia: "via", relationship: "rel", notes: "notes", instagram: "ig" };
describe("0366 planMerge", () => {
  it("fills empty fields, keeps a second Instagram handle in the notes, unions photos", () => {
    const keep = { fields: { ig: { value: "markgarwick" }, files: { value: ["p1"] }, via: { value: ["facebook"] } } };
    const dup = { fields: { ig: { value: "solfyre_alchemy" }, city: { value: "Madison" }, files: { value: ["p2"] }, via: { value: ["instagram"] } } };
    const set = planMerge(keep, dup, f);
    expect(set["fields.city"].value).toBe("Madison");
    expect(set["fields.notes"].value).toBe("Also on Instagram: @solfyre_alchemy");
    expect(set["fields.files"].value).toEqual(["p1", "p2"]);
    expect(set["fields.via"].value).toEqual(["facebook", "instagram"]);
    expect(set["fields.ig"]).toBeUndefined();
  });
  it("the same handle is not repeated in the notes", () => {
    expect(planMerge({ fields: { ig: { value: "a" } } }, { fields: { ig: { value: "A" } } }, f)["fields.notes"]).toBeUndefined();
  });
  it("repoints a reference to the kept card, deduping a list", () => {
    expect(repointFields({ p: { value: ["dup", "keep", "x"] }, q: { value: "dup" }, r: { value: "other" } }, "dup", "keep"))
      .toEqual({ p: { value: ["keep", "x"] }, q: { value: "keep" } });
  });
});
