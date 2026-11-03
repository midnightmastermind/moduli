import { test } from "node:test";
import assert from "node:assert/strict";
import { rectOnScreen, tapSizeVerdict, jargonHits } from "../checks.mjs";
import { formatRow, appendRows } from "../report.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("a rect past the edge says by how much", () => {
  assert.deepEqual(rectOnScreen({ x: -3, y: 10, width: 50, height: 20 }, { width: 390, height: 844 }), { ok: false, offBy: 3 });
  assert.deepEqual(rectOnScreen({ x: 370, y: 10, width: 50, height: 20 }, { width: 390, height: 844 }), { ok: false, offBy: 30 });
  assert.deepEqual(rectOnScreen({ x: 10, y: 10, width: 50, height: 20 }, { width: 390, height: 844 }), { ok: true, offBy: 0 });
});

test("tap size: under 24px fails, under 32 is small", () => {
  assert.equal(tapSizeVerdict(20, 40), "fail");
  assert.equal(tapSizeVerdict(28, 40), "small");
  assert.equal(tapSizeVerdict(32, 32), "ok");
});

test("jargon a person would not know", () => {
  assert.deepEqual(jargonHits("Add occurrence here"), ["occurrence"]);
  assert.deepEqual(jargonHits("Board container"), []);
  assert.equal(jargonHits("p4sq3tf2ghse").length, 1);
  assert.deepEqual(jargonHits("Copy-link"), []);
  assert.deepEqual(jargonHits("copylink this"), ["copylink"]);
  assert.deepEqual(jargonHits("Delete 3 selected"), []);
});

test("the report appends rows under its table and keeps what was there", () => {
  const f = path.join(os.tmpdir(), `uisweep-${Date.now()}.md`);
  fs.writeFileSync(f, "# Report\n\n| # | Surface |\n|---|---|\n");
  appendRows(f, [{ id: "toolbar.grid", surface: "Grid picker", control: "Open", vp: "desktop", works: "✅", reach: "✅", a11y: "✅", clear: "✅", fast: "42ms", notes: "" }]);
  const out = fs.readFileSync(f, "utf8");
  assert.match(out, /^# Report/);
  assert.match(out, /\| toolbar\.grid \| Grid picker \| Open \| desktop \|/);
  assert.equal(formatRow({ id: "a", surface: "b|c" }).includes("b\\|c"), true); // a pipe in text is escaped
});
