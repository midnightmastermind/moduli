// @vitest-environment jsdom
// A link chip's drag handle shows while its TEXT is hovered, not while one of its link buttons is (user, 2026-11-15:
// "only show the drag handle if the text of the mini textblock is hovered, not when hovering those link buttons").
import { describe, it, expect } from "vitest";
import { hoverShowsHandle } from "../docs/pills/chipHover";

const el = (cls, parent) => { const e = document.createElement("span"); e.className = cls; parent?.appendChild(e); return e; };

describe("hoverShowsHandle", () => {
  const chip = el("instance-textblock-inline");
  const content = el("itbi-content", chip);
  const handle = el("itbi-handle", chip);
  const arrow = el("itbi-arrow", chip);
  const icon = el("lucide", arrow);
  it("the text shows it", () => expect(hoverShowsHandle(content)).toBe(true));
  it("the handle itself keeps it", () => expect(hoverShowsHandle(handle)).toBe(true));
  it("a link button does not", () => {
    expect(hoverShowsHandle(arrow)).toBe(false);
    expect(hoverShowsHandle(icon)).toBe(false);
  });
  // 2026-11-16: "its the space in between them" · "and on the outsides of the icons" — the chip element itself (its
  // padding and the gap between ↗ and 🌐) is not text.
  it("the gap between the buttons and the padding around them do not", () => {
    expect(hoverShowsHandle(chip)).toBe(false);
    expect(hoverShowsHandle(null)).toBe(false);
  });
});
