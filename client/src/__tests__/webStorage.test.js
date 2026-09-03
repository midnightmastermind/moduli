/**
 * THE TEST ENVIRONMENT'S `localStorage`.
 *
 * Node 25 ships its own Web Storage and takes the global before jsdom does;
 * without `--localstorage-file` it is an empty object. What is pinned here is
 * the shim's FIDELITY — a Map with four methods would pass every consumer test
 * in this repo and still be wrong in a browser.
 */
import { describe, it, expect } from "vitest";
import { makeWebStorage, hasWorkingStorage, installWebStorage } from "./webStorage.js";

describe("the shim behaves like Storage", () => {
  it("returns null for a missing key, never undefined", () => {
    // `treeExpansion` does `JSON.parse(localStorage.getItem(k) || "[]")`; both
    // work there, but `=== null` checks elsewhere would silently change meaning.
    expect(makeWebStorage().getItem("nope")).toBeNull();
  });

  it("STRINGIFIES values, which is where a Map-backed shim lies", () => {
    const s = makeWebStorage();
    s.setItem("n", 1);
    expect(s.getItem("n")).toBe("1");
    s.setItem("o", { a: 1 });
    expect(s.getItem("o")).toBe("[object Object]");
  });

  it("stringifies keys too", () => {
    const s = makeWebStorage();
    s.setItem(1, "x");
    expect(s.getItem("1")).toBe("x");
  });

  it("clears, removes, and reports length", () => {
    const s = makeWebStorage();
    s.setItem("a", "1"); s.setItem("b", "2");
    expect(s.length).toBe(2);
    s.removeItem("a");
    expect(s.length).toBe(1);
    expect(s.getItem("a")).toBeNull();
    s.removeItem("gone");           // a miss is a no-op, not a throw
    s.clear();
    expect(s.length).toBe(0);
  });

  it("key(i) walks insertion order and returns null out of range", () => {
    const s = makeWebStorage();
    s.setItem("a", "1"); s.setItem("b", "2");
    expect([s.key(0), s.key(1), s.key(2), s.key(-1)]).toEqual(["a", "b", null, null]);
  });

  it("exposes entries as PROPERTIES, the way a real Storage does", () => {
    // This codebase documents `localStorage["moduli-haptics"] = "off"` as a
    // user-facing mute. A methods-only shim would make that silently inert
    // here while working in the browser.
    const s = makeWebStorage();
    s.setItem("k", "v");
    expect(s.k).toBe("v");
    expect("k" in s).toBe(true);
    expect(Object.keys(s)).toEqual(["k"]);
    s.other = "w";
    expect(s.getItem("other")).toBe("w");
    delete s.k;
    expect(s.getItem("k")).toBeNull();
  });

  it("does not mistake its own methods for stored keys", () => {
    const s = makeWebStorage();
    expect(s.getItem("getItem")).toBeNull();
    expect(typeof s.clear).toBe("function");
  });
});

describe("installing it", () => {
  it("LEAVES A WORKING IMPLEMENTATION ALONE", () => {
    // The guard that lets this shim disappear when the environment is fixed.
    const real = makeWebStorage();
    real.setItem("keep", "me");
    const host = { localStorage: real };
    expect(installWebStorage(["localStorage"], host)).toEqual([]);
    expect(host.localStorage.getItem("keep")).toBe("me");
  });

  it("replaces a BROKEN implementation", () => {
    const host = { localStorage: {} };          // Node 25's empty object
    expect(installWebStorage(["localStorage"], host)).toEqual(["localStorage"]);
    host.localStorage.setItem("a", "1");
    expect(host.localStorage.getItem("a")).toBe("1");
  });

  it("installs when the global is missing entirely", () => {
    const host = {};
    expect(installWebStorage(["localStorage", "sessionStorage"], host))
      .toEqual(["localStorage", "sessionStorage"]);
    // Separate storage areas — writing one must not be visible in the other.
    host.localStorage.setItem("k", "L");
    expect(host.sessionStorage.getItem("k")).toBeNull();
  });

  it("mirrors onto a `window` that is not the global object", () => {
    const host = { window: {} };
    installWebStorage(["localStorage"], host);
    expect(host.window.localStorage).toBe(host.localStorage);
  });

  it("hasWorkingStorage rejects a partial implementation", () => {
    // Node's is not merely absent — it is an object with none of the methods.
    expect(hasWorkingStorage("x", { x: {} })).toBe(false);
    expect(hasWorkingStorage("x", { x: { getItem() {}, setItem() {} } })).toBe(false);
    expect(hasWorkingStorage("x", {})).toBe(false);
    expect(hasWorkingStorage("x", { x: makeWebStorage() })).toBe(true);
  });
});

describe("and it is actually installed in THIS environment", () => {
  it("the real global localStorage works", () => {
    // The positive control: without it every assertion above could pass while
    // the suites this was written for stay red.
    localStorage.clear();
    localStorage.setItem("probe", "1");
    expect(localStorage.getItem("probe")).toBe("1");
    expect(localStorage.length).toBe(1);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
  });
});
