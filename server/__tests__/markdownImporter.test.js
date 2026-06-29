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

  it("a blank-label link derives its chip label from the URL slug (no empty mini-textblocks)", async () => {
    // Wikipedia's rendered HTML yields whitespace-text links → `[ ](/wiki/X)`.
    const md = `# T\n\n## See also\n\n- [ ](https://en.wikipedia.org/wiki/The_Slim_Shady_LP) – debut album`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const linkMod = r.modules.find(m => m.role === "textblock" && m.kind === "inline" && m.meta?.link);
    expect(linkMod).toBeTruthy();
    // label is derived from the slug, NOT left blank
    expect(linkMod.label).toBe("The Slim Shady LP");
    const blob = JSON.stringify(r.occurrences.map(o => o.textmap));
    expect(blob).toContain("The Slim Shady LP");
  });

  it("a list is ONE textblock (bulletList) whose items are inline mini-textblocks", async () => {
    const md = `# T\n\n## Discography\n\n- The Slim Shady LP\n- The Marshall Mathers LP`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    expect(r.modules.some(m => m.role === "instance")).toBe(false); // no board list-item instances
    expect(r.stats.instances).toBe(0);
    // The list lives in ONE textblock as a bulletList...
    const listTb = r.occurrences.find(o => JSON.stringify(o.textmap || {}).includes('"bulletList"'));
    expect(listTb).toBeTruthy();
    // ...and each item embeds a mini-textblock (instanceTextblockInline).
    expect(JSON.stringify(listTb.textmap)).toContain("instanceTextblockInline");
    const miniMods = r.modules.filter(m => m.role === "textblock" && m.kind === "inline");
    expect(miniMods.length).toBe(2); // one mini-textblock per bullet
    const miniBlob = JSON.stringify(r.occurrences.map(o => o.textmap));
    expect(miniBlob).toContain("The Slim Shady LP");
    expect(miniBlob).toContain("The Marshall Mathers LP");
  });

  it("an image ![alt](src) becomes an artifact", async () => {
    const md = `# T\n\n![pic](https://example.com/p.png)`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    expect(r.modules.some(m => m.role === "artifact")).toBe(true);
  });

  it("a blockquote becomes a kind:'quote' artifact with quote + attribution on meta", async () => {
    const md = `# T\n\n> He is the best rapper alive — Stephen Thomas Erlewine`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const q = r.modules.find(m => m.role === "artifact" && m.kind === "quote");
    expect(q).toBeTruthy();
    expect(q.meta.quote).toBe("He is the best rapper alive");
    expect(q.meta.attribution).toBe("Stephen Thomas Erlewine");
    // it is NOT a paragraph textblock with a literal ">" leaking in
    const blob = JSON.stringify(r.occurrences.map(o => o.textmap || {}));
    expect(blob).not.toContain("&gt;");
  });

  it("a quote following prose is embedded INSIDE that lead-up textblock (its own artifact, nested)", async () => {
    const md = `# T\n\nHe was praised, as one critic said:\n\n> He is the best rapper alive — Erlewine`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const q = r.occurrences.find(o => {
      const m = r.modules.find(mm => mm.id === o.moduleId);
      return m?.kind === "quote";
    });
    expect(q).toBeTruthy(); // still its own artifact occurrence
    // the lead-up textblock's textmap embeds the quote as a moduleEmbed (not a sibling)
    const tb = r.occurrences.find(o => {
      const m = r.modules.find(mm => mm.id === o.moduleId);
      return m?.role === "textblock"
        && (o.textmap?.content || []).some(n => n.type === "moduleEmbed" && n.attrs?.occurrenceId === q.id);
    });
    expect(tb).toBeTruthy();
    // the lead-in prose ("…said:") sits in the SAME textblock, before the quote embed
    const idxPara = tb.textmap.content.findIndex(n => n.type === "paragraph");
    const idxQuote = tb.textmap.content.findIndex(n => n.type === "moduleEmbed");
    expect(idxPara).toBeGreaterThanOrEqual(0);
    expect(idxQuote).toBeGreaterThan(idxPara);
  });

  it("a bullet list mints one inline mini-textblock per item inside one list textblock", async () => {
    const items = Array.from({ length: 25 }, (_, i) => `- Artist ${i + 1}`).join("\n");
    const md = `# T\n\n## Influences\n\n${items}`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const miniMods = r.modules.filter(m => m.role === "textblock" && m.kind === "inline");
    expect(miniMods.length).toBe(25);
    // still ONE bulletList textblock holding them all
    const listTbs = r.occurrences.filter(o => JSON.stringify(o.textmap || {}).includes('"bulletList"'));
    expect(listTbs.length).toBe(1);
  });

  it("a LINK bullet renders its chip directly in the list item (not flattened away in a mini-textblock)", async () => {
    // Discography-shape: link + trailing year; and a pure-link "See also" shape.
    const md = `# T\n\n## Discography\n\n- [The Slim Shady LP](https://en.wikipedia.org/wiki/The_Slim_Shady_LP) (1999)\n- [Award for music](https://en.wikipedia.org/wiki/Award_for_music)`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    const listTb = r.occurrences.find(o => JSON.stringify(o.textmap || {}).includes('"bulletList"'));
    expect(listTb).toBeTruthy();
    const bulletList = listTb.textmap.content.find(n => n.type === "bulletList")
      || listTb.textmap.content.flatMap(n => n.content || []).find(n => n.type === "bulletList");
    // The list lives via a moduleEmbed in the section textblock; locate it across occurrences.
    const blob = JSON.stringify(r.occurrences.map(o => o.textmap));
    // Each link bullet's chip occurrence carries the LABEL as text — the title must survive.
    expect(blob).toContain("The Slim Shady LP");
    expect(blob).toContain("Award for music");
    // The link chips are minted as inline link textblocks (meta.link), NOT lost.
    const linkMods = r.modules.filter(m => m.role === "textblock" && m.kind === "inline" && m.meta && m.meta.link);
    expect(linkMods.length).toBe(2);
    // The list item paragraph holds the chip DIRECTLY (a chip whose occurrence carries meta.link).
    const linkOccIds = new Set(r.occurrences.filter(o => o.meta && o.meta.link).map(o => o.id));
    const findListTb = r.occurrences.find(o => {
      const m = JSON.stringify(o.textmap || {});
      return m.includes('"bulletList"');
    });
    const chipIds = [];
    const walk = (n) => {
      if (!n) return;
      if (n.type === "instanceTextblockInline" && n.attrs) chipIds.push(n.attrs.occurrenceId);
      (n.content || []).forEach(walk);
    };
    walk(findListTb.textmap);
    // At least the two link chips point straight at the meta.link occurrences.
    expect(chipIds.filter(id => linkOccIds.has(id)).length).toBe(2);
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

  it("consecutive paragraphs MERGE into ONE textblock (3 paragraphs → 1 textblock, 3 paragraph nodes)", async () => {
    const md = `First para.\n\nSecond para.\n\nThird para.`;
    const r = await markdownToModuli({
      gridId: "g1", userId: "u1", markdown: md, dryRun: true,
    });
    expect(r.stats.textblocks).toBe(1);
    const tbs = r.occurrences.filter(o => {
      const m = r.modules.find(mm => mm.id === o.moduleId);
      return m?.role === "textblock";
    });
    // the single textblock holds all 3 paragraphs (a chunk of running prose = 1 block)
    expect(tbs.length).toBe(1);
    expect((tbs[0].textmap.content || []).filter(n => n.type === "paragraph").length).toBe(3);
  });

  it("a list JOINS the running prose chunk (one block, so bullets indent under their intro)", async () => {
    const md = `Para one.\n\nPara two.\n\n- item a\n- item b\n\nPara three.`;
    const r = await markdownToModuli({ gridId: "g1", userId: "u1", markdown: md, dryRun: true });
    // A list is prose-flow content now (not a structural separator), so with nothing
    // structural between them, prose + list + prose collapse to ONE flow textblock —
    // the bullets sit with their lead-in (the 2 items stay inline mini-textblocks).
    const flowTbs = r.occurrences.filter(o => {
      const mod = r.modules.find(m => m.id === o.moduleId);
      return mod?.role === "textblock" && mod?.kind !== "inline";
    });
    expect(flowTbs.length).toBe(1);
    const content = flowTbs[0].textmap.content || [];
    expect(content.filter(n => n.type === "paragraph").length).toBe(3);
    expect(content.filter(n => n.type === "bulletList").length).toBe(1);
  });
});

