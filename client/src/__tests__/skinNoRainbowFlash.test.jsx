// NO SKIN IS STAMPED UNTIL THERE IS SOMETHING TO RESOLVE FROM.
//
// USER, 2026-08-22: *"that header color is happening when the first grid loads,
// its a rainbow"* — the live half of 2026-08-19's *"dont let the default header
// color be the rainbow either"*, which the skin system answered for a grid that
// NAMES a skin and not for the moment before one is known.
//
// `useSkin` runs on the FIRST render, when `grid` is still null because
// `full_state` has not arrived. `resolveSkinId(null, null)` falls through to
// `DEFAULT_SKIN`, which IS `retro-rainbow` — so the document carried the rainbow
// for the whole length of every cold load.
//
// An unstamped document is the right neutral by construction: `--retro-rainbow`
// is declared only inside `:root[data-skin="retro-rainbow"]`, so with no
// attribute the var is undefined and the band cannot paint.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSkin } from "../hooks/useSkin";
import { DEFAULT_SKIN } from "../helpers/skins";

const skinAttr = () => document.documentElement.getAttribute("data-skin");

beforeEach(() => {
  document.documentElement.removeAttribute("data-skin");
  try { localStorage.clear(); } catch { /* denied */ }
});
afterEach(() => document.documentElement.removeAttribute("data-skin"));

describe("the first render, before full_state arrives", () => {
  // THE DISCRIMINATING CASE — fails against the DEFAULT_SKIN fallback.
  it("stamps NOTHING when there is no grid and no stored preference", () => {
    renderHook(() => useSkin(null));
    expect(skinAttr()).toBeNull();
  });

  it("still reports a concrete skin to its caller", () => {
    // Only the DOM waits; callers that read `skin` for a colour keep working.
    const { result } = renderHook(() => useSkin(null));
    expect(result.current.skinId).toBe(DEFAULT_SKIN);
    expect(result.current.skin).toBeTruthy();
  });

  it("HONOURS a stored account-wide pick pre-grid — a returning user sees no transition", () => {
    localStorage.setItem("moduli-skin", "stardew");
    renderHook(() => useSkin(null));
    expect(skinAttr()).toBe("stardew");
  });
});

describe("once the grid is known", () => {
  it("applies the grid's own skin", () => {
    renderHook(() => useSkin({ _id: "g1", meta: { skin: "stardew" } }));
    expect(skinAttr()).toBe("stardew");
  });

  it("a grid naming NO skin still resolves — the default is not withheld forever", () => {
    // The withholding is about the moment before the grid loads, not about
    // grids that genuinely have no preference.
    renderHook(() => useSkin({ _id: "g1", meta: {} }));
    expect(skinAttr()).toBe(DEFAULT_SKIN);
  });

  it("the grid's own pick beats the stored one", () => {
    localStorage.setItem("moduli-skin", "midnight");
    renderHook(() => useSkin({ _id: "g1", meta: { skin: "stardew" } }));
    expect(skinAttr()).toBe("stardew");
  });
});
