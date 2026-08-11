import { describe, it, expect } from "vitest";
import { moveToFront } from "../migrations/0074-sleep-first-in-physical.mjs";

describe("0074 moveToFront", () => {
  it("moves the child to the front, preserving the order of the rest", () => {
    expect(moveToFront(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
  });

  it("is a no-op when it is already first", () => {
    expect(moveToFront(["c", "a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("returns the list untouched when the child is not in it", () => {
    expect(moveToFront(["a", "b"], "zz")).toEqual(["a", "b"]);
  });

  it("is idempotent", () => {
    const once = moveToFront(["a", "b", "c"], "c");
    expect(moveToFront(once, "c")).toEqual(once);
  });

  it("never drops or duplicates an entry", () => {
    const before = ["a", "b", "c", "d", "e"];
    const after = moveToFront(before, "d");
    expect([...after].sort()).toEqual([...before].sort());
    expect(new Set(after).size).toBe(after.length);
  });

  it("tolerates a missing or malformed list", () => {
    expect(moveToFront(undefined, "a")).toEqual([]);
    expect(moveToFront(null, "a")).toEqual([]);
  });
});
