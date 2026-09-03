// "Still loading" vs "empty" — the distinction a board could not make while the
// deferred catalogue was on the wire, so it painted "Add new item" instead.
import { describe, it, expect } from "vitest";
import { isAwaitingChildren } from "../helpers/awaitingChildren";

const row = { id: "x" };

describe("isAwaitingChildren", () => {
  it("is true when the grid is waiting and a listed child has not arrived", () => {
    expect(isAwaitingChildren([row, null, row], true)).toBe(true);
  });

  it("is false once every listed child resolves", () => {
    expect(isAwaitingChildren([row, row], true)).toBe(false);
  });

  // THE GATE. An unresolved child id is also the signature of a dangling child
  // ref — an integrity ERROR that does not resolve by waiting. Without this a
  // grid carrying one would show a spinner forever.
  it("is false when the grid is NOT waiting, even with an unresolved child", () => {
    expect(isAwaitingChildren([row, null], false)).toBe(false);
  });

  // A container that lists nothing is EMPTY, not loading — it must keep its
  // "Add new item" affordance during a load.
  it("is false for a container that lists no children at all", () => {
    expect(isAwaitingChildren([], true)).toBe(false);
  });

  it("is false for a non-array, rather than throwing", () => {
    expect(isAwaitingChildren(null, true)).toBe(false);
    expect(isAwaitingChildren(undefined, true)).toBe(false);
  });
});
