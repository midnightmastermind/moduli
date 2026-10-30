// A doc SECTION draws its embeds read-only until it nears the viewport (user, 2026-10-30: Eminem took 5s to open —
// every section mounted its editor). helpers/lazyEditor sectionStandIn + forceLiveAncestors.
import { describe, it, expect, vi, afterEach } from "vitest";
import { sectionStandIn, forceLiveAncestors, __registerForTest, __resetForTest } from "../helpers/lazyEditor";

const occ = { tb: { id: "tb", moduleId: "m-tb", textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } },
  sub: { id: "sub", moduleId: "m-sub", label: "Career", textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "tb" } }] } },
  img: { id: "img", moduleId: "m-img" }, tbl: { id: "tbl", moduleId: "m-tbl", meta: { table: { rowCount: 4 } } } };
const mod = { "m-tb": { role: "textblock", kind: "doc" }, "m-sub": { role: "container", kind: "doc", label: "Career" }, "m-img": { role: "artifact", kind: "image" }, "m-tbl": { role: "container", kind: "table" } };
const go = (tm) => sectionStandIn(tm, (id) => occ[id], (id) => mod[id]);

describe("sectionStandIn", () => {
  it("a textblock embed draws its own content in a card", () => {
    expect(go({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "tb" } }] })).toEqual([
      { type: "standinCard", content: occ.tb.textmap.content },
    ]);
  });
  it("a sub-section is its label + its own expansion; pictures and tables are boxes of about their height", () => {
    const out = go({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "sub" } }, { type: "wrapGroup", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "img" } }, { type: "moduleEmbed", attrs: { occurrenceId: "tbl" } }] }] });
    expect(out[0]).toMatchObject({ type: "standinSection", label: "Career", content: [{ type: "standinCard" }] });
    expect(out[1]).toEqual({ type: "standinBox", height: 220 });
    expect(out[2]).toEqual({ type: "standinBox", height: 30 + 28 * 4 });
  });
  it("never returns null — a section always has a stand-in", () => {
    expect(go({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "x" }] }] })).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "x" }] },
    ]);
  });
});

describe("a search jump into a section not yet mounted", () => {
  afterEach(() => __resetForTest());
  it("mounts the sections on the target's ancestor chain", () => {
    const a = vi.fn(); const b = vi.fn();
    __registerForTest("secA", a); __registerForTest("secB", b);
    expect(forceLiveAncestors(["page", "secA", "secB"])).toBe(true);
    expect(a).toHaveBeenCalled(); expect(b).toHaveBeenCalled();
    expect(forceLiveAncestors(["page"])).toBe(false); // nothing to mount (control)
  });
});
