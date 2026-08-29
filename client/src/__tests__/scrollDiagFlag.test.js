// Reaching the scroll diagnostic ON THE DEVICE THAT NEEDS IT.
//
// The overlay used to require setting a global from a console — which a tablet
// does not have, and a tablet is the entire reason scrollDiag exists. `?scrollDiag=1`
// turns it on and is remembered for the tab, so the app's own navigation (and a
// reload) does not silently drop it mid-investigation.
import { describe, it, expect } from "vitest";
import { scrollDiagFlagFrom } from "../helpers/scrollDiag";

describe("scrollDiagFlagFrom", () => {
  it("turns on from the URL and asks to remember it", () => {
    for (const q of ["?scrollDiag=1", "?scrollDiag=true", "?a=b&scrollDiag=1"]) {
      expect(scrollDiagFlagFrom(q, null)).toEqual({ on: true, remember: "set" });
    }
  });

  // THE OFF SWITCH HAS TO CLEAR THE MEMORY. Without this, once enabled it could
  // never be turned off from the device either — the same trap one level down.
  it("turns off from the URL and asks to forget it", () => {
    for (const q of ["?scrollDiag=0", "?scrollDiag=false"]) {
      expect(scrollDiagFlagFrom(q, "1")).toEqual({ on: false, remember: "clear" });
    }
  });

  it("stays on across a reload with no query at all", () => {
    expect(scrollDiagFlagFrom("", "1")).toEqual({ on: true, remember: null });
    expect(scrollDiagFlagFrom("?foo=1", "1")).toEqual({ on: true, remember: null });
  });

  // The default must be OFF, or an overlay appears for every visitor.
  it("is off by default and writes nothing", () => {
    expect(scrollDiagFlagFrom("", null)).toEqual({ on: false, remember: null });
    expect(scrollDiagFlagFrom("?scrollDiag=maybe", null)).toEqual({ on: false, remember: null });
    expect(scrollDiagFlagFrom(undefined, undefined)).toEqual({ on: false, remember: null });
  });
});
