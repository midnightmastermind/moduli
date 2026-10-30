// @vitest-environment node
// A block inside an imported article: page --embeds--> root section (listed by nobody, no parentId)
// --lists--> section --lists--> textblock. Search showed the hit and opened nothing (user, 2026-10-30).
import { describe, it, expect } from "vitest";
import { nearestPageOccId } from "../helpers/openOccurrenceInPanel";
import { buildSearchIndex } from "../helpers/occurrenceSearch";
import { embedParentIndex } from "../helpers/textmapEmbeds";

const embed = (id) => ({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: id } }] });
const modulesById = {
  mPage: { id: "mPage", role: "page", kind: "doc", label: "Eminem" },
  mRoot: { id: "mRoot", role: "container", kind: "doc", label: "Eminem" },
  mSec: { id: "mSec", role: "container", kind: "doc", label: "Music career" },
  mTb: { id: "mTb", role: "textblock" },
};
const make = (pageEmbedsRoot = true) => ({
  page: { id: "page", moduleId: "mPage", occurrences: [], textmap: pageEmbedsRoot ? embed("root") : null },
  root: { id: "root", moduleId: "mRoot", parentId: null, occurrences: ["sec"], textmap: embed("sec") },
  sec: { id: "sec", moduleId: "mSec", parentId: "root", occurrences: ["tb"], textmap: embed("tb") },
  tb: { id: "tb", moduleId: "mTb", parentId: null,
    textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "There is no Relapse 2" }] }] } },
});

describe("a block reached only through a page's textmap", () => {
  it("finds the page above an embedded root", () => {
    expect(nearestPageOccId("tb", { occurrencesById: make(), modulesById })).toBe("page");
  });
  it("the search index marks it openable", () => {
    const idx = buildSearchIndex({ occurrencesById: make(), modulesById });
    const entry = (idx.entries || idx).find((e) => (e.occId || e.entry?.occId) === "tb");
    expect(entry.pageOccId).toBe("page");
  });
  it("still unreachable when nothing embeds the root (control)", () => {
    expect(nearestPageOccId("tb", { occurrencesById: make(false), modulesById })).toBeNull();
  });
  it("a list beats an embed: a row embedded elsewhere keeps its home", () => {
    const occs = make();
    occs.other = { id: "other", moduleId: "mSec", occurrences: [], textmap: embed("sec") };
    // sec is listed by root AND embedded by other; the walk must go through root
    expect(embedParentIndex(occs).get("sec")).toBeDefined();
    expect(nearestPageOccId("tb", { occurrencesById: occs, modulesById })).toBe("page");
  });
});

describe("a jump to a block taller than its panel", () => {
  it("scrolls it to its start, not its centre", async () => {
    const { scrollAndFlash } = await import("../helpers/jumpToOccurrence");
    const el = { getBoundingClientRect: () => ({ top: 2000, height: 1566 }), closest: () => null,
      parentElement: null, isConnected: false, classList: { add() {}, remove() {} } };
    let opts = null; el.scrollIntoView = (o) => { opts = o; };
    globalThis.window = globalThis.window || { innerHeight: 600 };
    globalThis.document = globalThis.document || { body: {}, documentElement: { clientHeight: 600 } };
    scrollAndFlash(el);
    expect(opts.block).toBe("start");
  });
});
