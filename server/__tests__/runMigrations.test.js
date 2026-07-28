// __tests__/runMigrations.test.js
//
// The migration runner is how `poms grid` changes now that the seed can't
// touch it, so its bookkeeping is the thing to lock down: run each migration
// exactly once, in order, and never silently skip or repeat one.
//
// The end-to-end path (discovery → dry run → auto-snapshot → apply → record →
// stop-and-point-at-the-snapshot on failure) was exercised by hand against
// `test grid 2`, the disposable grid — never against live data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

import { loadMigrations, pendingFor } from "../scripts/runMigrations.js";

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moduli-mig-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function write(name, body) {
  fs.writeFileSync(path.join(tmp, name), body);
}
const ok = (id) => `export const id = ${JSON.stringify(id)};
export const describe = "test";
export async function up() {}`;

describe("loadMigrations", () => {
  it("returns nothing for a missing directory", async () => {
    expect(await loadMigrations(path.join(tmp, "nope"))).toEqual([]);
  });

  it("loads NNNN-named files in id order regardless of directory order", async () => {
    write("0003-c.mjs", ok("0003-c"));
    write("0001-a.mjs", ok("0001-a"));
    write("0002-b.mjs", ok("0002-b"));
    const got = await loadMigrations(tmp);
    expect(got.map(m => m.id)).toEqual(["0001-a", "0002-b", "0003-c"]);
  });

  it("ignores files that are not migrations (README, drafts, .js)", async () => {
    write("0001-a.mjs", ok("0001-a"));
    write("README.md", "# notes");
    write("draft.mjs", ok("draft"));
    write("0002-b.js", ok("0002-b"));
    const got = await loadMigrations(tmp);
    expect(got.map(m => m.id)).toEqual(["0001-a"]);
  });

  it("rejects a migration missing its id or up()", async () => {
    write("0001-bad.mjs", `export const describe = "no id";`);
    await expect(loadMigrations(tmp)).rejects.toThrow(/must export an `id` and an `up`/);
  });

  it("rejects DUPLICATE ids — two files claiming the same id would break the applied-list", async () => {
    write("0001-a.mjs", ok("same-id"));
    write("0002-b.mjs", ok("same-id"));
    await expect(loadMigrations(tmp)).rejects.toThrow(/Duplicate migration id: same-id/);
  });

  it("defaults describe when a migration omits it", async () => {
    write("0001-a.mjs", `export const id = "0001-a";\nexport async function up() {}`);
    const [m] = await loadMigrations(tmp);
    expect(m.describe).toBe("(no description)");
  });
});

describe("pendingFor", () => {
  const migs = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns everything when nothing has been applied", () => {
    expect(pendingFor(migs, []).map(m => m.id)).toEqual(["a", "b", "c"]);
  });

  it("skips already-applied ids — this is what makes a re-run a no-op", () => {
    expect(pendingFor(migs, ["a", "b"]).map(m => m.id)).toEqual(["c"]);
  });

  it("returns nothing when all are applied", () => {
    expect(pendingFor(migs, ["a", "b", "c"])).toEqual([]);
  });

  it("--only narrows to a single migration", () => {
    expect(pendingFor(migs, [], { only: "b" }).map(m => m.id)).toEqual(["b"]);
  });

  it("--only still respects the applied list without --force", () => {
    expect(pendingFor(migs, ["b"], { only: "b" })).toEqual([]);
  });

  it("--force re-runs an applied migration", () => {
    expect(pendingFor(migs, ["b"], { only: "b", force: true }).map(m => m.id)).toEqual(["b"]);
  });

  it("tolerates a missing applied list (a grid that has never been migrated)", () => {
    expect(pendingFor(migs).map(m => m.id)).toEqual(["a", "b", "c"]);
  });
});
