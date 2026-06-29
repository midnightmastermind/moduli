import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../services/wikipediaTools.js";

// htmlToMarkdown is the Phase A conversion stage of the drag-to-import
// pipeline (see client/src/CLAUDE.md big-feature #6.5) AND the Wikipedia
// research tools' fullMarkdown stage. The default options match the
// existing Wikipedia-summary stripping behavior so legacy callers
// (fullMarkdown, the assistant tool catalog) stay byte-identical; the
// keepImages / keepTables / keepFigures opts power the drop-import flow
// where the user wants the FULL article including media.

describe("htmlToMarkdown — default (Wikipedia-summary) behavior", () => {
  it("strips images by default", () => {
    const html = `<p>Before <img src="https://example.com/x.jpg" alt="alt"> after.</p>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("![");
    expect(md).toContain("Before");
    expect(md).toContain("after");
  });

  it("strips tables by default", () => {
    const html = `<p>Lede.</p><table><tr><td>x</td></tr></table><p>More.</p>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("table");
    expect(md).not.toContain("<td>");
    expect(md).toContain("Lede");
    expect(md).toContain("More");
  });

  it("strips figures by default", () => {
    const html = `<p>A</p><figure><img src="x.jpg"><figcaption>caption</figcaption></figure><p>B</p>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("caption");
    expect(md).not.toContain("![");
  });

  it("strips infobox / navbox / references via class", () => {
    const html = `<table class="infobox">DROP</table><div class="navbox">DROP</div><p>Keep me.</p><sup>[1]</sup>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("DROP");
    expect(md).not.toContain("[1]");
    expect(md).toContain("Keep me");
  });

  it("emits heading + paragraph + list markdown", () => {
    const html = `<h2>Section</h2><p>Para.</p><ul><li>One</li><li>Two</li></ul>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("## Section");
    expect(md).toContain("Para.");
    expect(md).toContain("- One");
    expect(md).toContain("- Two");
  });

  it("preserves inline marks + external links, resolves wiki-internal links to absolute URLs", () => {
    const html = `<p>This is <b>bold</b>, <i>italic</i>, and <code>x</code>. See <a href="https://example.com">site</a>, <a href="/wiki/Foo">internal</a>, and <a href="./Bar_Baz">rel</a>.</p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("`x`");
    expect(md).toContain("[site](https://example.com)");
    // wiki-internal links are now absolute, clickable links (not stripped)
    expect(md).toContain("[internal](https://en.wikipedia.org/wiki/Foo)");
    expect(md).toContain("[rel](https://en.wikipedia.org/wiki/Bar_Baz)");
    expect(md).not.toContain("](/wiki/Foo)");
    expect(md).not.toContain("](./Bar_Baz)");
  });

  it("intra-page #anchors and unknown relatives drop to plain text", () => {
    const html = `<p>See <a href="#cite_note-1">[1]</a> and <a href="weird/rel">thing</a>.</p>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("](#");
    expect(md).not.toContain("](weird/rel)");
    expect(md).toContain("thing");
  });

  it("prepends fallbackTitle as H1 only when no leading heading exists", () => {
    const md = htmlToMarkdown(`<p>Body text.</p>`, "My Title");
    expect(md.startsWith("# My Title")).toBe(true);

    const md2 = htmlToMarkdown(`<h1>Pre-existing</h1><p>Body.</p>`, "My Title");
    expect(md2.startsWith("# Pre-existing")).toBe(true);
    expect(md2).not.toContain("# My Title\n\n#");
  });
});

describe("htmlToMarkdown — keepImages option (drag-to-import path)", () => {
  it("emits `![alt](src)` for bare <img>", () => {
    const html = `<p>Before</p><img src="https://example.com/cat.jpg" alt="A cat"><p>After</p>`;
    const md = htmlToMarkdown(html, "", { keepImages: true });
    expect(md).toContain("![A cat](https://example.com/cat.jpg)");
  });

  it("emits image markdown with empty alt when alt attr is missing", () => {
    const html = `<img src="x.png">`;
    const md = htmlToMarkdown(html, "", { keepImages: true });
    expect(md).toContain("![](x.png)");
  });

  it("drops <img> when src attr is missing (no broken markdown)", () => {
    const html = `<img alt="dangling">`;
    const md = htmlToMarkdown(html, "", { keepImages: true });
    expect(md).not.toContain("![dangling]");
    expect(md).not.toContain("![");
  });
});

describe("htmlToMarkdown — keepFigures option", () => {
  it("preserves figure as image + italic caption", () => {
    const html = `<figure><img src="x.jpg" alt="A"><figcaption>Cap text</figcaption></figure>`;
    const md = htmlToMarkdown(html, "", { keepFigures: true });
    expect(md).toContain("![A](x.jpg)");
    expect(md).toContain("_Cap text_");
  });

  it("preserves caption-only figure (no img) as italic paragraph", () => {
    const html = `<figure><figcaption>Just caption</figcaption></figure>`;
    const md = htmlToMarkdown(html, "", { keepFigures: true });
    expect(md).toContain("_Just caption_");
  });
});

describe("htmlToMarkdown — keepTables option", () => {
  it("wraps tables in a ```html fenced block (Phase A fast path)", () => {
    const html = `<p>Before</p><table><tr><td>A</td><td>B</td></tr></table><p>After</p>`;
    const md = htmlToMarkdown(html, "", { keepTables: true });
    expect(md).toContain("```html");
    expect(md).toContain("<table");
    expect(md).toContain("<td>A</td>");
    expect(md).toContain("```");
    // Surrounding prose still converts cleanly
    expect(md).toContain("Before");
    expect(md).toContain("After");
  });

  it("does not strip tags INSIDE the fenced block (table HTML stays intact)", () => {
    const html = `<table><tr><td><strong>Bold</strong></td></tr></table>`;
    const md = htmlToMarkdown(html, "", { keepTables: true });
    // Inside the fence we want raw HTML, not stripped/converted.
    expect(md).toContain("<strong>Bold</strong>");
  });
});

