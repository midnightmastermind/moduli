// __tests__/backupRestore.test.js
//
// Pure-logic coverage for the grid backup/restore tooling. The end-to-end drill
// (back up the live grid → restore into a scratch database → hash-compare every
// collection) is documented in the plan and was run by hand; these lock the
// parts that decide whether a restore is TRUSTED, which is the whole job:
//   - a truncated/inconsistent backup must be refused, not restored
//   - the content hash must be order-insensitive but content-sensitive
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

import { slugify, stampNow, listBackups, BACKUP_COLLECTIONS } from "../scripts/backupGrid.js";
import { readBackup, contentHash } from "../scripts/restoreGrid.js";

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moduli-backup-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Write a minimal but VALID backup directory. */
function writeBackup(dir, { occurrences = [{ id: "o1" }], counts = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const data = { occurrences };
  for (const { name } of BACKUP_COLLECTIONS) {
    if (!(name in data)) data[name] = [];
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data[name]));
  }
  fs.writeFileSync(path.join(dir, "grid.json"), JSON.stringify({ _id: "g1", name: "poms grid" }));
  const realCounts = Object.fromEntries(BACKUP_COLLECTIONS.map(c => [c.name, data[c.name].length]));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    grid: { id: "g1", name: "poms grid" },
    counts: counts || { grid: 1, ...realCounts },
    takenAt: new Date().toISOString(),
  }));
  return dir;
}

describe("slugify / stampNow", () => {
  it("slugs a grid name into a safe directory component", () => {
    expect(slugify("poms grid")).toBe("poms-grid");
    expect(slugify("test grid 1")).toBe("test-grid-1");
    expect(slugify("")).toBe("unnamed");
  });

  it("produces a filesystem-safe timestamp (no colons or dots)", () => {
    const s = stampNow(new Date("2026-07-28T14:32:05.123Z"));
    expect(s).toBe("2026-07-28T14-32-05-123Z");
    expect(s).not.toMatch(/[:.]/);
  });
});

describe("readBackup integrity gate", () => {
  it("reads a consistent backup", () => {
    const dir = writeBackup(path.join(tmp, "ok"));
    const { manifest, grid, data } = readBackup(dir);
    expect(manifest.grid.name).toBe("poms grid");
    expect(grid.name).toBe("poms grid");
    expect(data.occurrences).toHaveLength(1);
  });

  it("REFUSES a backup whose file is shorter than the manifest claims", () => {
    // The truncated-write case: the manifest says 3, the file holds 1. Caught
    // BEFORE any live data is deleted to make room for the restore.
    const dir = writeBackup(path.join(tmp, "short"), {
      occurrences: [{ id: "o1" }],
      counts: { grid: 1, occurrences: 3, modules: 0, fields: 0, views: 0,
                manifests: 0, folders: 0, operations: 0, transactions: 0 },
    });
    expect(() => readBackup(dir)).toThrow(/inconsistent.*occurrences: manifest=3 file=1/);
  });

  it("refuses a directory that is not a backup at all", () => {
    fs.mkdirSync(path.join(tmp, "empty"));
    expect(() => readBackup(path.join(tmp, "empty"))).toThrow(/No manifest\.json/);
  });
});

describe("contentHash", () => {
  it("is insensitive to document ORDER (insertion order must not matter)", () => {
    const a = [{ id: "b", v: 2 }, { id: "a", v: 1 }];
    const b = [{ id: "a", v: 1 }, { id: "b", v: 2 }];
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("is insensitive to KEY order within a document", () => {
    expect(contentHash([{ id: "a", x: 1, y: 2 }])).toBe(contentHash([{ id: "a", y: 2, x: 1 }]));
  });

  it("CHANGES when any value changes — the point of the check", () => {
    const base = contentHash([{ id: "a", fields: { f1: { value: 5 } } }]);
    expect(contentHash([{ id: "a", fields: { f1: { value: 6 } } }])).not.toBe(base);
  });

  it("CHANGES when a nested field is dropped (the failure counts alone would miss)", () => {
    const full = contentHash([{ id: "a", fields: { f1: { value: 5 } } }]);
    const stripped = contentHash([{ id: "a", fields: {} }]);
    expect(stripped).not.toBe(full);
  });

  it("normalises Dates to the strings they serialise as, so DB and file compare equal", () => {
    const iso = "2026-07-28T11:34:39.068Z";
    expect(contentHash([{ id: "a", at: new Date(iso) }])).toBe(contentHash([{ id: "a", at: iso }]));
  });
});

describe("listBackups", () => {
  it("returns nothing for a missing directory", () => {
    expect(listBackups(path.join(tmp, "nope"))).toEqual([]);
  });

  it("lists backups newest-first and skips directories with no manifest", () => {
    const root = path.join(tmp, "backups", "poms-grid");
    const older = writeBackup(path.join(root, "a"));
    const newer = writeBackup(path.join(root, "b"));
    const bump = (dir, iso) => {
      const p = path.join(dir, "manifest.json");
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      m.takenAt = iso;
      fs.writeFileSync(p, JSON.stringify(m));
    };
    bump(older, "2026-07-01T00:00:00.000Z");
    bump(newer, "2026-07-28T00:00:00.000Z");
    fs.mkdirSync(path.join(root, "junk"), { recursive: true });

    const rows = listBackups(path.join(tmp, "backups"));
    expect(rows).toHaveLength(2);
    expect(rows[0].takenAt).toBe("2026-07-28T00:00:00.000Z");
  });
});
