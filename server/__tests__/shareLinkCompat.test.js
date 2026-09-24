// server/__tests__/shareLinkCompat.test.js
//
// D15 — a clip routed through /share must land EXACTLY as it did through
// /ingest on day one. Driven end to end with the extension's OWN
// `buildClipRecord`, the real ingress, the real catch-all pipeline and the real
// server executor; only the mint (the database write) is stubbed, and what it
// is asked to write is compared against the record /ingest would have written.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildClipRecord } from "../../extension/clip.js";

const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (a) => { minted.push(a); return { occurrenceId: "o", status: "created" }; },
}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));
vi.mock("../models/Module.js", () => ({ default: { findOne: () => ({ lean: async () => null }) } }));
vi.mock("../models/Occurrence.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => (q.id === "files-g1" ? { id: "files-g1" } : null) }),
}}));

const { prepareShare } = await import("../services/shareIngress.js");
const { catchAllPipeline } = await import("../utils/shareRulesEnsure.js");
const { runOperationServerSide } = await import("../services/serverExecutor.js");

const fieldIds = { URL: "fUrl", Excerpt: "fExc", Cover: "fCov", Tags: "fTag" };
const catchAll = { id: "catch", pipeline: catchAllPipeline("files-g1") };

// What background.js sends, built from the extension's own record.
async function viaShare(record, extra = {}) {
  const share = await prepareShare({
    userId: "u1", gridId: "g1", source: "extension",
    url: record.moduleFileRef, shape: record.meta.clipShape, clip: record, ...extra,
    fetchPreview: async () => { throw new Error("a clip must not be fetched"); },
  });
  const r = await runOperationServerSide(catchAll, { userId: "u1", gridId: "g1", vars: { $share: share } });
  expect(r.ok).toBe(true);
  expect(minted).toHaveLength(1);
  return minted[0];
}

// The same assertion for every shape: every key /ingest wrote, written again.
function expectSameAsIngest(m, record) {
  expect(m.label).toBe(record.label);
  expect(m.externalId).toBe(record.externalId);
  expect(m.source).toBe("clip");               // /ingest's (source, externalId) identity
  expect(m.moduleRole).toBe(record.moduleRole);
  expect(m.moduleKind).toBe(record.moduleKind);
  expect(m.moduleFileRef).toBe(record.moduleFileRef);
  expect(m.fields).toEqual(record.fields);
  expect(m.meta).toEqual(record.meta);
  expect(typeof m.resolveModule).toBe("function"); // module reused by fileRef, as /ingest does
}

beforeEach(() => { minted.length = 0; });

describe("an extension clip through /share is the /ingest clip", () => {
  it("page", async () => {
    const record = buildClipRecord({ info: { menuItemId: "clip-page", pageUrl: "https://ex.test/a" },
      tab: { url: "https://ex.test/a", title: "A page" }, fieldIds, parentId: "box" });
    const m = await viaShare(record);
    expectSameAsIngest(m, record);
    expect(m.parentId).toBe("box");
  });

  it("selection keeps its Excerpt", async () => {
    const record = buildClipRecord({ info: { menuItemId: "clip-selection", pageUrl: "https://ex.test/a",
      selectionText: "  a quoted line  " }, tab: { url: "https://ex.test/a", title: "A" }, fieldIds, parentId: "box" });
    const m = await viaShare(record, { text: "a quoted line" });
    expectSameAsIngest(m, record);
    expect(m.fields.fExc.value).toBe("a quoted line");
  });

  it("link — bookmarked WITHOUT fetching it", async () => {
    const record = buildClipRecord({ info: { menuItemId: "clip-link", pageUrl: "https://ex.test/a",
      linkUrl: "https://other.test/b", linkText: "Other" }, tab: { url: "https://ex.test/a", title: "A" }, fieldIds, parentId: "box" });
    expectSameAsIngest(await viaShare(record), record);
  });

  it("image keeps its image shape and Cover", async () => {
    const record = buildClipRecord({ info: { menuItemId: "clip-image", pageUrl: "https://ex.test/a",
      srcUrl: "https://ex.test/i.png" }, tab: { url: "https://ex.test/a", title: "A" }, fieldIds, parentId: "box" });
    const m = await viaShare(record);
    expectSameAsIngest(m, record);
    expect(m.moduleKind).toBe("image");
    expect(m.fields.fCov.value).toBe("https://ex.test/i.png");
  });

  it("an image whose address is a data: URL keeps its OWN identity", async () => {
    // Found on prod: an image clipped from a Google results page is a data:
    // URL, which classifies as a bare "file" — and derived `text:` (empty), so
    // every such clip shared ONE identity and overwrote the last.
    const src = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
    const record = buildClipRecord({ info: { menuItemId: "clip-image", pageUrl: "https://www.google.com/search?q=x",
      srcUrl: src }, tab: { url: "https://www.google.com/search?q=x", title: "x - Google Search" }, fieldIds, parentId: "box" });
    const m = await viaShare(record);
    expectSameAsIngest(m, record);
    expect(m.externalId).toBe(`image:${src}`);
  });

  it("with no destination it lands in Files instead of nowhere (the one deliberate change)", async () => {
    const record = buildClipRecord({ info: { menuItemId: "clip-page", pageUrl: "https://ex.test/a" },
      tab: { url: "https://ex.test/a", title: "A" }, fieldIds });
    const m = await viaShare(record);
    expectSameAsIngest(m, record);
    expect(m.parentId).toBeFalsy();
    expect(m.parentFolderId).toBe("files-g1");
  });
});

describe("the catch-all without a clip is unchanged", () => {
  it("a plain link shared from elsewhere is still a share-sourced row in Files", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", source: "android", url: "https://ex.test/z" });
    await runOperationServerSide(catchAll, { userId: "u1", gridId: "g1", vars: { $share: share } });
    expect(minted[0].source).toBe("share");
    expect(minted[0].parentFolderId).toBe("files-g1");
    expect(minted[0].externalId).toBe("link:https://ex.test/z");
  });
});

// background.js is an MV3 worker and cannot run here, so its wiring is pinned
// by source: it posts to /share, carries the record as `clip`, and no longer
// writes through /ingest behind the rules' back.
import fs from "node:fs";
import path from "node:path";
describe("extension/background.js wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../extension/background.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("posts to /api/v1/share with the clip record attached", () => {
    expect(src).toMatch(/\/api\/v1\/share/);
    expect(src).toMatch(/clip:\s*record/);
    expect(src).toMatch(/source:\s*"extension"/);
  });
  it("no longer posts to /api/v1/ingest", () => {
    expect(src).not.toMatch(/\/api\/v1\/ingest/);
  });
});
