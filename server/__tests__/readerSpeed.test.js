// Reader speed (2026-09-13): a stalled host is not waited on twice, Magic builds
// section containers around merged prose, and Reader's container carries the title.
//
// Measured from the production droplet: every Washington Post article times the
// live reader fetch out at the full 6s deadline, and the viewer could not look
// for the archive until that answer came back.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchPageHtml = vi.fn();
vi.mock("../utils/safeFetchUrl.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPageHtml: (...a) => fetchPageHtml(...a),
}));
vi.mock("../models/Module.js", () => ({ default: { insertMany: vi.fn() } }));
vi.mock("../models/Occurrence.js", () => ({ default: { insertMany: vi.fn(), findOneAndUpdate: vi.fn() } }));

const { registerImportHandlers } = await import("../socketHandlers/import.js");
const { createHostStallMemory, readerHostStalls } = await import("../utils/hostStallMemory.js");
const { promoteBoldParagraphs, parseBlocks } = await import("../services/markdownImporter.js");

const WAPO = "https://www.washingtonpost.com/news/some-article";
const OTHER = "https://www.washingtonpost.com/other-article";

function harness() {
  const handlers = {};
  const socket = { userId: "user-1", on: (evt, fn) => { handlers[evt] = fn; }, emit: () => {} };
  const io = { to: () => ({ emit: () => {} }) };
  registerImportHandlers(socket, { io, getUC: async () => ({}), userRoom: (u) => `user:${u}` });
  return handlers;
}
const call = (handlers, evt, payload) => new Promise((res) => handlers[evt](payload, res));

beforeEach(() => {
  fetchPageHtml.mockReset();
  readerHostStalls.clear(WAPO);
  readerHostStalls.clear("https://slow.example.com/");
});

describe("host stall memory", () => {
  it("remembers a stalled host until the TTL passes", () => {
    let t = 1000;
    const mem = createHostStallMemory({ ttlMs: 500, now: () => t });
    mem.markStalled(WAPO);
    expect(mem.isStalled(OTHER)).toBe(true); // same host, different article
    t = 1499;
    expect(mem.isStalled(WAPO)).toBe(true);
    t = 1500;
    expect(mem.isStalled(WAPO)).toBe(false);
  });

  it("never marks the archive — it is the fallback", () => {
    const mem = createHostStallMemory();
    mem.markStalled("https://web.archive.org/web/2023/https://x.test/");
    expect(mem.isStalled("https://web.archive.org/web/2024/https://y.test/")).toBe(false);
  });

  it("an unparseable url is never stalled", () => {
    const mem = createHostStallMemory();
    mem.markStalled("not a url");
    expect(mem.isStalled("not a url")).toBe(false);
  });
});

describe("page_reader skips a host that just stalled", () => {
  it("a TIMEOUT marks the host, and the next read answers without fetching", async () => {
    const h = harness();
    fetchPageHtml.mockResolvedValue({ ok: false, reason: "timed out after 6000ms" });
    const first = await call(h, "page_reader", { url: WAPO });
    expect(first.ok).toBe(false);
    expect(fetchPageHtml).toHaveBeenCalledTimes(1);

    const second = await call(h, "page_reader", { url: OTHER });
    expect(second).toMatchObject({ ok: false, usable: false, stalled: true });
    expect(fetchPageHtml).toHaveBeenCalledTimes(1); // not asked again
  });

  // THE CONTROL: a quick refusal is cheap to ask again and must not be remembered,
  // or one 403 would hide a site's reader for half an hour.
  it("a quick refusal does NOT mark the host", async () => {
    const h = harness();
    fetchPageHtml.mockResolvedValue({ ok: false, reason: "HTTP 403", status: 403 });
    await call(h, "page_reader", { url: WAPO });
    await call(h, "page_reader", { url: WAPO });
    expect(fetchPageHtml).toHaveBeenCalledTimes(2);
  });

  it("a successful read clears a stale mark", async () => {
    const h = harness();
    readerHostStalls.markStalled("https://slow.example.com/");
    expect(readerHostStalls.isStalled("https://slow.example.com/a")).toBe(true);
    readerHostStalls.clear("https://slow.example.com/");
    fetchPageHtml.mockResolvedValue({ ok: true, url: "https://slow.example.com/a", html: "<html><body><p>hi</p></body></html>" });
    const out = await call(h, "page_reader", { url: "https://slow.example.com/a" });
    expect(out.ok).toBe(true);
    expect(readerHostStalls.isStalled("https://slow.example.com/a")).toBe(false);
  });

  // The viewer heads Reader/Magic with this once the address bar has left the
  // saved bookmark — the bookmark's label names a different page by then.
  it("a read carries the page's own <title>", async () => {
    const h = harness();
    fetchPageHtml.mockResolvedValue({
      ok: true, url: "https://ok.example.com/a",
      html: "<html><head><title>  House of\n Cards  </title></head><body><p>hi</p></body></html>",
    });
    const out = await call(h, "page_reader", { url: "https://ok.example.com/a" });
    expect(out.title).toBe("House of Cards");
  });
});

