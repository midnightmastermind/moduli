// 0407: the converted epub joins the row's files and becomes its main file; the original stays.
import { describe, it, expect } from "vitest";
import { attachEpub } from "../migrations/0407-attach-converted-epubs.mjs";

const F = { files: "fFiles", formats: "fFormats" };
describe("attachEpub", () => {
  it("adds the epub, makes it main, keeps the original and other keys", () => {
    const out = attachEpub({ fFiles: { value: ["azw1"], main: "azw1", flow: "replace" }, fFormats: { value: "azw" }, other: { value: 1 } }, F, "ep1");
    expect(out.fFiles).toEqual({ value: ["azw1", "ep1"], main: "ep1", flow: "replace" });
    expect(out.fFormats.value).toBe("azw, epub");
    expect(out.other).toEqual({ value: 1 });
  });
  it("is idempotent", () => {
    const once = attachEpub({ fFiles: { value: ["azw1"] } }, F, "ep1");
    expect(attachEpub(once, F, "ep1").fFiles.value).toEqual(["azw1", "ep1"]);
    expect(attachEpub(once, F, "ep1").fFormats.value).toBe("epub");
  });
  it("a row with no files yet gets the epub as its only, main file", () => {
    expect(attachEpub({}, { files: "fFiles" }, "ep1").fFiles).toEqual({ value: ["ep1"], flow: "replace", main: "ep1" });
  });
});