describe("markdownToModuli — 2026-06-09 import fixes (links/See-also/denylist/block-wrap)", () => {
  it("an emphasis-wrapped link *[text](url)* still resolves to a link chip (not literal text)", async () => {
    const md = `# T\n\nHis album *[The Eminem Show](https://en.wikipedia.org/wiki/The_Eminem_Show)* sold well.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const linkMod = r.modules.find(m => m.kind === "inline" && m.meta?.link?.url?.includes("The_Eminem_Show"));
    expect(linkMod).toBeTruthy(); // the link was minted as a chip
    const blob = JSON.stringify(r.occurrences.map(o => o.textmap));
    expect(blob).toContain("instanceTextblockInline");
    expect(blob).not.toContain("[The Eminem Show](http"); // no leftover literal markdown
  });

  it("bullet-list links (e.g. 'See also') become inline link chips, not link marks", async () => {
    const md = `# T\n\n## See also\n\n- [Honorific nicknames](https://en.wikipedia.org/wiki/Honorific_nicknames)\n- [List of winners](https://en.wikipedia.org/wiki/List_of_winners)`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const blob = JSON.stringify(r.occurrences.map(o => o.textmap));
    expect(blob).toContain("instanceTextblockInline");
    expect(blob).not.toContain('"type":"link"'); // no un-resolving link marks
    // each link is its OWN link-chip occurrence (meta.link) embedded DIRECTLY in the
    // list textblock — NOT wrapped in a plain mini-textblock (which would flatten the
    // chip away and render the bullet empty).
    const linkMods = r.modules.filter(m => m.role === "textblock" && m.kind === "inline" && m.meta && m.meta.link);
    expect(linkMods.length).toBe(2);
    // the bullet labels survive (they'd be dropped by the old double-nesting bug)
    expect(blob).toContain("Honorific nicknames");
    expect(blob).toContain("List of winners");
  });

  it("citation/nav cruft sections (References / Notes / External links) are dropped; 'See also' is kept", async () => {
    const md = `# T\n\n## Music\n\nReal content.\n\n## See also\n\n- [Thing](https://x/Thing)\n\n## Notes\n\n- a note\n\n## References\n\n- a ref\n\n## External links\n\n- [Official](https://x.com)`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const labels = r.modules.filter(m => m.role === "container").map(m => (m.label || "").toLowerCase());
    expect(labels).toContain("see also");
    expect(labels).toContain("music");
    expect(labels).not.toContain("notes");
    expect(labels).not.toContain("references");
    expect(labels).not.toContain("external links");
  });

  it("heading labels are stripped of inline markdown emphasis (no literal *)", async () => {
    const md = `# T\n\n## 1997–1999: *The Slim Shady LP*\n\nProse.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const sec = r.modules.find(m => m.role === "container" && (m.label || "").includes("Slim Shady LP"));
    expect(sec.label).toBe("1997–1999: The Slim Shady LP");
    expect(sec.label).not.toContain("*");
  });

  it("a block image folds into a wrapGroup with the following prose textblock (host); image-only section stays full-width", async () => {
    const md = `# T\n\n![photo](https://x/p.png)\n\nIntro prose flows beside it.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    const wg = root.textmap.content.find(n => n.type === "wrapGroup");
    expect(wg).toBeTruthy();
    expect(wg.content.length).toBe(2); // image neighbor (first) + host textblock (last)
    // neighbor-FIRST source order: child 0 is the image, the LAST child is the host.
    const hostOccId = wg.content[wg.content.length - 1].attrs.occurrenceId;
    const hostMod = r.modules.find(m => m.id === r.occurrences.find(o => o.id === hostOccId).moduleId);
    expect(hostMod.role).toBe("textblock");
    const neighborOccId = wg.content[0].attrs.occurrenceId;
    const neighborMod = r.modules.find(m => m.id === r.occurrences.find(o => o.id === neighborOccId).moduleId);
    expect(neighborMod.role).toBe("artifact");
  });

  it("multiple block images before one paragraph all stack as neighbors of a single host", async () => {
    const md = `# T\n\n![a](https://x/a.png)\n\n![b](https://x/b.png)\n\nProse with two images beside it.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    const wg = root.textmap.content.find(n => n.type === "wrapGroup");
    expect(wg.content.length).toBe(3); // host + 2 image neighbors
  });

  it("a block image with NO following prose host falls back to a full-width standalone embed", async () => {
    const md = `# T\n\nProse first.\n\n![trailing](https://x/t.png)`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    expect(root.textmap.content.some(n => n.type === "wrapGroup")).toBe(false);
    const imgEmbed = root.textmap.content.find(n => n.type === "moduleEmbed" && n.attrs.align === "full");
    expect(imgEmbed).toBeTruthy();
  });
});

