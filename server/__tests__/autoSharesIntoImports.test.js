// server/__tests__/autoSharesIntoImports.test.js
//
// Plan Task 4 (smarter imports): Auto files shares into Imports; a link is a bookmark AND its readable page.
// Driven through the REAL executor (runOperationServerSide), the REAL job queue and the REAL retarget of
// poms grid's own rule shapes. The database is an in-memory store; the page builder (runImport, Task 3,
// tested on its own) is stubbed so each case controls what the import returns.
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map();          // occurrence id -> row
const runImportCalls = [];
let runImportImpl = async () => ({ empty: false, rootOccurrenceId: "page1" });

const get = (o, path) => path.split(".").reduce((v, k) => (v == null ? v : v[k]), o);
const matches = (row, q) => Object.entries(q).every(([k, v]) => {
  const have = get(row, k);
  if (v && typeof v === "object" && "$ne" in v) return !(Array.isArray(have) ? have.includes(v.$ne) : have === v.$ne);
  if (k === "occurrences") return Array.isArray(have) && have.includes(v);
  return have === v;
});
const findRow = (q) => [...store.values()].find((r) => matches(r, q)) || null;
const setPath = (o, path, v) => { const ks = path.split("."); let c = o; for (const k of ks.slice(0, -1)) c = c[k] ||= {}; c[ks.at(-1)] = v; };

vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => structuredClone(findRow(q)) }),
  findOneAndUpdate: async (q, u) => {
    const row = findRow(q); if (!row) return null;
    for (const [k, v] of Object.entries(u.$set || {})) setPath(row, k, v);
    for (const [k, v] of Object.entries(u.$pull || {})) row[k] = (row[k] || []).filter((x) => x !== v);
    return structuredClone(row);
  },
}}));
vi.mock("../models/Module.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => (q.id === "imgMod" ? { id: "imgMod", fileRef: "user/2026-11/pic.jpg" } : null) }),
}}));
vi.mock("../models/Folder.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => (q.id === "imports" || q.name === "Imports" ? { id: "imports" } : q.id === "files" ? { id: "files" } : null) }),
}}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (a) => {
    const prior = [...store.values()].find((r) => r.externalId && r.externalId === a.externalId);
    if (prior) return { occurrenceId: prior.id, status: "updated" };
    const id = `occ${store.size + 1}`;
    store.set(id, { id, userId: a.userId, gridId: a.gridId, label: a.label, parentId: a.parentFolderId || a.parentId, externalId: a.externalId, meta: {} });
    return { occurrenceId: id, status: "created" };
  },
}));
vi.mock("../services/importPipeline.js", () => ({
  runImport: async (args, deps) => { runImportCalls.push(args); return runImportImpl(args, deps); },
}));

const { runOperationServerSide } = await import("../services/serverExecutor.js");
const { retargetShareRule } = await import("../migrations/0489-auto-shares-into-imports.mjs");
const { whenImportsIdle } = await import("../services/importJobs.js");

const trig = (shareType) => [{ eventType: "onShare", shareType }];
const create = (cfg) => ({ id: `s-${Math.random()}`, type: "action", config: { type: "CREATE", ...cfg } });
const handled = { id: "h", type: "action", config: { type: "SET_VAR", name: "$share.handled", value: "true" } };

// The shapes poms grid stores (read out of Mongo 2026-11-10), trimmed to what the retarget reads.
const linkRule = { id: "link", name: "Share: link", triggerObjects: trig("link"), pipeline: { steps: [
  create({ parent: "bookmarksBoard", name: "$share.label", externalId: "$share.externalId", role: "artifact", kind: "bookmark", moduleFileRef: "$share.props.url" }),
  handled,
]}};
const textRule = { id: "text", name: "Share: text", triggerObjects: trig("text"), pipeline: { steps: [
  create({ parent: "lookupBoard", role: "instance", name: "$share.label", externalId: "$share.externalId" }), handled,
]}};
const imageRule = { id: "image", name: "Share: image", triggerObjects: trig("image"), pipeline: { steps: [handled] } };
const calendarRule = { id: "ics", name: "Share: calendar", triggerObjects: trig("ics"), pipeline: { steps: [create({ parent: "$dest", name: "$e.summary" }), handled] } };
const contactRule = { id: "contact", name: "Share: add contact", triggerObjects: trig("contact"), pipeline: { steps: [create({ parent: "literal:people", name: "$share.person.name" })] } };
const catchAll = { id: "catch", name: "Share: anything else", triggerObjects: trig("*"), meta: { catchAllVersion: 2 }, pipeline: { steps: [{
  id: "i", type: "if", condition: { operator: "AND", rules: [{ left: "$share.clip", comparator: "IS_NOT_EMPTY", right: "" }] },
  then: [create({ parentId: "$share.clip.parentId", label: "$share.clip.label" })],
  else: [create({ parentFolderId: "literal:files", label: "$share.label" })],
}]}};

const run = (op, share) => runOperationServerSide(retargetShareRule(op, "imports"), { vars: { $share: share }, userId: "u1", gridId: "g1" });
const linkShare = (url = "https://ex.test/a") => ({ type: "link", props: { url }, externalId: `link:${url}`, label: "A page" });

beforeEach(() => { store.clear(); runImportCalls.length = 0; runImportImpl = async () => ({ empty: false, rootOccurrenceId: "page1" }); });

