// A textblock the doc owns is DELETED by its embed's Remove, like an owned row (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { embedRemoval } from "../helpers/embedRegistry.js";
const src = fs.readFileSync(path.join(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf8");
describe("textblock embed removal", () => {
  it("the textblock branch routes Remove through the ownership rule", () => {
    const tb = src.slice(src.indexOf("<ModuleTextblock"), src.indexOf(') : mod?.role === "instance"'));
    expect(tb).toMatch(/embedOnDelete=\{removeRow\}/);
    expect(tb).toMatch(/embedDeleteLabel=/);
  });
  it("ownership decides: owned deletes, placed-from-elsewhere unlinks", () => {
    expect(embedRemoval({ parentId: "doc1" }, "doc1")).toBe("delete");
    expect(embedRemoval({ parentId: "board" }, "doc1")).toBe("unlink");
  });
});
