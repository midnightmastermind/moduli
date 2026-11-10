// server/__tests__/shareImportPreview.test.js
//
// Plan Task 5 (smarter imports): the share window previews what will be created — the import pipeline in
// dry-run mode over the staged clip — and a hand placement of a link can become its readable page.
// Real recorded sources from the eval set (server/eval/imports/cases) stand in for the network.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const caseFile = (name, f) => fs.readFileSync(path.join(here, "..", "eval", "imports", "cases", name, f), "utf8");
const ellisHtml = caseFile("ellis", "source.html");
const ellisUrl = caseFile("ellis", "url.txt").trim();
const gnosisOcr = JSON.parse(caseFile("gnosis", "ocr.json"));

const jobCalls = [];
const queued = [];
vi.mock("../services/importJobs.js", () => ({
  runImportJob: async (job) => { jobCalls.push(job); return /unreadable/.test(job.source.url) ? { ok: false, error: "timed out" } : { ok: true, rootOccurrenceId: "page1" }; },
  queueImport: (job) => { queued.push(job); return true; },
}));
const ranOps = [];
vi.mock("../services/serverExecutor.js", () => ({
  runOperationServerSide: async (op) => { ranOps.push(op); return { ok: true, effects: [{ _effect: "CREATE", occurrenceId: "bm1", status: "created" }] }; },
}));
vi.mock("../models/Field.js", () => ({ default: { find: () => ({ lean: async () => [] }) } }));

const { buildImportPreview, stageImportSource, bodyLinesOf } = await import("../services/importPreview.js");
const { applyImportOverrides } = await import("../services/importPipeline.js");
const { placeManually } = await import("../services/manualPlacement.js");

beforeEach(() => { jobCalls.length = 0; queued.length = 0; ranOps.length = 0; });

describe("the import preview", () => {
  it("a staged link: its title, its first lines, its pictures, in Imports", async () => {
    const p = await buildImportPreview({ url: ellisUrl, title: "Albert Ellis - Wikipedia" },
      { fetchPageHtml: async () => ({ ok: true, html: ellisHtml, url: ellisUrl }) });
    expect(p.where).toBe("Imports");
    expect(p.willBuildPage).toBe(true);
    expect(p.label).toBe("Albert Ellis");
    expect(p.bodyLines.length).toBeGreaterThan(0);
    expect(p.bodyLines.join(" ")).toMatch(/psycholog/i);
    expect(p.images.length).toBeGreaterThan(0);
    expect(p.aiNote).toMatch(/after saving/);
  });

  it("a staged picture: the lines are read off it", async () => {
    const p = await buildImportPreview({ file: { path: "/tmp/gnosis.jpg", mimetype: "image/jpeg" } },
      { ocrImage: async () => gnosisOcr });
    expect(p.type).toBe("image");
    expect(p.bodyLines.join(" ")).toMatch(/Gnosis is conscious knowledge/);
  });

  it("a page that cannot be read: still 200-shaped, no page, the clip's own label", async () => {
    const p = await buildImportPreview({ url: "https://imdb.test/title/1", title: "A movie (2006)" },
      { fetchPageHtml: async () => ({ ok: false, reason: "refused" }) });
    expect(p.willBuildPage).toBe(false);
    expect(p.label).toBe("A movie (2006)");
    expect(p.error).toMatch(/refused/);
  });

  it("a read slower than the limit answers partial, never blocks", async () => {
    const p = await buildImportPreview({ url: ellisUrl, title: "Slow" },
      { fetchPageHtml: () => new Promise(() => {}) }, { timeoutMs: 20 });
    expect(p.partial).toBe(true);
    expect(p.label).toBe("Slow");
  });

  it("a selection clip previews as text, not as its page — the control", () => {
    expect(stageImportSource({ url: "https://ex.test/a", clip: { meta: { clipShape: "selection", selection: "some words" } } }))
      .toEqual({ kind: "text", text: "some words", title: null });
  });

  it("bodyLines drops picture lines and markup", () => {
    expect(bodyLinesOf("# Title\n\n![](x.jpg)\n\n> a **quote**\n\nText.")).toEqual(["Title", "a quote", "Text."]);
  });
});

describe("applyImportOverrides", () => {
  const md = "# T\n\n![](a.jpg)\n\nFirst para.\n\n![](b.jpg)\n\nSecond para.";
  const meta = { title: "T", images: [{ url: "a.jpg" }, { url: "b.jpg" }] };
  it("the edited label, body and pictures reach the page", () => {
    const out = applyImportOverrides(md, meta, { title: "Mine", body: "My words.", images: ["b.jpg"] });
    expect(out.meta.title).toBe("Mine");
    expect(out.markdown).toContain("My words.");
    expect(out.markdown).not.toContain("First para.");
    expect(out.markdown).toContain("Second para.");
    expect(out.markdown).not.toContain("a.jpg");
    expect(out.meta.images).toEqual([{ url: "b.jpg" }]);
  });
  it("no overrides changes nothing — the control", () => {
    expect(applyImportOverrides(md, meta, {})).toEqual({ markdown: md, meta });
  });
});

describe("a link placed by hand", () => {
  const share = { type: "link", props: { url: ellisUrl }, externalId: `link:${ellisUrl}`, label: "Albert Ellis - Wikipedia" };
  it("importAs page: the page is built in the chosen place, titled by the edited label", async () => {
    const r = await placeManually({ share, placement: { parentId: "board1", importAs: "page", label: "Ellis" }, userId: "u1", gridId: "g1" });
    expect(jobCalls[0]).toMatchObject({ source: { kind: "link", url: ellisUrl }, parentId: "board1", overrides: { title: "Ellis" } });
    expect(ranOps).toHaveLength(0);
    expect(r.ran[0].created[0]).toMatchObject({ occurrenceId: "page1" });
  });
  it("importAs page that cannot be read falls back to the bookmark", async () => {
    const bad = { ...share, props: { url: "https://unreadable.test/a" }, externalId: "link:https://unreadable.test/a" };
    const r = await placeManually({ share: bad, placement: { parentId: "board1", importAs: "page" }, userId: "u1", gridId: "g1" });
    expect(jobCalls).toHaveLength(1);
    expect(ranOps).toHaveLength(1);                      // the bookmark CREATE ran
    expect(r.ran[0].created[0]).toMatchObject({ occurrenceId: "bm1" });
    expect(r.ran[0].pageError).toBe("timed out");
  });
  it("importAs both: the bookmark now, its page queued beside it and linked to it", async () => {
    await placeManually({ share, placement: { parentId: "board1", importAs: "both" }, userId: "u1", gridId: "g1" });
    expect(ranOps).toHaveLength(1);
    expect(queued[0]).toMatchObject({ parentId: "board1", linkTo: "bm1" });
  });
  it("no importAs is a bookmark only — the control", async () => {
    await placeManually({ share, placement: { parentId: "board1" }, userId: "u1", gridId: "g1" });
    expect(ranOps).toHaveLength(1);
    expect(jobCalls).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });
});