describe("markdownToModuli — 2026-06-09 lead aside (main image + infobox table)", () => {
  it("the lead aside (image over infobox) sits in a two-COLUMN wrapGroup beside the first textblock (wrap:false, no L-morph)", async () => {
    const md = `# Eminem\n\n![Eminem](https://x/e.png)\n\n| | |\n| --- | --- |\n| Born | Marshall |\n| Labels | Shady |\n\nMarshall Bruce Mathers III is a rapper.\n\n## Early life\n\nHe was born in Missouri.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, title: "Eminem", dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    // The aside + first textblock are paired in a wrapGroup COLUMN (side-by-side, no float, no L).
    const wg = root.textmap.content[0];
    expect(wg.type).toBe("wrapGroup");
    expect(wg.attrs.wrap).toBe(false); // columns only — no L-morph yet
    // neighbor-first: [aside, firstTextblock]
    const asideEmbed = wg.content[0];
    const aside = r.occurrences.find(o => o.id === asideEmbed.attrs.occurrenceId);
    const asideMod = r.modules.find(m => m.id === aside.moduleId);
    expect(asideMod.kind).toBe("doc");
    expect(asideMod.meta.leadAside).toBe(true);
    expect(asideMod.label).toBe("Eminem");
    // aside stacks the image artifact FIRST, then the infobox table below it
    const memberKinds = aside.textmap.content.map(n => {
      const o = r.occurrences.find(x => x.id === n.attrs.occurrenceId);
      const m = r.modules.find(mm => mm.id === o.moduleId);
      return `${m.role}/${m.kind}`;
    });
    expect(memberKinds).toEqual(["artifact/image", "container/table"]);
    // the second column is the intro prose textblock
    const proseMod = r.modules.find(m => m.id === r.occurrences.find(o => o.id === wg.content[1].attrs.occurrenceId)?.moduleId);
    expect(proseMod.role).toBe("textblock");
    // no parent-level float anymore
    const rootMod = r.modules.find(m => m.id === root.moduleId);
    expect(rootMod.meta?.leadFloat).toBeFalsy();
  });

  it("with NO sub-container, the aside still columns beside the first textblock", async () => {
    const md = `# Eminem\n\n![Eminem](https://x/e.png)\n\n| | |\n| --- | --- |\n| Born | Marshall |\n\nMarshall Bruce Mathers III is a rapper.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, title: "Eminem", dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    const wg = root.textmap.content[0];
    expect(wg.type).toBe("wrapGroup");
    expect(wg.attrs.wrap).toBe(false);
    const asideMod = r.modules.find(m => m.id === r.occurrences.find(o => o.id === wg.content[0].attrs.occurrenceId).moduleId);
    expect(asideMod.meta.leadAside).toBe(true);
    const proseMod = r.modules.find(m => m.id === r.occurrences.find(o => o.id === wg.content[1].attrs.occurrenceId).moduleId);
    expect(proseMod.role).toBe("textblock");
    const rootMod = r.modules.find(m => m.id === root.moduleId);
    expect(rootMod.meta?.leadFloat).toBeFalsy();
  });

  it("the aside is a STRUCTURAL child of the root (in occurrences[], not just the textmap) so a tree-walk reaches it", async () => {
    const md = `# Eminem\n\n![Eminem](https://x/e.png)\n\n| | |\n| --- | --- |\n| Born | Marshall |\n\nMarshall Bruce Mathers III is a rapper.\n\n## Early life\n\nHe was born in Missouri.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, title: "Eminem", dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    const asideEmbed = root.textmap.content[0].content[0]; // wrapGroup → neighbor (aside)
    const asideId = asideEmbed.attrs.occurrenceId;
    // The aside must be reachable by an occurrences[]-tree walk from the root —
    // the folder-page preview scopes its state by walking occurrences[]/parentId
    // (NOT textmaps), and the aside hosts the lead image. Missing here = empty
    // 2nd preview column with the image unreachable until you drill into the page.
    expect(root.occurrences).toContain(asideId);
    // Walk the subtree the way the preview does (occurrences[] down only) and
    // confirm the lead image artifact is reachable.
    const occById = Object.fromEntries(r.occurrences.map(o => [o.id, o]));
    const seen = new Set();
    const queue = [r.rootOccurrenceId];
    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      for (const cid of (occById[id]?.occurrences || [])) queue.push(cid);
    }
    const imageOcc = r.occurrences.find(o => {
      const m = r.modules.find(mm => mm.id === o.moduleId);
      return m?.role === "artifact" && m?.kind === "image";
    });
    expect(seen.has(imageOcc.id)).toBe(true);
    // And buildSectionBody must NOT double-render the aside in the main flow.
    const asideEmbedCount = JSON.stringify(root.textmap.content)
      .split(`"occurrenceId":"${asideId}"`).length - 1;
    expect(asideEmbedCount).toBe(1);
  });

  it("a plain lead image with NO infobox table columns beside the prose (wrap:false, no aside)", async () => {
    const md = `# T\n\n![photo](https://x/p.png)\n\nIntro prose.`;
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: md, dryRun: true });
    const root = r.occurrences.find(o => o.id === r.rootOccurrenceId);
    const wg = root.textmap.content.find(n => n.type === "wrapGroup");
    expect(wg.attrs.wrap).toBe(false); // columns: image beside prose, no L-morph yet
    const neighborId = wg.content[0].attrs.occurrenceId; // neighbor-first source order
    const neighborMod = r.modules.find(m => m.id === r.occurrences.find(o => o.id === neighborId).moduleId);
    expect(neighborMod.role).toBe("artifact"); // single image neighbor, NOT a leadAside doc container
  });
});
