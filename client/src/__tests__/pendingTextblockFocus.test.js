import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  requestTextblockFocus,
  claimTextblockFocus,
  releaseTextblockFocus,
  cancelTextblockFocus,
} from "../helpers/pendingTextblockFocus";

describe("pendingTextblockFocus — the auto-created textblock claims the caret once", () => {
  // INVERTED 2026-09-18, with the reason recorded rather than deleted. The old
  // contract cleared the claim on the ATTEMPT, so a single failed attempt spent
  // it forever — and the node view is recreated ~200ms after a mint (the user's
  // [mint] table), so the block came back with nothing to claim and the caret
  // was left on the next line. The claim now survives until it LANDS.
  test("a claim survives a re-mount that happens before the caret lands", () => {
    requestTextblockFocus("occ-1");
    expect(claimTextblockFocus("occ-1")).toBe(true);
    // The view was recreated before onFocus ever fired — it must be able to
    // claim again, or the block is stranded unfocused.
    expect(claimTextblockFocus("occ-1")).toBe(true);
  });

  // THE ORIGINAL INTENT, PRESERVED — just keyed on the right event. Once the
  // caret has demonstrably landed, a later mount (scroll back into view) must
  // not steal it again.
  test("once the caret has LANDED the claim is spent", () => {
    requestTextblockFocus("occ-1b");
    expect(claimTextblockFocus("occ-1b")).toBe(true);
    releaseTextblockFocus("occ-1b");
    expect(claimTextblockFocus("occ-1b")).toBe(false);
  });

  test("an unrequested id never claims focus", () => {
    expect(claimTextblockFocus("occ-never-requested")).toBe(false);
  });

  test("cancel drops a standing claim so a late mount can't snatch the caret", () => {
    requestTextblockFocus("occ-2");
    cancelTextblockFocus("occ-2");
    expect(claimTextblockFocus("occ-2")).toBe(false);
  });

  test("null/undefined ids are inert", () => {
    requestTextblockFocus(null);
    requestTextblockFocus(undefined);
    expect(claimTextblockFocus(null)).toBe(false);
    expect(claimTextblockFocus(undefined)).toBe(false);
  });

  test("claims are independent per occurrence", () => {
    requestTextblockFocus("a");
    requestTextblockFocus("b");
    expect(claimTextblockFocus("b")).toBe(true);
    expect(claimTextblockFocus("a")).toBe(true);
  });
});

// ── THE TEARDOWN RE-CLAIM ───────────────────────────────────────────────────
//
// The node view is recreated ~200ms after every mint. When the caret had
// already landed the claim is spent, so the recreated view takes nothing and
// the caret is left in the parent doc — *"empty textblocks losing focus and
// having it on the next line after"*. `Editor`'s vanish-cancel cleanup
// re-requests the claim so the new view can take it back.
describe("a teardown can ask for the caret again", () => {
  test("a SPENT claim can be re-requested", () => {
    requestTextblockFocus("occ-tear");
    expect(claimTextblockFocus("occ-tear")).toBe(true);
    releaseTextblockFocus("occ-tear");            // the caret landed
    expect(claimTextblockFocus("occ-tear")).toBe(false);
    requestTextblockFocus("occ-tear");            // the view is being torn down
    expect(claimTextblockFocus("occ-tear")).toBe(true);
  });

  // Re-requesting must not resurrect a claim the caller deliberately dropped
  // AFTER it: order is what decides, not the fact that a request happened.
  test("a cancel after the re-request still wins", () => {
    requestTextblockFocus("occ-tear2");
    releaseTextblockFocus("occ-tear2");
    requestTextblockFocus("occ-tear2");
    cancelTextblockFocus("occ-tear2");
    expect(claimTextblockFocus("occ-tear2")).toBe(false);
  });
});

// ── THE WIRING, WHICH NO TEST CAN MOUNT ────────────────────────────────────
//
// `Editor` needs the whole grid store, and this decision lives in a cleanup
// that only runs on a real unmount. A source guard is what stops the re-claim
// being dropped the next time that cleanup is touched.
describe("Editor re-claims on a cancelled vanish", () => {
  const src = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf-8");
  // The cleanup, from `const vanishTimerRef` to the end of its effect.
  const start = src.indexOf("const vanishTimerRef");
  const cleanup = src.slice(start, src.indexOf("}, []);", start));

  test("the cleanup asks for the caret back", () => {
    expect(start).toBeGreaterThan(-1);
    expect(cleanup).toContain("requestTextblockFocus(");
  });

  // Only a PROVISIONAL block. A textblock the user deliberately made and left
  // is theirs to keep — and grabbing the caret for one that scrolled out of
  // view would be the claim-stealing this file's other tests forbid.
  test("only for a block that has not earned a server row", () => {
    expect(cleanup).toContain("isProvisionalTextblock(");
  });

  // THE CONTROL. Without it "the claim survives" is also satisfied by a build
  // that never releases one — which is the bug from the other direction: a
  // block scrolled back into view later would snatch the caret.
  test("the caret still SPENDS the claim when it lands", () => {
    expect(src).toContain("releaseTextblockFocus(occurrence?.id)");
  });
});
