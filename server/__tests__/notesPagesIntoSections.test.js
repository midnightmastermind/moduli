import { describe, it, expect } from "vitest";
import { buildTree, findPath, isEmptyBlock, PLACEMENT, CAPTIONS, SUNWHEEL_MODULE } from "../migrations/0379-notes-pages-into-sections.mjs";

const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const img = (id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } });
const IMGS = new Set(["i1", "i2"]);

const page = [
  { occId: "title", blocks: [h(1, "Philosopher’s Stone")] },
  { occId: "intro", blocks: [h(2, "Introduction"), p("unions")] },
  { occId: "opus", blocks: [h(2, "The Magnum Opus")] },
  { occId: "nig", blocks: [h(3, "1. Nigredo"), img("i1"), img("i2"), h(3, "External (Lab)"), p("blacken"), h(3, "Internal (Psyche)"), p("ego")] },
  { occId: "loose", blocks: [p("no heading — joins the section before it")] },
];
const build = () => buildTree({ pageLabel: "Philosopher’s Stone", textblocks: page, isImage: (id) => IMGS.has(id) });

describe("0379 buildTree — a page of textblocks becomes sections", () => {
  it("the page title textblock goes; its name is the root container's label", () => {
    const { root, dropped } = build();
    expect(root.label).toBe("Philosopher’s Stone");
    expect(dropped).toContain("title");
  });

  it("an H2 opens a section named by its heading, and the heading leaves the text", () => {
    const { root, edited } = build();
    const intro = findPath(root, ["Introduction"]);
    expect(intro.children).toEqual([{ kind: "tb", occId: "intro" }]);
    expect(edited.get("intro")).toEqual([p("unions")]);
  });

  it("a heading-only textblock becomes just its section — the textblock goes", () => {
    const { root, dropped } = build();
    expect(findPath(root, ["The Magnum Opus"])).toBeTruthy();
    expect(dropped).toContain("opus");
  });

  it("an H3 nests inside the H2 before it", () => {
    const { root } = build();
    expect(findPath(root, ["The Magnum Opus", "1. Nigredo"])).toBeTruthy();
  });

  it("a picture-holding textblock splits at its inner headings, pictures out of the text", () => {
    const { root, created, dropped } = build();
    const stage = findPath(root, ["The Magnum Opus", "1. Nigredo"]);
    expect(stage.children.filter((c) => c.kind === "img").map((c) => c.occId)).toEqual(["i1", "i2"]);
    const lab = findPath(root, ["The Magnum Opus", "1. Nigredo", "External"]);
    const psy = findPath(root, ["The Magnum Opus", "1. Nigredo", "Internal"]);
    expect(lab.children[0].kind).toBe("tbNew");
    expect(created.find((c) => c.key === lab.children[0].key).blocks).toEqual([p("blacken")]);
    expect(created.find((c) => c.key === psy.children[0].key).blocks).toEqual([p("ego")]);
    // the original textblock held nothing before its first inner heading
    expect(dropped).toContain("nig");
  });

  // CONTROL: text with no heading is not lost — it joins the current section.
  it("a textblock with no heading joins the section it follows", () => {
    const { root } = build();
    const stage = findPath(root, ["The Magnum Opus", "1. Nigredo"]);
    expect(stage.children.some((c) => c.kind === "tb" && c.occId === "loose")).toBe(true);
  });

  it("empty means no text and nothing embedded", () => {
    expect(isEmptyBlock(p(""))).toBe(true);
    expect(isEmptyBlock(p("x"))).toBe(false);
    expect(isEmptyBlock({ type: "table" })).toBe(false);
  });
});

describe("0379 plan — every placed picture has a caption", () => {
  it("each PLACEMENT key except the replaced sunwheel is captioned", () => {
    const missing = Object.keys(PLACEMENT).filter((k) => k !== SUNWHEEL_MODULE && !CAPTIONS[k]);
    expect(missing).toEqual([]);
  });
  it("no caption is a section heading any more", () => {
    expect(Object.values(CAPTIONS).filter((c) => /^\d\. (Nigredo|Albedo|Citrinitas|Rubedo)/.test(c))).toEqual([]);
  });
});