const ARTICLE = [
  "Democracy Dies in Darkness",
  "",
  "I'm working through a number of different theories.",
  "",
  "Certainly part of the problem is that I'm too close.",
  "",
  "**There are only one or two smart people in Washington.**",
  "",
  "Frank and Claire Underwood start off at the beginning.",
  "",
  "**Congressional leaders hand-pick presidential nominees.**",
  "",
  "Early in Season 3, we see the leadership meeting.",
].join("\n");

describe("promoteBoldParagraphs", () => {
  it("turns a bold-only paragraph into a section heading", () => {
    const blocks = promoteBoldParagraphs(parseBlocks(ARTICLE));
    const headings = blocks.filter((b) => b.kind === "heading").map((b) => b.text);
    expect(headings).toEqual([
      "There are only one or two smart people in Washington.",
      "Congressional leaders hand-pick presidential nominees.",
    ]);
  });

  // THE CONTROL: bold INSIDE a sentence is emphasis, not a section.
  it("leaves a paragraph that merely contains bold alone", () => {
    const blocks = promoteBoldParagraphs(parseBlocks("Some **bold** words in prose.\n\n**A** and **B**"));
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });
});

describe("import_plan shapes", () => {
  // user, 2026-09-13: *"magic mode shouldnt be every paragraph is just a
  // textblock. it needs to be smart like the wikipedia import."* So prose MERGES
  // (one textblock per section, like an import) and the structure comes from
  // the sections.
  it("MAGIC structures the page: section containers holding merged prose", async () => {
    const h = harness();
    const out = await call(h, "import_plan", { content: ARTICLE, gridId: "g", shape: "magic", title: "House of Cards" });
    const modOf = (o) => out.modules.find((m) => m.id === o.moduleId);
    const byLabel = (label) => out.occurrences.find((o) => modOf(o)?.label === label);
    const textblocksUnder = (occ) => (occ.occurrences || [])
      .map((id) => out.occurrences.find((o) => o.id === id))
      .filter((o) => o && modOf(o)?.role === "textblock");
    const root = out.occurrences.find((o) => o.id === out.rootOccurrenceId);
    const s1 = byLabel("There are only one or two smart people in Washington.");
    const s2 = byLabel("Congressional leaders hand-pick presidential nominees.");
    expect(modOf(s1)).toMatchObject({ role: "container", kind: "doc" });
    expect(root.occurrences).toEqual(expect.arrayContaining([s1.id, s2.id]));
    // The three lead paragraphs are ONE textblock under the root, not three.
    expect(textblocksUnder(root)).toHaveLength(1);
    expect(textblocksUnder(s1)).toHaveLength(1);
    expect(textblocksUnder(s2)).toHaveLength(1);
  });

  it("MAGIC nests a bold sub-section INSIDE the real heading above it", async () => {
    const h = harness();
    const md = ["## Part One", "", "Opening prose.", "", "**A smaller point**", "", "Detail prose."].join("\n");
    const out = await call(h, "import_plan", { content: md, gridId: "g", shape: "magic", title: "T" });
    const modOf = (o) => out.modules.find((m) => m.id === o.moduleId);
    const part = out.occurrences.find((o) => modOf(o)?.label === "Part One");
    const sub = out.occurrences.find((o) => modOf(o)?.label === "A smaller point");
    expect(part.occurrences).toContain(sub.id); // doc container inside doc container
    const subText = sub.occurrences.map((id) => out.occurrences.find((o) => o.id === id));
    expect(subText.some((o) => modOf(o)?.role === "textblock")).toBe(true);
  });

  it("READER stays one container + one textblock, headed by the title", async () => {
    const h = harness();
    const out = await call(h, "import_plan", { content: ARTICLE, gridId: "g", shape: "reader", title: "House of Cards" });
    expect(out.occurrences).toHaveLength(2);
    const root = out.occurrences.find((o) => o.id === out.rootOccurrenceId);
    expect(out.modules.find((m) => m.id === root.moduleId).label).toBe("House of Cards");
  });
});
