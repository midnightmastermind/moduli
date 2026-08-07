// Task 4b Step 2 — `main` on the Files field value.
//
// MEASURED ON LIVE DATA BEFORE THESE WERE WRITTEN (2026-08-07). Both poms grid
// and test grid 2 carry a `Files` field (type "occurrence", multiSelect) bound
// by ~188 modules, with 213 occurrences holding a value shaped
// `{ value: ["<artifactOccId>"], flow: "replace" }` — and **zero** carrying a
// `main`. So `main` is greenfield: every test here describes an invariant being
// established, not one being preserved.
//
// THE INVARIANT, and it is the whole reason these are pure functions:
// **main is always a member of value.** A main naming a file that is not
// attached is a dangling reference wearing a different hat, and this repo has
// paid for that class repeatedly. It cannot be enforced by the UI, because the
// UI is not the only writer — a migration, a drop, and a delete all touch this
// value. So it is enforced by the only functions allowed to write it.

import { describe, it, expect } from "vitest";
import { setMainFile, clearMainFile, removeFile, resolveMainFile } from "../helpers/mainFile.js";

const fv = (value, main) => ({ value, flow: "replace", ...(main ? { main } : {}) });

describe("setMainFile — main is always a member of value", () => {
  it("marks an already-attached file as main", () => {
    const got = setMainFile(fv(["a", "b"]), "b");
    expect(got.main).toBe("b");
    expect(got.value).toEqual(["a", "b"]);
  });

  it("ATTACHES a file that is not there yet, rather than pointing at nothing", () => {
    // This is the drop case: dropping an artifact on the main-picture area
    // means "this is the face", and it must also become an attachment. The
    // alternative — refusing, or setting a main outside value — makes the drop
    // silently do nothing or creates the dangling reference the invariant exists
    // to prevent.
    const got = setMainFile(fv(["a"]), "z");
    expect(got.value).toEqual(["a", "z"]);
    expect(got.main).toBe("z");
  });

  it("works on an occurrence that has no Files value at all", () => {
    expect(setMainFile(undefined, "a")).toEqual(
      expect.objectContaining({ value: ["a"], main: "a" }),
    );
  });

  it("does not duplicate a file that is already attached", () => {
    const got = setMainFile(fv(["a", "b"]), "a");
    expect(got.value).toEqual(["a", "b"]);
  });

  it("preserves flow and any other keys on the wrapper", () => {
    const got = setMainFile({ value: ["a"], flow: "in", timestamp: "t" }, "a");
    expect(got.flow).toBe("in");
    expect(got.timestamp).toBe("t");
  });

  it("refuses an empty id instead of writing a falsy main", () => {
    const before = fv(["a"], "a");
    expect(setMainFile(before, "")).toEqual(before);
    expect(setMainFile(before, null)).toEqual(before);
  });
});

describe("removeFile — detaching the main clears it", () => {
  it("clears main when the file being removed IS the main", () => {
    const got = removeFile(fv(["a", "b"], "b"), "b");
    expect(got.value).toEqual(["a"]);
    expect(got.main).toBeUndefined();
  });

  it("leaves main alone when some OTHER file is removed", () => {
    const got = removeFile(fv(["a", "b"], "b"), "a");
    expect(got.value).toEqual(["b"]);
    expect(got.main).toBe("b");
  });

  it("is a no-op for a file that was never attached", () => {
    const before = fv(["a"], "a");
    expect(removeFile(before, "zzz")).toEqual(before);
  });
});

describe("resolveMainFile — an absent main is legal, a dangling one is not", () => {
  it("returns the main when it is attached", () => {
    expect(resolveMainFile(fv(["a", "b"], "b"))).toBe("b");
  });

  it("returns null when no main is set — that is a legal state, not an error", () => {
    // The overwhelming majority of live rows: 213 of 213 carry a value and none
    // carry a main. Callers fall back to their existing behaviour.
    expect(resolveMainFile(fv(["a", "b"]))).toBeNull();
  });

  it("REFUSES a main that is not in value rather than returning it", () => {
    // The discriminating case. If data ever violates the invariant — a bad
    // migration, a hand edit — reading it back must not propagate the dangling
    // reference into a thumbnail lookup that then resolves to nothing.
    expect(resolveMainFile({ value: ["a"], main: "gone" })).toBeNull();
  });

  it("handles a bare array value (no wrapper) and null", () => {
    expect(resolveMainFile(["a", "b"])).toBeNull();
    expect(resolveMainFile(null)).toBeNull();
  });
});

describe("clearMainFile", () => {
  it("drops main and leaves every attachment in place", () => {
    const got = clearMainFile(fv(["a", "b"], "b"));
    expect(got.main).toBeUndefined();
    expect(got.value).toEqual(["a", "b"]);
  });
});
