/**
 * docGapTileKind.test.js
 *
 * EVERY TILE IN THE DOC GAP MINTED THE SAME EMPTY INSTANCE.
 *
 * `QuickAddMenu.createOfKind` calls `onCreateNew({ fieldIds: [], kind })` for
 * every tile — that `kind` is the entire difference between "Doc container",
 * "Textblock", "Board container", "Browser" and each "page-*" tile. The doc
 * gap's host in `Editor.jsx` destructured `{ existingModuleId, fieldIds,
 * fieldBindings, initialFields }` and never `kind`, then hardcoded
 * `role: "instance"` on the module it minted.
 *
 * Measured on prod 2026-09-21 by picking "Doc container" on a doc page: the
 * module came out `role:"instance", kind:null` with an empty label, embedded in
 * the page and impossible to type into — typing minted a separate textblock
 * beside it. 15 of the 16 tiles produced that same wrong thing.
 *
 * The fix routes a kind through `CommitHelpers.createChildInContainer`, which is
 * the kind→create router the container "+" already uses, rather than growing a
 * second mapping table here.
 *
 * This is a SOURCE guard because the behaviour lives inside a component whose
 * mount needs a real ProseMirror view. The CONTROLS matter more than the
 * assertions: without them "the file does not hardcode an instance" also passes
 * against a file with the whole doc-gap feature deleted.
 */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../ui/Editor.jsx"), "utf8");
// Comments NAME the defect they explain, so a grep over raw source matches the
// prose describing the bug and reads as the bug being present.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const handler = (() => {
  const i = CODE.indexOf("const insertDocItemAt");
  expect(i).toBeGreaterThan(-1); // control: the doc-gap mint still exists
  return CODE.slice(i, i + 2400);
})();

describe("the doc gap honours the tile's kind", () => {
  test("CONTROL — the doc gap still mints and embeds", () => {
    expect(handler).toMatch(/moduleEmbed/);
    expect(CODE).toMatch(/insertDocItemAt\(docGap\.pos/);
  });

  test("the handler accepts `kind`", () => {
    expect(handler).toMatch(/kind\s*=\s*null/);
  });

  test("a kind is routed through the shared createChildInContainer router", () => {
    expect(handler).toMatch(/createChildInContainer/);
  });

  test("the plain-instance path is still reachable (a kindless create)", () => {
    // Routing EVERYTHING through the router would change the leaf-item path,
    // which pre-picks sibling fields and must keep its own mint.
    expect(handler).toMatch(/kind\s*!==\s*["']instance["']/);
    expect(handler).toMatch(/role:\s*["']instance["']/);
  });

  test("onCreateNew forwards the WHOLE argument object, not a fixed subset", () => {
    // The original defect was here: a destructure that silently dropped `kind`.
    const m = CODE.match(/onCreateNew=\{\(([^)]*)\)\s*=>\s*insertDocItemAt\(docGap\.pos,\s*([^)]*)\)/);
    expect(m).toBeTruthy();
    // the forwarded value must not be a re-built object literal
    expect(m[2].trim()).not.toMatch(/^\{/);
  });
});
