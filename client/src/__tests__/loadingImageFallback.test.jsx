// A dead image is not always worth a broken-image glyph.
//
// Measured on the live bookmarks board: ~28% of the 1,467 cover URLs no longer
// resolve, the worst group being the ones the Raindrop export itself supplied
// (its CDN links have rotted over the years). Without a fallback, ~400 cards
// would draw an error icon where they previously drew a 📄 — a downgrade for
// every one of them.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LoadingImage, { _resetFailedSrc } from "../ui/LoadingImage";

// A FAILED SRC IS REMEMBERED FOR THE SESSION (see `LoadingImage`'s own header —
// 203 dead bookmark covers were being re-requested on every remount). That Set
// is module state, so it outlives a single case and has to be cleared here or
// one test's dead url silently decides the next one's starting state.
beforeEach(() => { _resetFailedSrc(); });

describe("LoadingImage fallback", () => {
  it("renders the fallback INSTEAD of the image once it fails", () => {
    render(<LoadingImage src="https://dead/x.png" alt="cover" fallback={<span>FALLBACK</span>} />);
    expect(screen.queryByText("FALLBACK")).toBeNull();      // not before it fails
    fireEvent.error(screen.getByAltText("cover"));
    expect(screen.getByText("FALLBACK")).toBeTruthy();
    expect(screen.queryByAltText("cover")).toBeNull();
  });

  it("keeps the image when it LOADS — the control", () => {
    // Without this, a fallback that always rendered would pass the test above.
    render(<LoadingImage src="https://ok/x.png" alt="cover" fallback={<span>FALLBACK</span>} />);
    fireEvent.load(screen.getByAltText("cover"));
    expect(screen.queryByText("FALLBACK")).toBeNull();
    expect(screen.getByAltText("cover")).toBeTruthy();
  });

  it("STILL SAYS SO when no fallback is given", () => {
    // The component exists to make a dead reference visible. The fallback is an
    // opt-out for callers with something better to draw, not a new default.
    const { container } = render(<LoadingImage src="https://dead/x.png" alt="cover" />);
    fireEvent.error(screen.getByAltText("cover"));
    expect(container.querySelector(".img-load-status--error")).toBeTruthy();
    expect(screen.getByAltText("cover")).toBeTruthy();
  });

  it("recovers when the src CHANGES — a failure is not permanent", () => {
    // The fallback must not latch: swapping in a working cover has to show it.
    const { rerender } = render(
      <LoadingImage src="https://dead/x.png" alt="cover" fallback={<span>FALLBACK</span>} />
    );
    fireEvent.error(screen.getByAltText("cover"));
    expect(screen.getByText("FALLBACK")).toBeTruthy();
    rerender(<LoadingImage src="https://ok/y.png" alt="cover" fallback={<span>FALLBACK</span>} />);
    expect(screen.queryByText("FALLBACK")).toBeNull();
    expect(screen.getByAltText("cover")).toBeTruthy();
  });
});
