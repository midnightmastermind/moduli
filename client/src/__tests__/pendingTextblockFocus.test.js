import { describe, test, expect } from "vitest";
import {
  requestTextblockFocus,
  consumeTextblockFocus,
  cancelTextblockFocus,
} from "../helpers/pendingTextblockFocus";

describe("pendingTextblockFocus — the auto-created textblock claims the caret once", () => {
  test("a requested id is consumed exactly once", () => {
    requestTextblockFocus("occ-1");
    expect(consumeTextblockFocus("occ-1")).toBe(true);
    // A second mount of the same occurrence (re-render, scroll back into view)
    // must NOT steal the caret again.
    expect(consumeTextblockFocus("occ-1")).toBe(false);
  });

  test("an unrequested id never claims focus", () => {
    expect(consumeTextblockFocus("occ-never-requested")).toBe(false);
  });

  test("cancel drops a standing claim so a late mount can't snatch the caret", () => {
    requestTextblockFocus("occ-2");
    cancelTextblockFocus("occ-2");
    expect(consumeTextblockFocus("occ-2")).toBe(false);
  });

  test("null/undefined ids are inert", () => {
    requestTextblockFocus(null);
    requestTextblockFocus(undefined);
    expect(consumeTextblockFocus(null)).toBe(false);
    expect(consumeTextblockFocus(undefined)).toBe(false);
  });

  test("claims are independent per occurrence", () => {
    requestTextblockFocus("a");
    requestTextblockFocus("b");
    expect(consumeTextblockFocus("b")).toBe(true);
    expect(consumeTextblockFocus("a")).toBe(true);
  });
});
