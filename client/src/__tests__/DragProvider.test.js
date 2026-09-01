/**
 * DragProvider.test.js — the document-wide touch-action write, and why it is gone.
 *
 * ── WHAT THIS FILE USED TO BE ──────────────────────────────────────────────
 *
 * Four tests that never imported DragProvider. Each one set
 * `document.documentElement.style.touchAction` ITSELF and then asserted it had
 * been set, so all four were assertions about jsdom. They passed before the
 * feature existed and they passed after it was deleted — which is exactly what
 * happened: removing the write left them green.
 *
 * ── WHAT IS BEING GUARDED NOW ──────────────────────────────────────────────
 *
 * `documentElement.style.touchAction = 'none'` at drag start measured **903ms**
 * on the user's tablet, attributed by forced flush with the property written
 * immediately after it on the same element as the control:
 *
 *     f:t0:0  f:touchAction:903  f:overscroll:3  f:bodyAttrs:45
 *     f:pill:4  f:barriers:3  f:setIsDragging:0  f:sessionState:0
 *
 * Changing touch-action makes Chrome rebuild the touch-action hit-test regions
 * for the whole document — 21,282 nodes — and it was paid TWICE per drag,
 * since the reset on drag end is the same invalidation again.
 *
 * It reads as a one-line safety guard, which is precisely why it needs a test:
 * the next person to see a stray OS gesture will reach for it, and the cost is
 * invisible at the call site.
 *
 * The source scan is the honest instrument here — mounting DragProvider needs
 * the whole grid store, and the property of interest is "this line is not in
 * the drag path", not a rendered outcome. Same shape as noDomainKnowledge.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const DRAG_PATH_FILES = {
  "DragProvider.jsx": read("../helpers/DragProvider.jsx"),
  "dragSystem.js": read("../helpers/dragSystem.js"),
};

// Comments quote the retired line on purpose, so the scan must look at CODE.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TOUCH_ACTION_WRITE =
  /document\s*\.\s*documentElement\s*\.\s*style\s*\.\s*touchAction\s*=/;

describe("the drag path never writes touch-action on documentElement", () => {
  for (const [name, src] of Object.entries(DRAG_PATH_FILES)) {
    test(`${name} does not write documentElement.style.touchAction`, () => {
      expect(stripComments(src)).not.toMatch(TOUCH_ACTION_WRITE);
    });
  }

  test("the scan can actually find the write it forbids", () => {
    // Without this the suite passes if the regex silently matches nothing —
    // an absence proves nothing until the thing has been shown detectable.
    const planted = "if (x) { document.documentElement.style.touchAction = 'none'; }";
    expect(stripComments(planted)).toMatch(TOUCH_ACTION_WRITE);
  });

  test("the scan ignores the retired line where it is QUOTED in a comment", () => {
    // Both files explain the removal by naming the line. A scan that fired on
    // prose would force the explanation out of the file, and the explanation
    // is the whole reason the next reader will not put it back.
    const quoted = "// `document.documentElement.style.touchAction = 'none'` used to be here";
    expect(stripComments(quoted)).not.toMatch(TOUCH_ACTION_WRITE);
  });
});

describe("the removal was surgical, not a blanket deletion", () => {
  // overscroll-behavior sits on the SAME element, is written in the same
  // breath, and measured 3ms. It stops pull-to-refresh during a drag and has
  // no reason to go. If it vanished with its expensive neighbour, this suite
  // would otherwise call that a success.
  for (const [name, src] of Object.entries(DRAG_PATH_FILES)) {
    test(`${name} still manages documentElement.style.overscrollBehavior`, () => {
      const code = stripComments(src);
      expect(code).toMatch(/documentElement\s*\.\s*style\s*\.\s*overscrollBehavior\s*=\s*['"]none['"]/);
      expect(code).toMatch(/documentElement\s*\.\s*style\s*\.\s*overscrollBehavior\s*=\s*['"]{2}/);
    });
  }
});

describe("what replaced it is still there", () => {
  test("edge barriers are spawned synchronously at drag start", () => {
    // The OS-gesture job the retired write claimed. 3ms, and it runs BEFORE
    // the document-level guards attach — so the coverage is earlier, not later.
    const code = stripComments(DRAG_PATH_FILES["DragProvider.jsx"]);
    expect(code).toMatch(/spawnEdgeBarriers\(\)/);
    expect(code).toMatch(/drag-edge-barrier/);
  });

  test("the drag's own touchmove listener stays non-passive", () => {
    // This is what stops the dragging finger scrolling now. Passive would make
    // its preventDefault a no-op and hand the gesture back to the compositor.
    const code = stripComments(DRAG_PATH_FILES["dragSystem.js"]);
    expect(code).toMatch(/addEventListener\('touchmove',\s*onMove,\s*\{\s*passive:\s*false\s*\}\)/);
  });
});
