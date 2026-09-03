/**
 * NOTHING SKIPS UNTIL IT HAS BEEN MEASURED.
 *
 * `content-visibility: auto` on containers is worth -63% of a style+layout pass
 * on the device's viewport (147.5ms -> 55ms), because 98 of 105 containers are
 * off screen at any moment. The naive version — the rule with a picked
 * `contain-intrinsic-size` — collapsed the scroller from 18,313 to 10,638 and
 * moved everything below it, which lands a drop in the wrong place on live
 * data.
 *
 * So the CSS is gated on an attribute only a real measurement writes. These
 * tests pin that gate, because it is the whole safety of the feature.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { seedIntrinsicSize, isRendered, heightFromEntry, observeContainerSize, CV_ATTR } from "../helpers/containerSkip";

const el = () => ({ style: {}, _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  getAttribute(k) { return this._attrs[k] ?? null; } });

describe("seeding", () => {
  it("writes the measured size and the gate together", () => {
    const e = el();
    expect(seedIntrinsicSize(e, 412.4)).toBe(true);
    expect(e.style.containIntrinsicSize).toBe("auto 412px");
    expect(e.getAttribute(CV_ATTR)).toBe("412");
  });

  it("keeps `auto`, so a RENDERED element uses its real size and not ours", () => {
    // Without the keyword the seed becomes a permanent guess for every
    // container instead of a floor under the first paint.
    const e = el();
    seedIntrinsicSize(e, 300);
    expect(e.style.containIntrinsicSize.startsWith("auto ")).toBe(true);
  });

  it("REFUSES a size of zero — that is the gate's whole job", () => {
    // A container mid-mount measures 0. Seeding it would let it skip while
    // reserving nothing, which is exactly the scroller collapse.
    const e = el();
    for (const bad of [0, -5, undefined, null, NaN]) {
      expect(seedIntrinsicSize(e, bad)).toBe(false);
    }
    expect(e.getAttribute(CV_ATTR)).toBeNull();
    expect(e.style.containIntrinsicSize).toBeUndefined();
  });

  it("does not rewrite an unchanged size", () => {
    const e = el();
    expect(seedIntrinsicSize(e, 412)).toBe(true);
    expect(seedIntrinsicSize(e, 412.2)).toBe(false);   // same rounded px
    expect(seedIntrinsicSize(e, 500)).toBe(true);
  });
});

describe("a skipped element must not seed from itself", () => {
  it("asks checkVisibility, not geometry", () => {
    // A skipped element's box IS its intrinsic size, and
    // `getBoundingClientRect` answers for it WITHOUT rendering the subtree — so
    // geometry cannot tell the two apart and the seed would ossify.
    expect(isRendered({ checkVisibility: () => false })).toBe(false);
    expect(isRendered({ checkVisibility: () => true })).toBe(true);
  });

  it("treats an engine without checkVisibility as rendered", () => {
    // No API means no skipping either, so seeding is the pre-existing behaviour.
    expect(isRendered({})).toBe(true);
    expect(isRendered({ checkVisibility: () => { throw new Error("bad option"); } })).toBe(true);
    expect(isRendered(null)).toBe(false);
  });

  it("the observer SKIPS a skipped target", () => {
    const target = { ...el(), checkVisibility: () => false };
    let cb;
    class RO { constructor(f) { cb = f; } observe() {} disconnect() {} }
    observeContainerSize(target, { ResizeObserverImpl: RO });
    cb([{ target, contentBoxSize: [{ blockSize: 999 }] }]);
    expect(target.getAttribute(CV_ATTR)).toBeNull();
  });

  it("and seeds a rendered one — the control", () => {
    const target = { ...el(), checkVisibility: () => true };
    let cb;
    class RO { constructor(f) { cb = f; } observe() {} disconnect() {} }
    observeContainerSize(target, { ResizeObserverImpl: RO });
    cb([{ target, contentBoxSize: [{ blockSize: 999 }] }]);
    expect(target.getAttribute(CV_ATTR)).toBe("999");
  });
});

describe("which box", () => {
  it("takes the CONTENT box, not the border box", () => {
    // `contain-intrinsic-size` describes the principal box's CONTENT. Seeding
    // from the border box over-reserves by padding and border on every
    // container, and 105 of those is a scroller that disagrees with itself.
    expect(heightFromEntry({ contentBoxSize: [{ blockSize: 120 }], contentRect: { height: 999 } })).toBe(120);
    expect(heightFromEntry({ contentRect: { height: 77 } })).toBe(77);   // older engines
    expect(heightFromEntry(undefined)).toBe(0);                          // -> refused above
  });
});

describe("no ResizeObserver, no skipping", () => {
  it("returns a teardown and observes nothing", () => {
    const t = observeContainerSize(el(), { ResizeObserverImpl: null });
    expect(typeof t).toBe("function");
    expect(() => t()).not.toThrow();
  });
});

describe("the CSS gate", () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.css"), "utf8");

  it("only skips a container that carries the seeded attribute", () => {
    // The load-bearing assertion. An UNGATED `.container-shell { content-
    // visibility: auto }` is the version that collapsed the scroller by 42%.
    expect(css).toMatch(/\.container-shell\[data-cv-seeded\]\s*\{\s*content-visibility:\s*auto/);
    const ungated = css.match(/\.container-shell\s*\{[^}]*content-visibility/);
    expect(ungated).toBeNull();
  });

  it("does not hard-code an intrinsic size in CSS", () => {
    // A constant here is the trap 2026-08-31 (4) records: wrong in BOTH
    // directions, and nobody notices until the scrollbar jumps.
    const block = css.slice(css.indexOf(".container-shell[data-cv-seeded]"));
    expect(block.slice(0, 200)).not.toMatch(/contain-intrinsic-size/);
  });
});
