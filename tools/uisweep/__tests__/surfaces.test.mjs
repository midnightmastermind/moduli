import { test } from "node:test";
import assert from "node:assert/strict";
import { SURFACES, AREAS } from "../surfaces.mjs";

const KNOWN = ["toolbar", "commandCenter", "radial", "settings", "header", "add", "context", "docs", "drawers", "viewers", "canvas", "table", "graph", "layout", "phone", "sharing", "account", "forms", "vr-web"];

test("every surface has a unique id, a known area, and an open()", () => {
  const ids = new Set();
  for (const s of SURFACES) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`); ids.add(s.id);
    assert.ok(KNOWN.includes(s.area), `${s.id}: unknown area ${s.area}`);
    assert.equal(typeof s.open, "function", s.id);
    assert.ok(s.root, `${s.id}: no root`);
  }
  assert.ok(AREAS.length >= 10);
});

test("every row of the 2026-10-18 sweep (1–62) is covered by a surface", () => {
  const covered = new Set(SURFACES.flatMap((s) => s.from || []).map(String));
  const missing = [];
  for (let n = 1; n <= 62; n++) if (!covered.has(String(n))) missing.push(n);
  assert.deepEqual(missing, []);
});
