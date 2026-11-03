import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cases, CONTEXTS, VARIANTS } from "../fieldMatrix.mjs";

test("the matrix covers every field type the app has", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../../client/src/helpers/fieldTypes.js"), "utf8");
  const types = [...src.slice(src.indexOf("FIELD_TYPES = ["), src.indexOf("];")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(types.length >= 12, "control: the type list was read");
  const covered = new Set(VARIANTS.map((v) => v.split("/")[0]));
  assert.deepEqual(types.filter((t) => !covered.has(t)), []);
});

test("cases are variant × context, minus what the app does not offer", () => {
  const all = cases().map((c) => c.key);
  assert.ok(all.includes("select/manual@rowPill"));
  assert.ok(all.includes("select/manual@formModal"));
  assert.ok(all.includes("select/single-allowNew@rowPill"));
  assert.ok(!all.includes("button@filterNav"));          // a button is not a filter
  assert.ok(!all.includes("markdown@filterNav"));
  assert.ok(CONTEXTS.length >= 6);
});

test("every case says what it will do", () => {
  for (const c of cases()) assert.ok(c.steps.length >= 2, c.key);
});
