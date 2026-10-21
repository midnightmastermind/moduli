import { describe, it, expect } from "vitest";
import { styleKeysOf } from "../helpers/operationActions";
import fs from "fs";
import path from "path";

describe("a template clone keeps its source's look", () => {
  it("styleKeysOf carries the style keys and nothing else", () => {
    expect(styleKeysOf({ label: "x", styleMode: "own", ownStyle: { bg: "#98431f" }, childInstanceStyle: null }))
      .toEqual({ styleMode: "own", ownStyle: { bg: "#98431f" } });
  });
  it("APPLY_TEMPLATE places the source's OWN module, so the copy has its look by construction (2026-10-21)", () => {
    // Was: a clone module copied the source's style keys (a Sleep in a passed 5am slot
    // showed the slot's red because its clone had none). A copy now shares the module.
    const ops = fs.readFileSync(path.resolve(__dirname, "../helpers/operationActions.js"), "utf8");
    const bind = fs.readFileSync(path.resolve(__dirname, "../state/bindSocketToStore.js"), "utf8");
    expect(ops).toMatch(/const cloneModId = srcModId;/);
    expect(ops).toMatch(/templateExists: true/);
    // A NEW module minted through CREATE_ITEM still gets its template's style keys.
    expect(bind).toMatch(/\.\.\.styleKeysOf\(effect\.template\)/);
    expect(bind).toMatch(/effect\.template\?\.id && !effect\.templateExists/);
  });
});
