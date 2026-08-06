import { describe, it, expect } from "vitest";
import { extractInfobox } from "../services/wikipediaTools.js";

const table = (rows) => `<table class="infobox"><tbody>${rows}</tbody></table>`;

// The real markup Wikipedia's {{marriage}} template emits, captured from the
// Eminem article. The two <li>s are EMPTY — they exist only to anchor
// TemplateStyles — and the names/dates live in sibling <div>s. The zero-width
// spaces are the template's line-break control.
const SPOUSES_TD = `
<div class="plainlist">
  <ul><li></li></ul>
  <div class="marriage-display-inline">
    <div style="display:inline-block">Kimberly Anne Scott</div>
    <div class="marriage-line-margin2px">​</div> <div style="display:inline-block">​</div>(<abbr title="married">m.</abbr>&nbsp;1999; <abbr title="divorced">div.</abbr>&nbsp;2001)<wbr>​</div>
  <ul><li><link rel="mw-deduplicated-inline-style" href="mw-data:TemplateStyles:r1298804929"></li></ul>
  <div class="marriage-line-margin3px">​</div>
  <div class="marriage-display-inline"> <div style="display:inline-block">​</div>(<abbr title="married">m.</abbr>&nbsp;2006; <abbr title="divorced">div.</abbr>&nbsp;2006)<wbr>​</div>
</div>`;

describe("extractInfobox", () => {
  it("an EMPTY <li> contributes no comma — the user's 'empty spot before Kimberly'", () => {
    const rows = extractInfobox(table(`<tr><th>Spouses</th><td>${SPOUSES_TD}</td></tr>`));
    const spouses = rows.find(r => r.label === "Spouses");
    expect(spouses.value).toBe("Kimberly Anne Scott (m. 1999; div. 2001) (m. 2006; div. 2006)");
    expect(spouses.value.startsWith(",")).toBe(false);
    expect(spouses.value).not.toMatch(/,\s*,/);
  });

  it("strips the template's zero-width characters, which survive whitespace collapsing", () => {
    const rows = extractInfobox(table(`<tr><th>Spouses</th><td>${SPOUSES_TD}</td></tr>`));
    expect(rows[0].value).not.toMatch(/[​-‍﻿]/);
  });

  it("a REAL list still gets its commas — the separator is not simply removed", () => {
    const td = `<div class="plainlist"><ul><li>Slim Shady</li><li>Evil</li><li>MC Double M</li></ul></div>`;
    const rows = extractInfobox(table(`<tr><th>Other names</th><td>${td}</td></tr>`));
    expect(rows[0].value).toBe("Slim Shady, Evil, MC Double M");
  });

  it("a list whose items are blank collapses to nothing rather than to punctuation", () => {
    const td = `<ul><li></li><li>​</li><li>  </li></ul>`;
    const rows = extractInfobox(table(`<tr><th>Spouses</th><td>${td}</td></tr>`));
    // No value at all → the row is dropped, not kept as ", ,".
    expect(rows).toBeNull();
  });

  it("<br> separated values still read as · and keep their order", () => {
    const td = `Detroit<br>Michigan<br>U.S.`;
    const rows = extractInfobox(table(`<tr><th>Origin</th><td>${td}</td></tr>`));
    expect(rows[0].value).toBe("Detroit · Michigan · U.S.");
  });
});
