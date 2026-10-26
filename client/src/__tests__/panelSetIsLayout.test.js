import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { incomingGridPatch } from "../helpers/localLayout";

describe("which panels a device shows is its own layout", () => {
  it("another device's panel add/remove does not reach this one", () => {
    const out = incomingGridPatch({ occurrences: ["a", "b", "new"], name: "poms grid" }, {});
    expect(out.occurrences).toBeUndefined();
    expect(out.name).toBe("poms grid");   // control: a non-layout key still arrives
  });
  it("Remove from grid takes the panel off this device's list and leaves the panel", () => {
    const src = readFileSync(new URL("../modules/ModulePanel.jsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const handleRemovePanel"), src.indexOf("const handlePanelContextMenu"));
    expect(body).toMatch(/removePanelFromGrid\(/);
    expect(body).not.toMatch(/removeOccurrence\(/);
  });
});
