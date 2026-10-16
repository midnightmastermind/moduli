import { describe, it, expect } from "vitest";
import { pickKeeper, extOf } from "../migrations/0410-one-file-per-book.mjs";

describe("0410 pickKeeper", () => {
  const f = (occId, ext) => ({ occId, ext });
  it("keeps the best format even when the row's main is a worse one", () => {
    expect(pickKeeper([f("a", "epub"), f("b", "azw")], "b")).toBe("a");
  });
  it("the main breaks a tie between equal formats", () => {
    expect(pickKeeper([f("a", "azw"), f("b", "mobi")], "b")).toBe("b");
  });
  it("else the best format: epub > azw3 > mobi/azw > pdf", () => {
    expect(pickKeeper([f("p", "pdf"), f("m", "mobi"), f("e", "epub")], null)).toBe("e");
    expect(pickKeeper([f("p", "pdf"), f("k", "azw3")], "missing")).toBe("k");
  });
  it("reads the extension off a file name", () => {
    expect(extOf("Dune - Frank Herbert.azw3")).toBe("azw3");
    expect(extOf("no extension")).toBe("");
  });
});
