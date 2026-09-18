import { describe, test, expect } from "vitest";
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