describe("htmlToMarkdown — combined options (Wikipedia drop smoke)", () => {
  it("keeps images + tables + figures together for a mini-Wikipedia-shape document", () => {
    const html = `
      <h2>Section</h2>
      <p>Lede with <b>bold</b>.</p>
      <figure><img src="/img/a.jpg" alt="A pic"><figcaption>caption</figcaption></figure>
      <table><tr><td>r1</td></tr></table>
      <ul><li>One</li><li>Two</li></ul>
    `;
    const md = htmlToMarkdown(html, "", { keepImages: true, keepTables: true, keepFigures: true });
    expect(md).toContain("## Section");
    expect(md).toContain("**bold**");
    expect(md).toContain("![A pic](/img/a.jpg)");
    expect(md).toContain("_caption_");
    expect(md).toContain("```html");
    expect(md).toContain("<td>r1</td>");
    expect(md).toContain("- One");
    expect(md).toContain("- Two");
  });
});

describe("htmlToMarkdown — stripClasses customization", () => {
  it("custom stripClasses overrides default Wikipedia boilerplate list", () => {
    const html = `<div class="infobox">KEEP</div><div class="my-custom-junk">DROP</div><p>Body</p>`;
    const md = htmlToMarkdown(html, "", { stripClasses: ["my-custom-junk"] });
    expect(md).toContain("KEEP"); // infobox no longer stripped
    expect(md).not.toContain("DROP");
    expect(md).toContain("Body");
  });
});

describe("wikiHtmlToMarkdown — content tables become pipe tables (not raw <table> DOM)", () => {
  it("converts a .wikitable (with <caption>) to a GFM pipe table, never raw HTML", async () => {
    const { wikiHtmlToMarkdown } = await import("../services/wikipediaTools.js");
    const html = `
      <div class="mw-parser-output">
        <h2>Literary works</h2>
        <table class="wikitable">
          <caption>Eminem's published works</caption>
          <tbody>
            <tr><th>Title</th><th>Year</th><th>Pages</th></tr>
            <tr><td><i><a href="/wiki/Angry_Blonde" title="Angry Blonde">Angry Blonde</a></i></td><td>2000</td><td>148</td></tr>
            <tr><td><i>The Way I Am</i></td><td>2008</td><td>208</td></tr>
          </tbody>
        </table>
      </div>`;
    const md = wikiHtmlToMarkdown(html, "Eminem");
    // The raw table DOM must NOT survive into the markdown.
    expect(md).not.toContain("<table");
    expect(md).not.toContain("class=\"wikitable\"");
    expect(md).not.toContain("<td>");
    // It IS a pipe table the importer recognizes (header + separator + body).
    expect(md).toContain("| Title | Year | Pages |");
    expect(md).toMatch(/\|\s*---\s*\|/);
    expect(md).toContain("Angry Blonde");
    expect(md).toContain("| 2000 |");
    // The caption survives as a heading above the table.
    expect(md).toContain("### Eminem's published works");
  });
});
