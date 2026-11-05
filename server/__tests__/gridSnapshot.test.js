// A cold load reads the whole grid at ~103 KB/s (Atlas's own limit: measured 2026-11-05, compression changes nothing), so a
// restart left poms unopenable for 11 minutes. The cache is kept on disk and only what changed is read back.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "bson";
import { saveSnapshot, loadSnapshot, planReconcile, reconcileRows, migrationLedger } from "../services/gridSnapshot.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const t = (s) => new Date(`2026-11-05T${s}Z`);
const uc = () => ({
  modulesById: { m1: { id: "m1", label: "Movie", updatedAt: t("10:00:00"), fieldBindings: [{ _id: new ObjectId("6a690f6fb8e785df961a9f3c"), fieldId: "f" }] } },
  occurrencesById: { o1: { id: "o1", moduleId: "m1", n: 7, fields: { f: { value: 1.5 } }, textmap: { type: "doc", content: [{ type: "text", text: "é\nline" }] }, updatedAt: t("10:00:01"), when: null } },
});

describe("save and load", () => {
  it("brings every row back exactly, with real Dates, ObjectIds and numbers", async () => {
    const a = uc();
    await saveSnapshot({ gridId: "g", userId: "u", uc: a, ledger: "L", dir });
    const s = await loadSnapshot({ gridId: "g", userId: "u", ledger: "L", dir });
    expect(s.occurrencesById).toEqual(a.occurrencesById);
    expect(s.modulesById.m1.updatedAt).toBeInstanceOf(Date);
    expect(s.modulesById.m1.fieldBindings[0]._id.toHexString()).toBe("6a690f6fb8e785df961a9f3c");
    expect(typeof s.occurrencesById.o1.n).toBe("number");
    expect(s.savedAt).toBeInstanceOf(Date);
  });
  it("a missing or torn file is no snapshot, never a partial grid", async () => {
    expect(await loadSnapshot({ gridId: "g", userId: "u", ledger: "L", dir })).toBeNull();
    await saveSnapshot({ gridId: "g", userId: "u", uc: uc(), ledger: "L", dir });
    const f = path.join(dir, "g.ndjson");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").slice(0, -2).join("\n") + "\n");
    expect(await loadSnapshot({ gridId: "g", userId: "u", ledger: "L", dir })).toBeNull();
  });
  it.each([
    ["another user", { userId: "x" }],
    ["a migration has run since (they write past updatedAt)", { ledger: "L2" }],
    ["too old", { maxAgeMs: -1 }],
  ])("is refused when %s", async (_n, over) => {
    await saveSnapshot({ gridId: "g", userId: "u", uc: uc(), ledger: "L", dir });
    expect(await loadSnapshot({ gridId: "g", userId: "u", ledger: "L", dir, ...over })).toBeNull();
  });
  it("writes through a temp file, so a crash mid-save leaves the old snapshot", async () => {
    await saveSnapshot({ gridId: "g", userId: "u", uc: uc(), ledger: "L", dir });
    expect(fs.readdirSync(dir)).toEqual(["g.ndjson"]);
  });
});

describe("planReconcile", () => {
  const snap = { a: { id: "a", updatedAt: t("10:00:00") }, b: { id: "b", updatedAt: t("10:00:00") }, c: { id: "c", updatedAt: t("10:00:00") }, d: { id: "d" } };
  it("fetches what changed or is new or has no stamp, drops what is gone, leaves the rest", () => {
    const scan = [{ id: "a", updatedAt: t("10:00:00") }, { id: "b", updatedAt: t("10:05:00") }, { id: "d", updatedAt: t("10:00:00") }, { id: "new", updatedAt: t("10:00:00") }];
    const p = planReconcile(snap, scan);
    expect(p.fetchIds.sort()).toEqual(["b", "d", "new"]);
    expect(p.dropIds).toEqual(["c"]);
  });
  it("compares moments, not spellings: a cached ISO string equals the same Date", () => {
    expect(planReconcile({ a: { id: "a", updatedAt: "2026-11-05T10:00:00.000Z" } }, [{ id: "a", updatedAt: t("10:00:00") }]).fetchIds).toEqual([]);
  });
});

describe("reconcileRows", () => {
  const model = (rows) => {
    const calls = [];
    return { calls, find: (filter, projection) => ({ lean: async () => {
      calls.push({ filter, projection });
      const pick = filter.id?.$in ? rows.filter((r) => filter.id.$in.includes(r.id)) : rows;
      return projection ? pick.map((r) => ({ id: r.id, updatedAt: r.updatedAt })) : pick;
    } }) };
  };
  it("ends equal to the database, reading whole rows only for what changed", async () => {
    const db = [{ id: "a", updatedAt: t("10:00:00"), v: "same" }, { id: "b", updatedAt: t("10:05:00"), v: "new" }];
    const M = model(db);
    const out = await reconcileRows({ snapshotById: { a: { id: "a", updatedAt: t("10:00:00"), v: "same" }, b: { id: "b", updatedAt: t("10:00:00"), v: "old" }, gone: { id: "gone", updatedAt: t("10:00:00") } },
      Model: M, filter: { userId: "u", gridId: "g" }, shape: (r) => ({ ...r, shaped: true }) });
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
    expect(out.b).toMatchObject({ v: "new", shaped: true });
    expect(out.a.shaped).toBeUndefined();
    expect(M.calls[1].filter.id.$in).toEqual(["b"]);
    expect(M.calls[1].filter.userId).toBe("u");
  });
});

describe("migrationLedger", () => {
  it("moves when a migration is applied", () => {
    expect(migrationLedger({ meta: { migrations: [{ id: "a" }] } })).not.toBe(migrationLedger({ meta: { migrations: [{ id: "a" }, { id: "b" }] } }));
    expect(migrationLedger({})).toBe(migrationLedger({ meta: {} }));
  });
});
