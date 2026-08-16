// WHICH instance body is open — exactly one, app-wide.
//
// A per-component boolean cannot enforce this: the row that ought to close is
// precisely the one no longer receiving events, so it can never know a sibling
// opened. Same shape as `helpers/gapHover.js claimExclusiveGap`, which solved
// the identical problem for doc insert-gaps on 2026-08-01 (9).
import { describe, it, expect, beforeEach } from "vitest";
import {
  claimBodyOpen, releaseBodyOpen, getOpenBodyId, subscribeBodyOpen,
} from "../helpers/bodyOpen.js";

beforeEach(() => { releaseBodyOpen(getOpenBodyId()); });

describe("bodyOpen — one open body, app-wide", () => {
  it("claiming publishes the id", () => {
    claimBodyOpen("occ-a");
    expect(getOpenBodyId()).toBe("occ-a");
  });

  it("a second claim REPLACES the first (that is the whole point)", () => {
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("notifies subscribers on every change", () => {
    const seen = [];
    const off = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    releaseBodyOpen("occ-b");
    off();
    claimBodyOpen("occ-c");            // after unsubscribe — must not be seen
    expect(seen).toEqual(["occ-a", "occ-b", null]);
  });

  it("release is IGNORED when another body already holds the claim", () => {
    // Row A unmounts AFTER row B opened. Without this guard A's cleanup would
    // close B — a body closed by someone else's unmount.
    claimBodyOpen("occ-a");
    claimBodyOpen("occ-b");
    releaseBodyOpen("occ-a");
    expect(getOpenBodyId()).toBe("occ-b");
  });

  it("re-claiming the same id does not re-notify", () => {
    claimBodyOpen("occ-a");
    const seen = [];
    const off = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    off();
    expect(seen).toEqual([]);
  });

  it("a throwing subscriber does not stop the others", () => {
    // One bad row must not leave every other row stuck open.
    const seen = [];
    const offBad = subscribeBodyOpen(() => { throw new Error("boom"); });
    const offGood = subscribeBodyOpen((id) => seen.push(id));
    claimBodyOpen("occ-a");
    offBad(); offGood();
    expect(seen).toEqual(["occ-a"]);
  });
});
