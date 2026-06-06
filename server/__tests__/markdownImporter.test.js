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

describe("markdownToModuli — article-like grouped rich textblocks", () => {
  it("a [text](url) link in prose becomes an inline link mini-textblock (chip) embedded via instanceTextblockInline", async () => {
    const md = `# T\n\nRapper from Detroit. See [Detroit](https://en.wikipedia.org/wiki/Detroit) now.`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    // The link becomes its OWN inline textblock occurrence carrying meta.link…
    const linkMod = r.modules.find(m => m.role === "textblock" && m.kind === "inline" && m.meta?.link);
    expect(linkMod).toBeTruthy();
    expect(linkMod.meta.link).toEqual({ kind: "url", url: "https://en.wikipedia.org/wiki/Detroit" });
    const linkOcc = r.occurrences.find(o => o.meta?.link?.url === "https://en.wikipedia.org/wiki/Detroit");
    expect(linkOcc).toBeTruthy();
    // …and the surrounding paragraph embeds it via an instanceTextblockInline node
    // (no leftover inline link mark in the prose).
    const blob = JSON.stringify(r.occurrences.map(o => o.textmap));
    expect(blob).toContain("instanceTextblockInline");
    expect(blob).toContain(linkOcc.id);
    expect(blob).not.toContain('"type":"link"');
  });

  it("a markdown list becomes ONE textblock with a bulletList (not separate occurrences)", async () => {
    const md = `# T\n\n## Discography\n\n- The Slim Shady LP\n- The Marshall Mathers LP`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    expect(r.modules.some(m => m.role === "instance")).toBe(false); // no board list-item instances
    expect(r.stats.instances).toBe(0);
    const tbOcc = r.occurrences.find(o => JSON.stringify(o.textmap || {}).includes('"bulletList"'));
    expect(tbOcc).toBeTruthy();
    const bl = tbOcc.textmap.content.find(n => n.type === "bulletList");
    expect(bl.content.length).toBe(2); // two list items inside one bulletList
  });

  it("an image ![alt](src) becomes an artifact", async () => {
    const md = `# T\n\n![pic](https://example.com/p.png)`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    expect(r.modules.some(m => m.role === "artifact")).toBe(true);
  });

  it("heading + its section nests as containers (Rule Set A)", async () => {
    const md = `# Top\n\nIntro.\n\n## Section\n\nBody.\n\n### Sub\n\nDeep.`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const containers = r.modules.filter(m => m.role === "container");
    // root + Section + Sub
    expect(containers.length).toBeGreaterThanOrEqual(3);
    // every imported container opts into rendering nested child containers
    expect(containers.every(c => c.meta?.allowChildContainers === true)).toBe(true);
  });

  it("section containers carry cascading heading levels (article H1 → H2 → H3)", async () => {
    const md = `# Eminem\n\nIntro.\n\n## Early life\n\nBody.\n\n### Move to Detroit\n\nDeep.`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const lvl = (label) => r.modules.find(m => m.role === "container" && m.label === label)?.meta?.headingLevel;
    expect(lvl("Eminem")).toBe(1);
    expect(lvl("Early life")).toBe(2);
    expect(lvl("Move to Detroit")).toBe(3);
  });

  it("every section is a kind:doc container whose textmap embeds its children", async () => {
    const md = `# Top\n\nIntro para.\n\n## Section\n\nBody para.`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const docContainers = r.modules.filter(m => m.role === "container" && m.kind === "doc");
    // root + Section are both doc containers (no kind:board sections)
    expect(docContainers.length).toBeGreaterThanOrEqual(2);
    expect(r.modules.some(m => m.role === "container" && m.kind === "board")).toBe(false);
    // a section occurrence's textmap embeds its children via moduleEmbed nodes
    const rootOcc = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    const embeds = (rootOcc.textmap?.content || []).filter(n => n.type === "moduleEmbed");
    expect(embeds.length).toBe(rootOcc.occurrences.length);
    expect(embeds.every(n => rootOcc.occurrences.includes(n.attrs.occurrenceId))).toBe(true);
  });
});

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

  it("inline image inside a paragraph splits into TipTap image blocks (NOT artifact module)", async () => {
    // Phase B: inline `![alt](src)` becomes a block-level TipTap image
    // node between the surrounding paragraph halves, since the Image
    // extension is configured inline:false. Artifact modules are still
    // only minted for stand-alone block-level images.
    const md = `# H\n\nThis paragraph has ![inline](x.png) inside it.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    expect(r.modules.filter(m => m.role === "artifact")).toHaveLength(0);
    const tb = r.modules.find(m => m.role === "textblock");
    expect(tb).toBeTruthy();
    const tbOcc = r.occurrences.find(o => o.moduleId === tb.id);
    const content = tbOcc.textmap.content;
    expect(content).toHaveLength(3); // paragraph + image + paragraph
    expect(content[0].type).toBe("paragraph");
    expect(content[1]).toEqual({ type: "image", attrs: { src: "x.png", alt: "inline" } });
    expect(content[2].type).toBe("paragraph");
  });

  it("inline image at the start of a paragraph drops the empty leading paragraph", async () => {
    const md = `# H\n\n![start](a.jpg) followed by text.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const tbOcc = r.occurrences.find(o => {
      const m = r.modules.find(x => x.id === o.moduleId);
      return m?.role === "textblock";
    });
    const content = tbOcc.textmap.content;
    expect(content).toHaveLength(2); // image + paragraph
    expect(content[0]).toEqual({ type: "image", attrs: { src: "a.jpg", alt: "start" } });
    expect(content[1].type).toBe("paragraph");
  });

  it("two inline images in the same paragraph yield two image blocks", async () => {
    const md = `# H\n\nBefore ![one](1.png) middle ![two](2.png) after.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const tbOcc = r.occurrences.find(o => {
      const m = r.modules.find(x => x.id === o.moduleId);
      return m?.role === "textblock";
    });
    const images = tbOcc.textmap.content.filter(n => n.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0].attrs.src).toBe("1.png");
    expect(images[1].attrs.src).toBe("2.png");
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

describe("markdownToModuli — pipe-table markdown promotes to kind:table container", () => {
  it("mints a role:container kind:table module with columns + rowCount + cells", async () => {
    const md = `# H\n\n| Name | Age | City |\n|------|-----|------|\n| Ada  | 30  | NYC  |\n| Bo   | 25  | LA   |`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const table = r.modules.find(m => m.role === "container" && m.kind === "table");
    expect(table).toBeTruthy();
    const occ = r.occurrences.find(o => o.moduleId === table.id);
    expect(occ.meta.table.columns).toHaveLength(3);
    expect(occ.meta.table.columns[0].title).toBe("Name");
    expect(occ.meta.table.columns[1].title).toBe("Age");
    expect(occ.meta.table.columns[2].title).toBe("City");
    expect(occ.meta.table.rowCount).toBe(2);
    expect(occ.meta.table.cells["0:0"].content[0].content[0].text).toBe("Ada");
    expect(occ.meta.table.cells["1:2"].content[0].content[0].text).toBe("LA");
  });

  it("alignment-marker separator row is recognized (`| :--- | ---: | :---: |`)", async () => {
    const md = `# H\n\n| L | R | C |\n| :--- | ---: | :---: |\n| a | b | c |`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const table = r.modules.find(m => m.role === "container" && m.kind === "table");
    expect(table).toBeTruthy();
    const occ = r.occurrences.find(o => o.moduleId === table.id);
    expect(occ.meta.table.rowCount).toBe(1);
  });

  it("escaped pipe `\\|` inside a cell is preserved as a literal", async () => {
    const md = `# H\n\n| A | B |\n|---|---|\n| x \\| y | z |`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const table = r.modules.find(m => m.kind === "table");
    const occ = r.occurrences.find(o => o.moduleId === table.id);
    expect(occ.meta.table.cells["0:0"].content[0].content[0].text).toBe("x | y");
  });

  it("a `|` line WITHOUT a separator row falls through to paragraph (not promoted)", async () => {
    // Defensive — a stray `|` in prose shouldn't accidentally mint a
    // bogus single-column table.
    const md = `# H\n\nThis sentence | has a pipe but no separator.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    expect(r.modules.find(m => m.kind === "table")).toBeUndefined();
    expect(r.modules.find(m => m.role === "textblock")).toBeTruthy();
  });

  it("empty cells become a paragraph-only doc (preserves table shape)", async () => {
    const md = `# H\n\n| A | B |\n|---|---|\n| x |   |`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    const table = r.modules.find(m => m.kind === "table");
    const occ = r.occurrences.find(o => o.moduleId === table.id);
    expect(occ.meta.table.cells["0:1"]).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
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

  it("each paragraph becomes its OWN textblock (3 paragraphs → 3 textblocks)", async () => {
    const md = `First para.\n\nSecond para.\n\nThird para.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    expect(r.stats.textblocks).toBe(3);
    // each textblock holds exactly one paragraph
    const tbs = r.occurrences.filter(o => {
      const m = r.modules.find(mm => mm.id === o.moduleId);
      return m?.role === "textblock";
    });
    expect(tbs.every(o => (o.textmap.content || []).filter(n => n.type === "paragraph").length === 1)).toBe(true);
  });
});
