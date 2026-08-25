// A scoped pre-migration snapshot — and the restore rule that makes it safe.
//
// The danger this file exists for: `readBackup` used to read an ABSENT
// collection file as `[]`, and the restore deletes every document of a
// collection before inserting the backup's. So a partial backup, restored
// naively, would DELETE EVERY OCCURRENCE ON THE GRID and insert nothing.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readBackup, restoreRefusal } from "../scripts/restoreGrid.js";
import { BACKUP_COLLECTIONS } from "../scripts/backupGrid.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));

function makeBackup({ partial, collections, counts, files }) {
  write("manifest.json", { grid: { id: "g1" }, counts, partial, collections });
  write("grid.json", { _id: "g1", name: "poms grid" });
  for (const [n, docs] of Object.entries(files)) write(`${n}.json`, docs);
}

describe("readBackup — a PARTIAL backup", () => {
  it("reports which collections it can speak for", () => {
    makeBackup({ partial: true, collections: ["fields"], counts: { grid: 1, fields: 2 },
                 files: { fields: [{ id: "f1" }, { id: "f2" }] } });
    const r = readBackup(dir);
    expect(r.partial).toBe(true);
    expect(r.collections).toEqual(["fields"]);
    expect(r.data.fields).toHaveLength(2);
  });

  it("does NOT invent an empty array for a collection it never captured", () => {
    // THE WHOLE POINT. `data.occurrences` being `[]` is what would make the
    // restore delete them all.
    makeBackup({ partial: true, collections: ["fields"], counts: { grid: 1, fields: 1 },
                 files: { fields: [{ id: "f1" }] } });
    expect(readBackup(dir).data.occurrences).toBeUndefined();
  });

  it("REFUSES a backup that names a collection whose file is missing", () => {
    // A truncated write must be caught before anything is deleted.
    makeBackup({ partial: true, collections: ["fields", "modules"], counts: { grid: 1, fields: 1 },
                 files: { fields: [{ id: "f1" }] } });
    expect(() => readBackup(dir)).toThrow(/modules\.json is missing/);
  });
});

describe("readBackup — an OLD backup, taken before any of this existed", () => {
  it("is treated as FULL, so it behaves exactly as it always did", () => {
    // No `collections` in the manifest. Every pre-2026-08-24 backup on disk is
    // this shape, and each must still restore the whole grid.
    const files = Object.fromEntries(BACKUP_COLLECTIONS.map((c) => [c.name, []]));
    write("manifest.json", { grid: { id: "g1" }, counts: { grid: 1 } });
    write("grid.json", { _id: "g1" });
    for (const [n, d] of Object.entries(files)) write(`${n}.json`, d);
    const r = readBackup(dir);
    expect(r.partial).toBe(false);
    expect(r.collections).toEqual(BACKUP_COLLECTIONS.map((c) => c.name));
  });
});

describe("the count check still runs", () => {
  it("catches a file whose length disagrees with the manifest", () => {
    makeBackup({ partial: true, collections: ["fields"], counts: { grid: 1, fields: 5 },
                 files: { fields: [{ id: "f1" }] } });
    expect(() => readBackup(dir)).toThrow(/inconsistent/);
  });
});

// ── THE RULE THE RUNNER APPLIES, AND THE BUG IT SHIPPED WITH ───────────────
//
// The first version computed this inline from `m.touches` — and
// `loadMigrations` did not carry `touches` through, so it was `undefined` for
// every migration and the scope never fired. Nothing failed; the runner just
// printed "full grid" and read all 18,000 occurrences. Only running it found
// that, so the rule is a pure function now and the loader is pinned below.
import { snapshotScope, loadMigrations } from "../scripts/runMigrations.js";

describe("snapshotScope", () => {
  it("scopes when EVERY pending migration declares what it touches", () => {
    expect(snapshotScope([{ touches: ["fields"] }, { touches: ["fields"] }])).toEqual(["fields"]);
  });

  it("unions the declarations", () => {
    expect(snapshotScope([{ touches: ["fields"] }, { touches: ["operations", "fields"] }]).sort())
      .toEqual(["fields", "operations"]);
  });

  it("FAILS SAFE — one undeclared migration means the full snapshot", () => {
    // The discriminating case. An unaudited migration must not ride along on
    // its neighbour's promise about what it writes.
    expect(snapshotScope([{ touches: ["fields"] }, { id: "0999" }])).toBeNull();
  });

  it("treats an empty declaration as no declaration", () => {
    expect(snapshotScope([{ touches: [] }])).toBeNull();
    expect(snapshotScope([])).toBeNull();
  });
});

describe("loadMigrations", () => {
  // 20s, not the 5s default: this dynamically imports EVERY migration in the
  // directory — 245 of them as of 2026-08-25 — and the cost grows by one file
  // per migration. Alone the whole file runs in ~2s; under the parallel suite
  // it crossed 5s when 0236/0237 landed. The assertion below was never the
  // problem (it passes in isolation), so raising the budget is the honest fix
  // rather than trimming what it checks.
  it("CARRIES `touches` through — the field the first version silently dropped", async () => {
    const all = await loadMigrations();
    const scoped = all.filter((m) => Array.isArray(m.touches));
    expect(scoped.length).toBeGreaterThan(0);
    for (const m of scoped) expect(m.touches).toContain("fields");
  }, 20000);
});

// A partial backup can roll its own grid back. It cannot clone one — that would
// produce a grid with no occurrences, which reads as catastrophic data loss.
describe("restoreRefusal", () => {
  it("refuses to CLONE from a partial backup, naming what it does cover", () => {
    const why = restoreRefusal({ partial: true, collections: ["fields"], intoDb: "scratch" });
    expect(why).toMatch(/PARTIAL/);
    expect(why).toMatch(/fields/);
  });

  it("ALLOWS a partial backup to roll its own grid back — its whole purpose", () => {
    // The discriminating case: the refusal must not disarm the rollback the
    // scoped snapshot exists to provide.
    expect(restoreRefusal({ partial: true, collections: ["fields"], intoDb: null })).toBeNull();
  });

  it("lets a FULL backup clone as it always could", () => {
    expect(restoreRefusal({ partial: false, collections: ["occurrences"], intoDb: "scratch" })).toBeNull();
  });
});
