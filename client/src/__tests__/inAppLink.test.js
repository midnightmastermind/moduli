// An in-app link chip opens its target page in the panel the chip sits in (glossary page, 2026-11-15). It used to
// call jumpToOccurrence alone, which does nothing when the target page is not on screen.
import { describe, it, expect, vi } from "vitest";
import { openInAppLink } from "../helpers/inAppLink";

describe("openInAppLink", () => {
  it("opens the target in the chip's panel", () => {
    const open = vi.fn(() => ({ ok: true })); const jump = vi.fn();
    const panel = { id: "p1" };
    const r = openInAppLink({ targetId: "sched", panelOccurrence: panel, maps: { occurrencesById: {}, modulesById: {}, viewsById: {} }, open, jump });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ occId: "sched", panelOccurrence: panel }));
    expect(jump).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
  it("jumps when the chip is in no panel", () => {
    const open = vi.fn(); const jump = vi.fn();
    openInAppLink({ targetId: "sched", panelOccurrence: null, maps: {}, open, jump });
    expect(open).not.toHaveBeenCalled();
    expect(jump).toHaveBeenCalledWith("sched");
  });
  it("jumps when the target has no page to open", () => {
    const open = vi.fn(() => ({ ok: false })); const jump = vi.fn();
    openInAppLink({ targetId: "loose", panelOccurrence: { id: "p1" }, maps: {}, open, jump });
    expect(jump).toHaveBeenCalledWith("loose");
  });
});
