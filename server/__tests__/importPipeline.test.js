// One import pipeline (services/importPipeline.js): extract → markdown + meta → markdownToModuli.
// OCR is mocked with the recorded Gnosis page; links take an injected fetcher. Nothing touches Mongo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "..", "eval", "imports", "cases");
const gnosisPage = JSON.parse(fs.readFileSync(path.join(casesDir, "gnosis", "ocr.json"), "utf8"));

vi.mock("../services/serverOcr.js", () => ({ ocrImage: vi.fn() }));
const { ocrImage } = await import("../services/serverOcr.js");
const { runImport, extractImport } = await import("../services/importPipeline.js");
const { markdownToModuli } = await import("../services/markdownImporter.js");

const IMG_OCC = "img-occ-gnosis";
const imageSource = { kind: "image", filePath: "/srv/uploads/user/2026-11/gnosis.jpg", imageOccurrenceId: IMG_OCC };

/** Every moduleEmbed / wrapGroup member id in a textmap, depth-first. */
function embedIds(node, out = []) {
  if (!node) return out;
  if (node.type === "moduleEmbed") out.push(node.attrs?.occurrenceId);
  for (const c of node.content || []) embedIds(c, out);
  return out;
}
const textblocksOf = (plan) => plan.modules.filter((m) => m.role === "textblock" && m.kind === "doc");

describe("runImport — an image page", () => {
  beforeEach(() => ocrImage.mockReset());

  it("splits paragraphs, keeps the quote, and wraps the EXISTING picture beside the text", async () => {
    ocrImage.mockResolvedValue(gnosisPage);
    const out = await runImport({ source: imageSource, gridId: "g", userId: "u", dryRun: true });
    expect(out.empty).toBe(false);
    expect(out.meta.title).toBe("Gnosis");
    const plan = out.plan;
    expect(textblocksOf(plan).length).toBeGreaterThanOrEqual(4);
    expect(plan.modules.filter((m) => m.role === "artifact" && m.kind === "quote")).toHaveLength(1);
    // the picture is the existing occurrence, not a second copy
    expect(plan.modules.filter((m) => m.role === "artifact" && m.kind === "image")).toHaveLength(0);
    const root = plan.occurrences.find((o) => o.id === plan.rootOccurrenceId);
    expect(embedIds(root.textmap)).toContain(IMG_OCC);
    expect(root.occurrences).toContain(IMG_OCC);
    const group = root.textmap.content.find((n) => n.type === "wrapGroup");
    expect(group?.content?.[0]?.attrs?.occurrenceId).toBe(IMG_OCC);
    // Task 8 reads these off the root
    expect(root.meta.importSource).toMatchObject({ kind: "image" });
    expect(typeof root.meta.importedAt).toBe("string");
    expect(ocrImage).toHaveBeenCalledWith(imageSource.filePath);
  });

  it("an image whose OCR reads as noise is empty and plans nothing", async () => {
    ocrImage.mockResolvedValue({ text: "| .", blocks: null });
    const out = await runImport({ source: imageSource, gridId: "g", userId: "u", dryRun: true });
    expect(out.empty).toBe(true);
    expect(out.plan).toBeUndefined();
  });
});

describe("markdownToModuli paragraphBlocks", () => {
  it("one textblock per paragraph with the flag", async () => {
    const r = await markdownToModuli({ userId: "u", markdown: "a\n\nb", paragraphBlocks: true, dryRun: true });
    expect(textblocksOf(r)).toHaveLength(2);
  });
  it("control: without the flag, consecutive paragraphs merge (existing callers unchanged)", async () => {
    const r = await markdownToModuli({ userId: "u", markdown: "a\n\nb", dryRun: true });
    expect(textblocksOf(r)).toHaveLength(1);
  });
  it("a quote after a lead-in ending ':' stays in that lead-in's textblock", async () => {
    const r = await markdownToModuli({ userId: "u", markdown: "He said:\n\n> hi\n\nNext.", paragraphBlocks: true, dryRun: true });
    expect(textblocksOf(r)).toHaveLength(2);
  });
});

describe("extractImport — a link", () => {
  it("title from the page's <title>, images from the page", async () => {
    const html = fs.readFileSync(path.join(casesDir, "mtu", "source.html"), "utf8");
    const url = fs.readFileSync(path.join(casesDir, "mtu", "url.txt"), "utf8").trim();
    const fetchPageHtml = vi.fn().mockResolvedValue({ ok: true, html, url });
    const { markdown, meta } = await extractImport({ kind: "link", url }, { fetchPageHtml });
    expect(fetchPageHtml).toHaveBeenCalledTimes(1);
    expect(meta.title).toMatch(/Just Press Print/);
    expect(meta.images.length).toBeGreaterThan(0);
    expect(meta.source).toEqual({ kind: "link", url });
    expect(markdown.length).toBeGreaterThan(200);
  });

  it("a link that cannot be fetched throws its reason", async () => {
    const fetchPageHtml = vi.fn().mockResolvedValue({ ok: false, reason: "timed out" });
    await expect(extractImport({ kind: "link", url: "https://x.test/a" }, { fetchPageHtml })).rejects.toThrow("timed out");
  });
});

describe("extractImport — text", () => {
  it("passes text through with its title", async () => {
    const { markdown, meta } = await extractImport({ kind: "text", text: "Hello there world", title: "Note" });
    expect(markdown).toBe("Hello there world");
    expect(meta).toMatchObject({ title: "Note", images: [], fields: {}, type: null, source: { kind: "text" } });
  });
});
