// A flow flip re-runs the trackers that read the field — it fires the field's
// change exactly as a value commit does (2026-10-03: Spent stayed 0 until reload).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const src = fs.readFileSync(path.join(__dirname, "../ui/FieldRenderer.jsx"), "utf8");
const body = (name) => { const a = src.indexOf(`const ${name} = useCallback(`); return src.slice(a, src.indexOf("}, [", a)); };
describe("FieldRenderer flow change", () => {
  it("passes triggerField for the field it changed", () => {
    expect(body("handleFlowChange")).toMatch(/triggerField: \[\{ fieldId: field\.id, value: currentValue, instanceId: occurrence\.moduleId \}\]/);
  });
  it("the value commit does the same (the control)", () => {
    expect(body("_commitNow")).toMatch(/triggerField: \[\s*\{ fieldId: field\.id, value: newValue, instanceId: occurrence\.moduleId \}/);
  });
  it("an affix pick (presentation only) still fires nothing", () => {
    expect(body("handleAffixChange")).not.toMatch(/triggerField/);
  });
});
