import { describe, it, expect } from "vitest";
import { styleKeysOf } from "../helpers/operationActions";
import fs from "fs";
import path from "path";

describe("a template clone keeps its source's look", () => {
  it("styleKeysOf carries the style keys and nothing else", () => {
    expect(styleKeysOf({ label: "x", styleMode: "own", ownStyle: { bg: "#98431f" }, childInstanceStyle: null }))
      .toEqual({ styleMode: "own", ownStyle: { bg: "#98431f" } });
  });
  it("APPLY_TEMPLATE's template and the CREATE_ITEM module both spread it", () => {
    const ops = fs.readFileSync(path.resolve(__dirname, "../helpers/operationActions.js"), "utf8");
    const bind = fs.readFileSync(path.resolve(__dirname, "../state/bindSocketToStore.js"), "utf8");
    expect(ops).toMatch(/fieldBindings: Array\.isArray\(srcMod\.fieldBindings\)[^\n]*\n[\s\S]{0,400}\.\.\.styleKeysOf\(srcMod\)/);
    expect(bind).toMatch(/\.\.\.styleKeysOf\(effect\.template\)/);
  });
});
