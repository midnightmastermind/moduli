import { describe, it, expect } from "vitest";
import { planCopySync } from "../migrations/0356-people-copies-take-their-photos.mjs";

const modulesById = new Map([["m", { id: "m", fieldBindings: [{ fieldId: "pic", role: "media" }, { fieldId: "files", role: "files" }, { fieldId: "name", role: "input" }] }]]);
const src = { id: "s", moduleId: "m", meta: { source: "social-import" },
  fields: { pic: { value: "a1", flow: "in" }, files: { value: ["a1"], main: "a1", flow: "in" }, name: { value: "Inês" } } };

describe("0356 planCopySync", () => {
  it("copies the photo onto a feed copy that has none", () => {
    const copy = { id: "c", moduleId: "m", meta: { feedSourceId: "s" }, fields: { name: { value: "Inês" } } };
    const [p] = planCopySync({ occurrences: [src, copy], modulesById });
    expect(p.copyId).toBe("c");
    expect(p.set["fields.pic"].value).toBe("a1");
    expect(p.set["fields.files"].main).toBe("a1");
  });
  it("covers linked-group copies and repairs a mojibake name", () => {
    const s2 = { ...src, linkedGroupId: "g" };
    const copy = { id: "c", moduleId: "m", linkedGroupId: "g", fields: { name: { value: "InÃªs" } } };
    const [p] = planCopySync({ occurrences: [s2, copy], modulesById });
    expect(p.set["fields.name.value"]).toBe("Inês");
    expect(p.why).toEqual(["photo", "name"]);
  });
  it("skips a copy that already matches, and never touches unrelated rows (control)", () => {
    const copy = { id: "c", moduleId: "m", meta: { feedSourceId: "s" }, fields: { ...src.fields } };
    const other = { id: "x", moduleId: "m", meta: { feedSourceId: "someone-else" }, fields: {} };
    expect(planCopySync({ occurrences: [src, copy, other], modulesById })).toEqual([]);
  });
});
