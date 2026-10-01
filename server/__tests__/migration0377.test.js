import { describe, it, expect } from "vitest";
import { replaceImages } from "../migrations/0377-doc-images-become-artifacts.mjs";
describe("0377 replaceImages", () => {
  const doc = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    { type: "image", attrs: { src: "https://x.test/a.jpg", alt: "A" } },
    { type: "paragraph", content: [{ type: "text", text: "after" }] },
  ] };
  it("swaps each image for an embed of the artifact, in the same spot", () => {
    const { doc: out, count } = replaceImages(doc, () => "occ-1");
    expect(count).toBe(1);
    expect(out.content.map((n) => n.type)).toEqual(["paragraph", "moduleEmbed", "paragraph"]);
    expect(out.content[1].attrs.occurrenceId).toBe("occ-1");
  });
  // The control: the text around it is untouched, and a doc with no image is identical.
  it("leaves everything else alone", () => {
    const { doc: out } = replaceImages(doc, () => "x");
    expect(out.content[0]).toEqual(doc.content[0]);
    const plain = { type: "doc", content: [{ type: "paragraph" }] };
    expect(replaceImages(plain, () => "x")).toEqual({ doc: plain, count: 0 });
  });
});
