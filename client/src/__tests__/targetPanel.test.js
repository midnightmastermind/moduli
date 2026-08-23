// "set in the right click menu, a panel ... set as that until i turn it off.
//  ... if none is selected, we open in the panel we are opening it from."
import { describe, it, expect } from "vitest";
import { getTargetPanelId, resolveOpenTarget, targetPanelPatch, TARGET_PANEL_KEY }
  from "../helpers/targetPanel";

const gridWith = (id) => ({ meta: { [TARGET_PANEL_KEY]: id } });
const live = ["pA", "pC", "pD"];

describe("resolveOpenTarget", () => {
  it("uses the target when one is set and alive", () => {
    expect(resolveOpenTarget(gridWith("pC"), "pA", live)).toEqual({ panelId: "pC", via: "target" });
  });

  it("opens HERE when nothing is set — the default, and invisible", () => {
    expect(resolveOpenTarget({}, "pA", live)).toEqual({ panelId: "pA", via: "here" });
    expect(resolveOpenTarget(null, "pA", live)).toEqual({ panelId: "pA", via: "here" });
  });

  it("falls back to HERE when the target is gone, and says it was stale", () => {
    // A stale setting must not swallow the click. It also must not re-open the
    // closed panel: changing the layout from a double-click is a surprise.
    expect(resolveOpenTarget(gridWith("pGone"), "pA", live))
      .toEqual({ panelId: "pA", via: "stale" });
  });

  it("distinguishes stale from unset, because only one deserves a word", () => {
    expect(resolveOpenTarget(gridWith("pGone"), "pA", live).via).toBe("stale");
    expect(resolveOpenTarget({}, "pA", live).via).toBe("here");
  });

  it("a target set to the panel you clicked in is still 'target'", () => {
    expect(resolveOpenTarget(gridWith("pA"), "pA", live).via).toBe("target");
  });

  it("returns null rather than guessing when there is no panel at all", () => {
    expect(resolveOpenTarget({}, null, live).panelId).toBeNull();
  });
});

describe("getTargetPanelId", () => {
  it("reads it, and treats empty as unset", () => {
    expect(getTargetPanelId(gridWith("pC"))).toBe("pC");
    expect(getTargetPanelId(gridWith(""))).toBeNull();
    expect(getTargetPanelId(gridWith(null))).toBeNull();
    expect(getTargetPanelId({})).toBeNull();
  });
});

describe("targetPanelPatch", () => {
  it("sets the target and PRESERVES the rest of meta", () => {
    // Writing the whole meta is how an unrelated key gets silently dropped —
    // `createPageInContainer` had exactly that latent clobber (2026-08-08 (8)).
    const p = targetPanelPatch({ meta: { somethingElse: 1 } }, "pC");
    expect(p.meta[TARGET_PANEL_KEY]).toBe("pC");
    expect(p.meta.somethingElse).toBe(1);
  });

  it("clears with null", () => {
    expect(targetPanelPatch(gridWith("pC"), null).meta[TARGET_PANEL_KEY]).toBeNull();
  });
});
