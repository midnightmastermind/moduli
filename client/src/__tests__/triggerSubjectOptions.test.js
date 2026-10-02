// A stored trigger subject the editor does not offer still shows as itself.
// Six live onMove triggers store `occurrence`; the dropdown read "Module" (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { subjectOptions, TRIGGER_SUBJECT_TYPES } from "../helpers/triggerTypes";

describe("subjectOptions", () => {
  it("adds a stored subject the list lacks", () => {
    expect(subjectOptions("occurrence")).toEqual([...TRIGGER_SUBJECT_TYPES, "occurrence"]);
  });
  it("is the offered list for an offered or empty subject (the control)", () => {
    expect(subjectOptions("module")).toBe(TRIGGER_SUBJECT_TYPES);
    expect(subjectOptions("")).toBe(TRIGGER_SUBJECT_TYPES);
    expect(subjectOptions(undefined)).toBe(TRIGGER_SUBJECT_TYPES);
  });
  it("the editor's dropdown is drawn from it, and its labelled list matches the offered one", () => {
    const src = fs.readFileSync(path.join(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");
    expect(src).toMatch(/subjectOptions\(trigObj\.subjectType\)\.map/);
    const labelled = [...src.slice(src.indexOf("const SUBJECT_TYPES = ["), src.indexOf("];", src.indexOf("const SUBJECT_TYPES = ["))).matchAll(/value: "([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(labelled).toEqual(TRIGGER_SUBJECT_TYPES);
  });
});
