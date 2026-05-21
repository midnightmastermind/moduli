import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Mongoose model imports BEFORE markdownToModuli pulls them in —
// dryRun:true skips persistence anyway, but the imports happen at module
// load time so they need to resolve.
vi.mock("../models/Module.js", () => ({ default: { insertMany: vi.fn() } }));
vi.mock("../models/Occurrence.js", () => ({ default: { insertMany: vi.fn(), findOneAndUpdate: vi.fn() } }));

const { markdownToModuli } = await import("../services/markdownImporter.js");

// Phase A importer rules (see services/markdownImporter.js header):
//   headings → containers, lists → instances, paragraphs → textblocks,
//   fenced code → codeBlock textblock, ```html``` → htmlPreview textblock,
//   block-level ![alt](src) → role:"artifact" kind:"image" module.

describe("markdownToModuli — image markdown becomes artifact module", () => {
  it("mints role:artifact kind:image with fileRef:<src> for block-level images", async () => {
    const md = `# Title\n\n![A cat](https://example.com/cat.jpg)\n\nPara.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const artifacts = r.modules.filter(m => m.role === "artifact");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe("image");
    expect(artifacts[0].fileRef).toBe("https://example.com/cat.jpg");
    expect(artifacts[0].label).toBe("A cat");
    expect(r.stats.artifacts).toBe(1);
  });

  it("multiple images each get their own artifact module", async () => {
    const md = `# H\n\n![a](u1.png)\n\n![b](u2.png)\n\n![c](u3.png)`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const artifacts = r.modules.filter(m => m.role === "artifact");
    expect(artifacts.map(a => a.fileRef)).toEqual(["u1.png", "u2.png", "u3.png"]);
  });

  it("alt-less image is allowed (label '')", async () => {
    const md = `# H\n\n![](u.png)`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const a = r.modules.find(m => m.role === "artifact");
    expect(a.fileRef).toBe("u.png");
    expect(a.label).toBe("");
  });

  it("inline image inside a paragraph stays as alt text (NOT split into artifact)", async () => {
    // Phase A intentionally does block-level only — keeps prose intact.
    // Phase B will handle inline images via a TipTap image mark.
    const md = `# H\n\nThis paragraph has ![inline](x.png) inside it.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    expect(r.modules.filter(m => m.role === "artifact")).toHaveLength(0);
    // The paragraph still becomes a textblock.
    expect(r.modules.filter(m => m.role === "textblock")).toHaveLength(1);
  });

  it("artifact occurrence has the container as its parent in the tree", async () => {
    const md = `# Section\n\n![pic](u.jpg)`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const containerOcc = r.occurrences.find(o => {
      const m = r.modules.find(x => x.id === o.moduleId);
      return m?.role === "container";
    });
    const artifactOcc = r.occurrences.find(o => {
      const m = r.modules.find(x => x.id === o.moduleId);
      return m?.role === "artifact";
    });
    expect(containerOcc.occurrences).toContain(artifactOcc.id);
  });
});

describe("markdownToModuli — html-fenced block becomes htmlPreview textblock", () => {
  it("mints textblock with meta.htmlPreview and TipTap codeBlock content", async () => {
    const md = "# H\n\n```html\n<table><tr><td>x</td></tr></table>\n```\n";
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const htmlPreview = r.modules.find(m => m.role === "textblock" && m.meta?.htmlPreview);
    expect(htmlPreview).toBeTruthy();
    const occ = r.occurrences.find(o => o.moduleId === htmlPreview.id);
    expect(occ.textmap.type).toBe("doc");
    expect(occ.textmap.content[0].type).toBe("codeBlock");
    expect(occ.textmap.content[0].attrs.language).toBe("html");
    expect(occ.textmap.content[0].content[0].text).toContain("<table>");
    expect(occ.textmap.content[0].content[0].text).toContain("<td>x</td>");
  });

  it("non-html fenced blocks (```js, ```python, etc.) stay as plain codeBlock without htmlPreview meta", async () => {
    const md = "# H\n\n```js\nconst x = 1;\n```\n";
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const tb = r.modules.find(m => m.role === "textblock");
    expect(tb.meta?.htmlPreview).toBeUndefined();
    const occ = r.occurrences.find(o => o.moduleId === tb.id);
    expect(occ.textmap.content[0].attrs.language).toBe("js");
  });
});

describe("markdownToModuli — plain text (degenerate markdown) round-trips cleanly", () => {
  it("a single-paragraph plain text input becomes one textblock under the root container", async () => {
    const md = `Just a sentence with no structure.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true, title: "Notes",
    });
    expect(r.stats.containers).toBe(1); // the synthetic root container
    expect(r.stats.textblocks).toBe(1);
    expect(r.stats.instances).toBe(0);
    expect(r.stats.artifacts).toBe(0);
    const root = r.modules.find(m => m.label === "Notes");
    expect(root).toBeTruthy();
  });

  it("multi-paragraph plain text splits paragraphs at blank lines", async () => {
    const md = `First para.\n\nSecond para.\n\nThird para.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    expect(r.stats.textblocks).toBe(3);
  });
});
