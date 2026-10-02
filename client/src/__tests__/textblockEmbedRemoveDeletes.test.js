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

import { hostOccurrenceIdOf } from "../helpers/embedRegistry.js";
describe("hostOccurrenceIdOf", () => {
  it("reads the editor's own stamp first (a doc page has no card around it)", () => {
    const dom = { getAttribute: (k) => (k === "data-host-occ" ? "page1" : null), parentElement: null };
    expect(hostOccurrenceIdOf({ view: { dom } })).toBe("page1");
  });
  it("falls back to the nearest card", () => {
    const dom = { getAttribute: () => null, parentElement: { closest: () => ({ getAttribute: () => "card1" }) } };
    expect(hostOccurrenceIdOf({ view: { dom } })).toBe("card1");
  });
});

describe("copies dropped into a doc", () => {
  const ed = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
  it("a copy is owned by the doc, its children by the copy", () => {
    expect(ed).toMatch(/deepCopyOcc\(occsById\[occurrenceId\], occurrence\?\.id\)/);
    expect(ed).toMatch(/deepCopyOcc\(occsById\[cid\], copyId\)/);
    expect(ed).toMatch(/parentId: parentId \|\| null,/);
  });
  it("a copy-link is owned by the doc too", () => {
    expect(ed).toMatch(/parentId: occurrence\?\.id \|\| null,\s*\/\/ owned by this doc/);
  });
});
