/**
 * The DOM census. It COUNTS; it does not judge — every threshold would be a
 * guess, since what a row "should" cost depends on what it renders.
 *
 * The trap this file exists to avoid is the one the report itself warns about:
 * subtree totals OVERLAP by nesting (an .instance-wrap sits inside a
 * .container-shell), so summing them against the total looks like a bug in the
 * audit rather than a property of trees. That is asserted, not just commented.
 */
import { describe, it, expect } from "vitest";
import { auditDom, formatDomAudit } from "../helpers/domAudit.js";

const mount = (html) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
};

describe("auditDom", () => {
  it("counts every element under the root", () => {
    const root = mount("<div><span></span><span><b></b></span></div>");
    expect(auditDom(root).total).toBe(4);
  });

  it("measures a repeated structure's COUNT, TOTAL and MEDIAN cost", () => {
    // The median is what separates "too many rows" from "too heavy a row" —
    // two very different fixes, and a total alone cannot tell them apart.
    const row = '<div class="instance-wrap"><span></span><span></span></div>';
    const root = mount(row + row + row);
    const s = auditDom(root).subtrees.find((x) => x.label.includes("instance-wrap"));
    expect(s.count).toBe(3);
    expect(s.median).toBe(3);   // the wrap plus its two spans
    expect(s.nodes).toBe(9);
  });

  it("reports the heaviest structure first", () => {
    const root = mount(
      '<div class="container-shell"><i></i><i></i><i></i><i></i></div>' +
      '<div class="field-pill"><i></i></div>'
    );
    expect(auditDom(root).subtrees[0].label).toContain("container-shell");
  });

  it("SAYS its subtree totals overlap, because summing them is the obvious mistake", () => {
    // A row inside a container is counted by both. Without the flag the report
    // reads as though the audit had double-counted.
    const root = mount('<div class="container-shell"><div class="instance-wrap"><i></i></div></div>');
    const a = auditDom(root);
    const summed = a.subtrees.reduce((n, s) => n + s.nodes, 0);
    expect(summed).toBeGreaterThan(a.total);
    expect(a.subtreesOverlap).toBe(true);
  });

  it("names a structure by its app class, not by a utility class", () => {
    // Tailwind classes outnumber the structural ones several times over; a
    // report keyed on them names nothing a reader can act on.
    const root = mount('<div class="flex gap-2 container-shell text-sm"></div>');
    expect(auditDom(root).subtrees[0].label).toBe("div.container-shell");
  });

  it("names EVERY structure it queries, so no row reads as a bare tag", () => {
    // A report row saying "div" names nothing anyone can act on. Each queried
    // root must resolve to its own class — `.insert-gap` is the one that did
    // not, and it was the audit's own regex that was short, not the class.
    const roots = ["container-shell", "instance-wrap", "panel-shell", "artifact-card",
      "doc-editor", "instance-fields", "container-list", "field-pill", "insert-gap"];
    for (const cls of roots) {
      const root = mount(`<div class="${cls}"></div>`);
      expect(auditDom(root).subtrees[0].label).toBe(`div.${cls}`);
    }
  });

  it("reports depth, which a flat count cannot show", () => {
    expect(auditDom(mount("<div><div><div><div></div></div></div></div>")).depth).toBe(4);
  });

  it("survives an empty document rather than throwing mid-capture", () => {
    const a = auditDom(mount(""));
    expect(a.total).toBe(0);
    expect(a.subtrees).toEqual([]);
    expect(formatDomAudit(a)).toContain("0 elements");
  });

  it("returns null for a missing root instead of pretending to a census", () => {
    expect(auditDom(null)).toBe(null);
    expect(formatDomAudit(null)).toContain("no document");
  });
});
