// A popover must never run past the screen edge. `max-h-[calc(100vh-32px)]`
// caps it at the VIEWPORT height, which does not stop one that opens mid-screen:
// measured 2026-09-28 on a Time Slot pill (49 options) opening at y=330 in a
// 1000px window — its list ran to y≈1300 and every option after ~1:00pm was
// unreachable, with no scroll and no search. It is too tall to flip, so
// collision avoidance cannot save it. The cap has to be the space actually
// available on its side, which Radix publishes as a CSS variable.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";

const mount = (style) => render(
  <Popover open>
    <PopoverTrigger>t</PopoverTrigger>
    <PopoverContent data-testid="pc" style={style}>x</PopoverContent>
  </Popover>,
);

describe("PopoverContent fits the space it opens into", () => {
  it("caps its height at the side's AVAILABLE height", () => {
    mount();
    const el = document.querySelector('[data-testid="pc"]');
    expect(el.style.maxHeight).toBe("var(--radix-popover-content-available-height)");
  });
  it("a caller's own maxHeight still wins", () => {
    mount({ maxHeight: 280 });
    expect(document.querySelector('[data-testid="pc"]').style.maxHeight).toBe("280px");
  });
});
