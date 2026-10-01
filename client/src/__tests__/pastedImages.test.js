// A picture pasted into a document becomes an image ARTIFACT (user, 2026-10-01).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hasImageNode, imagesToEmbeds, imageLabel } from "../helpers/pastedImages";

const slice = [
  { type: "paragraph", content: [{ type: "text", text: "intro" }] },
  { type: "image", attrs: { src: "https://x.test/a.jpg", alt: "Rosa Alba" } },
];
describe("pasted images", () => {
  it("finds an image anywhere in a pasted fragment", () => {
    expect(hasImageNode(slice)).toBe(true);
    expect(hasImageNode([{ type: "paragraph", content: [{ type: "text", text: "no" }] }])).toBe(false);
  });
  it("replaces each image with an embed of the minted artifact, in place", () => {
    const seen = [];
    const out = imagesToEmbeds(slice, (src, alt) => { seen.push([src, alt]); return "occ-1"; });
    expect(out.map((n) => n.type)).toEqual(["paragraph", "moduleEmbed"]);
    expect(out[1].attrs.occurrenceId).toBe("occ-1");
    expect(seen).toEqual([["https://x.test/a.jpg", "Rosa Alba"]]);
  });
  // The control: a mint that declines leaves the picture as it was.
  it("keeps the image when nothing could be minted", () => {
    expect(imagesToEmbeds(slice, () => null)[1].type).toBe("image");
  });
  it("a generic 'Image' alt is not a caption", () => {
    expect(imageLabel("Image")).toBe("");
    expect(imageLabel("Rosa Alba")).toBe("Rosa Alba");
  });
  it("the editor converts on paste", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/ui/Editor.jsx"), "utf8");
    expect(src).toMatch(/transformPasted:[\s\S]{0,400}hasImageNode[\s\S]{0,1500}imagesToEmbeds/);
  });
});
