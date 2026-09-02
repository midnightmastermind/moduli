/**
 * A UNIVERSAL DESCENDANT SELECTOR UNDER A TOGGLED ATTRIBUTE IS A DOCUMENT-WIDE
 * STYLE INVALIDATION — and the mobile grid toggles that attribute on every cell
 * switch. Traced on prod at 820x1180, 6x CPU throttle, one rail tap:
 *
 *     ONE style recalc over 15,964 elements   712ms
 *     style, whole tap                       1363ms
 *     layout, whole tap                        69ms   <- layout was never it
 *
 * Deleting that ONE rule at run time, same page, same taps:
 *
 *     biggest recalc  15,964 -> 9,983 elements
 *     style           1363ms ->   580ms         -57%
 *
 * A source scan rather than a rendered assertion because jsdom implements
 * neither the selector cost nor `overscroll-behavior` — a computed-style check
 * here would read empty on correct code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A UNIVERSAL DESCENDANT UNDER A TOGGLED ATTRIBUTE IS A DOCUMENT-WIDE INVALIDATION.
 *
 * `.mobile-grid-viewport[data-panel-native-scroll="1"] .mobile-grid-slider *` cost
 * 712ms in ONE style recalc over 15,964 elements on every cell switch — half the
 * style time of the whole tap — because the cell switch toggles that attribute and
 * `*` cannot be reduced to a class-keyed invalidation set. The census says it
 * re-matched 19,953 elements to reach the 41 that ever compute
 * `overscroll-behavior-y: contain`.
 *
 * This scans for the SHAPE rather than the one rule: any selector that both matches
 * inside the mobile slider and ends in a bare `*` is the same defect wearing a
 * different name.
 */
describe("no universal descendant selector hangs off the mobile grid", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((b) => b.split("{")[0])
    .filter(Boolean)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  it("no rule inside .mobile-grid-slider / .mobile-grid-viewport ends in a bare *", () => {
    const offenders = selectors.filter(
      (s) => /mobile-grid-(slider|viewport)/.test(s) && /\s\*$/.test(s)
    );
    expect(offenders).toEqual([]);
  });

  it("the native-scroll override still names the scrollers it has to reach", () => {
    // The 41 elements the census found: 3 page scrollers + 38 `.instance-fields`.
    // A fourth inline `overscroll-behavior: contain` inside the slider must join
    // this list, or that panel's lower half becomes unreachable (2026-07-25).
    const rule = selectors.filter((s) => s.includes("data-panel-native-scroll"));
    expect(rule.some((s) => s.includes(".page-scroll"))).toBe(true);
    expect(rule.some((s) => s.includes(".instance-fields"))).toBe(true);
  });
});
