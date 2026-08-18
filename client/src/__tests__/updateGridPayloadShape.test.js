// `update_grid` HAS ONE PAYLOAD SHAPE, AND TWO OF ITS THREE CALL SITES HAD DRIFTED.
//
// The server reads the patch from `payload.grid` (falling back to the rest of
// the payload). Two emits in `bindSocketToStore` sent `{ gridId, patch: {...} }`
// instead — which resolves to `{ patch: {...} }`, a key no schema declares, so
// Mongoose strict mode dropped it whole. Both dispatched LOCALLY first, so the
// change appeared on screen and reverted on the next load when `full_state`
// sent the stored value back.
//
// That is what kept the grid's date filter stuck nine days in the past
// (user, 2026-08-18) while every page around it had moved to today.
//
// A GREP, NOT A MOUNT, deliberately: the defect is which KEY leaves the client,
// and no behavioural test caught it precisely because both call sites updated
// local state correctly. This is the same shape as `noDomainKnowledge.test.js`
// — a contract enforced over the source, so the next call site cannot quietly
// reintroduce it.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// `safeEmit(socket, "update_grid", { ... })` — capture the object literal.
const EMIT = /safeEmit\(\s*socket\s*,\s*"update_grid"\s*,\s*(\{[^}]*\})/g;

describe("update_grid payload shape", () => {
  const hits = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(EMIT)) {
      hits.push({ file: path.relative(SRC, file), payload: m[1].replace(/\s+/g, " ") });
    }
  }

  it("finds the emit sites at all — a zero here would make every assertion vacuous", () => {
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("every emit sends the patch under `grid`, which is the key the server reads", () => {
    const bad = hits.filter(h => !/\bgrid\b\s*[:,}]/.test(h.payload));
    expect(bad).toEqual([]);
  });

  it("NO emit sends it under `patch` — that key is silently dropped on save", () => {
    const bad = hits.filter(h => /\bpatch\s*:/.test(h.payload));
    expect(bad).toEqual([]);
  });
});