describe("a link share", () => {
  it("saves one bookmark in Imports, then its readable page; the two point at each other", async () => {
    store.set("page1", { id: "page1", userId: "u1", gridId: "g1", meta: {} });
    const r = await run(linkRule, linkShare());
    expect(r.ok).toBe(true);
    const bm = [...store.values()].find((o) => o.label === "A page");
    expect(bm.parentId).toBe("imports");
    await whenImportsIdle();
    expect(runImportCalls).toHaveLength(1);
    expect(runImportCalls[0]).toMatchObject({ source: { kind: "link", url: "https://ex.test/a" }, parentFolderId: "imports" });
    expect(store.get(bm.id).meta.readerPageId).toBe("page1");
    expect(store.get("page1").meta.bookmarkId).toBe(bm.id);
  });

  it("a page that cannot be fetched keeps the bookmark and says why — never throws", async () => {
    runImportImpl = async () => { throw new Error("timed out"); };
    const r = await run(linkRule, linkShare());
    expect(r.ok).toBe(true);
    await whenImportsIdle();
    const bm = [...store.values()].find((o) => o.label === "A page");
    expect(bm.parentId).toBe("imports");
    expect(bm.meta.readerPageError).toBe("timed out");
    expect(bm.meta.readerPageId).toBeUndefined();
  });

  it("the same link shared twice is one bookmark and one page", async () => {
    store.set("page1", { id: "page1", userId: "u1", gridId: "g1", meta: {} });
    await run(linkRule, linkShare()); await whenImportsIdle();
    const again = await run(linkRule, linkShare()); await whenImportsIdle();
    // The step itself skips (no job queued) — the job's own check is the second line of defence.
    expect(again.effects.find((e) => e._effect === "IMPORT_TO_PAGE")).toMatchObject({ skipped: "bookmark already saved" });
    expect([...store.values()].filter((o) => o.label === "A page")).toHaveLength(1);
    expect(runImportCalls).toHaveLength(1);
  });
});

describe("an image share", () => {
  it("with no text read, the picture alone moves into Imports and no page is made", async () => {
    store.set("files", { id: "files", userId: "u1", gridId: "g1", occurrences: [] });
    store.set("img", { id: "img", userId: "u1", gridId: "g1", moduleId: "imgMod", parentId: "files", meta: {} });
    runImportImpl = async () => ({ empty: true });
    const r = await run(imageRule, { type: "image", props: { occurrenceId: "img" }, externalId: "file:pic.jpg:10" });
    expect(r.ok).toBe(true);
    await whenImportsIdle();
    expect(runImportCalls[0].source).toMatchObject({ kind: "image", imageOccurrenceId: "img", url: "/uploads/user/2026-11/pic.jpg" });
    expect(store.get("img").parentId).toBe("imports");
  });

  it("with text, the page is made and the picture stays in its home — the control", async () => {
    store.set("img", { id: "img", userId: "u1", gridId: "g1", moduleId: "imgMod", parentId: "files", meta: {} });
    await run(imageRule, { type: "image", props: { occurrenceId: "img" }, externalId: "file:pic.jpg:11" });
    await whenImportsIdle();
    expect(store.get("img").parentId).toBe("files");
  });
});

describe("a text share", () => {
  it("long enough: a page, and the old row is not also made", async () => {
    runImportImpl = async () => ({ empty: false, rootOccurrenceId: "textPage" });
    const r = await run(textRule, { type: "text", props: { text: "Some words worth a page." }, externalId: "text:x", label: "Some words" });
    expect(r.scope.$pageId).toBe("textPage");
    expect([...store.values()].filter((o) => o.label === "Some words")).toHaveLength(0);
  });

  it("too short for a page: saved as a row in Imports instead", async () => {
    runImportImpl = async () => ({ empty: true });
    await run(textRule, { type: "text", props: { text: "hi" }, externalId: "text:hi", label: "hi" });
    const row = [...store.values()].find((o) => o.label === "hi");
    expect(row.parentId).toBe("imports");
  });
});

describe("retargetShareRule", () => {
  it("leaves calendar and contact rules alone", () => {
    expect(retargetShareRule(calendarRule, "imports")).toBeNull();
    expect(retargetShareRule(contactRule, "imports")).toBeNull();
  });

  it("a link rule's fixed destination becomes Imports; run twice is no change", () => {
    const once = retargetShareRule(linkRule, "imports");
    const c = once.pipeline.steps[0].config;
    expect(c.parentFolderId).toBe("literal:imports");
    expect(c.parent).toBeUndefined();
    expect(once.pipeline.steps[1].config).toMatchObject({ type: "IMPORT_TO_PAGE", linkTo: c.itemIdVar });
    expect(retargetShareRule(once, "imports")).toBeNull();
  });

  it("the catch-all keeps the extension's own pick and moves only the fixed one", () => {
    const out = retargetShareRule(catchAll, "imports");
    const [ifs] = out.pipeline.steps;
    expect(ifs.then[0].config.parentId).toBe("$share.clip.parentId");
    expect(ifs.else[0].config.parentFolderId).toBe("literal:imports");
    expect(out.meta.catchAllVersion).toBe(3);
  });

  it("refuses with no Imports folder", () => {
    expect(() => retargetShareRule(linkRule, null)).toThrow(/Imports/);
  });
});
