// server/__tests__/importCorrections.test.js — plan Task 8: your fixes become the clean-up's examples.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordCorrection, examplesFor, importRootOf } from "../services/importCorrections.js";

// An in-memory ImportCorrection with the query shapes the service uses.
function memModel() {
  const rows = [];
  let n = 0;
  const match = (r, q) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && "$gt" in v ? r[k] > v.$gt : r[k] === v));
  const chain = (list) => ({ sort: () => chain([...list].sort((a, b) => b.createdAt - a.createdAt)), limit: (k) => chain(list.slice(0, k)), lean: async () => list });
  return {
    rows,
    create: async (d) => { rows.push({ _id: `c${++n}`, ...d }); },
    updateOne: async ({ _id }, { $set }) => { Object.assign(rows.find((r) => r._id === _id), $set); },
    findOne: (q) => ({ sort: () => ({ lean: async () => [...rows].filter((r) => match(r, q)).sort((a, b) => b.createdAt - a.createdAt)[0] || null }) }),
    find: (q) => chain(rows.filter((r) => match(r, q))),
  };
}
const tm = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const ucFor = (importedAt) => ({
  modulesById: { "m-tb": { id: "m-tb", role: "textblock" }, "m-row": { id: "m-row", role: "instance" } },
  occurrencesById: {
    root: { id: "root", meta: { importSource: { kind: "link", url: "https://www.bbc.co.uk/news/1" }, importedAt } },
    sec: { id: "sec", parentId: "root" },
    tb: { id: "tb", parentId: "sec", moduleId: "m-tb" },
    loose: { id: "loose", moduleId: "m-tb" },
  },
});
const args = (uc, extra = {}) => ({ occurrence: { id: "tb", moduleId: "m-tb", parentId: "sec" }, prevTextmap: tm("I know! | don't"),
  nextTextmap: tm("I know! I don't"), uc, userId: "u", gridId: "g", now: NOW, ...extra });

let model;
beforeEach(() => { model = memModel(); });

describe("recordCorrection", () => {
  it("a user edit to a textblock of a 2-day-old import is recorded, with its site", async () => {
    await recordCorrection(args(ucFor(daysAgo(2))), { model });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({ rootOccurrenceId: "root", occurrenceId: "tb", kind: "link", site: "www.bbc.co.uk",
      before: "I know! | don't", after: "I know! I don't" });
  });
  it("an import 20 days old is not", async () => {
    await recordCorrection(args(ucFor(daysAgo(20))), { model });
    expect(model.rows).toHaveLength(0);
  });
  it("a textblock not under an import is not", async () => {
    await recordCorrection(args(ucFor(daysAgo(2)), { occurrence: { id: "loose", moduleId: "m-tb" } }), { model });
    expect(model.rows).toHaveLength(0);
  });
  it("a row that is not a textblock is not", async () => {
    await recordCorrection(args(ucFor(daysAgo(2)), { occurrence: { id: "tb", moduleId: "m-row", parentId: "sec" } }), { model });
    expect(model.rows).toHaveLength(0);
  });
  it("two edits 2 minutes apart are one record holding the latest text", async () => {
    await recordCorrection(args(ucFor(daysAgo(2))), { model });
    await recordCorrection(args(ucFor(daysAgo(2)), { prevTextmap: tm("I know! I don't"), nextTextmap: tm("I know, I don't."),
      now: new Date(NOW.getTime() + 120000) }), { model });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({ before: "I know! | don't", after: "I know, I don't." });
  });
  it("a store that throws is swallowed — the write path never sees it", async () => {
    const broken = { findOne: () => { throw new Error("db down"); } };
    await expect(recordCorrection(args(ucFor(daysAgo(2))), { model: broken })).resolves.toBeNull();
  });
});

describe("examplesFor", () => {
  it("the same site first, even when another site's is newer", async () => {
    model.rows.push(
      { _id: "a", userId: "u", gridId: "g", kind: "link", site: "other.test", before: "x", after: "y", createdAt: new Date(NOW - 1000) },
      { _id: "b", userId: "u", gridId: "g", kind: "link", site: "www.bbc.co.uk", before: "p", after: "q", createdAt: new Date(NOW - 99999) },
    );
    const ex = await examplesFor({ userId: "u", gridId: "g", kind: "link", site: "www.bbc.co.uk", limit: 1 }, { model });
    expect(ex).toEqual([{ before: "p", after: "q" }]);
  });
});

describe("the write path", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "..", "socketHandlers", "occurrences.js"), "utf8");
  it("update_occurrence records only a user's own text edit, and never awaits it", () => {
    const i = src.indexOf("recordCorrection(");
    expect(i).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, i - 600), i);
    expect(before).toMatch(/payload\?\.__actionId && textmap !== undefined/);
    expect(before).not.toMatch(/await import\("\.\.\/services\/importCorrections/);
    expect(src.slice(i, i + 400)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
  it("importRootOf stops after 6 hops — the control", () => {
    const occ = {};
    for (let i = 0; i < 9; i++) occ[`n${i}`] = { id: `n${i}`, parentId: i < 8 ? `n${i + 1}` : null, ...(i === 8 ? { meta: { importSource: {} } } : {}) };
    expect(importRootOf(occ.n0, occ)).toBeNull();
    expect(importRootOf(occ.n3, occ)?.id).toBe("n8");
  });
});
