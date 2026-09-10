// A COVER THAT CANNOT LOAD IS NOT REQUESTED AGAIN.
//
// User, 2026-09-10: the viewer *"takes forever to open"*. Their console log is
// the measurement — between two `__renderTally()` calls it holds 232 image GETs
// and **203 `NS_ERROR_DOM_NETWORK_ERR`**, plus OpaqueResponseBlocking and CORP
// failures. The hosts name themselves: `scontent.cdninstagram.com` (60 — it
// blocks hotlinking, so every one of those fails), dead blogs, `codesandbox.io`,
// shopify. These are the 1,468 bookmark COVERS.
//
// Each failure costs a DNS lookup, a TCP connect and a TLS handshake before it
// gives up, and `LoadingImage` kept "this failed" in `useState` — per INSTANCE.
// A card that unmounts and remounts (virtualisation, scrolling, the render churn
// that shows up as 3,221 instance renders in the same tally) mounts a fresh
// `<img>` with the same dead src, and the browser tries the whole thing again.
//
// So a failure is remembered for the session and the `<img>` is not rendered at
// all — no element, no request.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("../components/ui/spinner.jsx", () => ({ Spinner: () => React.createElement("i") }));

import LoadingImage, { _resetFailedSrc } from "../ui/LoadingImage.jsx";

beforeEach(() => { _resetFailedSrc(); });

const DEAD = "https://scontent.cdninstagram.com/dead.jpg";
const OK = "https://example.com/fine.jpg";

describe("a failed image is not asked for twice", () => {
  it("remembers the failure across a remount — the second mount makes no request", () => {
    const first = render(<LoadingImage src={DEAD} />);
    const img = first.container.querySelector("img");
    expect(img, "nothing was requested the FIRST time either — the control").toBeTruthy();
    act(() => { fireEvent.error(img); });
    first.unmount();

    // The ELEMENT stays (the frame must not resize — `LoadingImage.test.jsx`
    // pins that); what must not come back is the SRC, because the src is the
    // request.
    const second = render(<LoadingImage src={DEAD} />);
    const again = second.container.querySelector("img");
    expect(again, "the frame lost its element — that resizes the card").toBeTruthy();
    expect(again.getAttribute("src"), "the dead cover was requested again").toBeNull();
  });

  // THE CONTROL. Without it, "makes no request" is also satisfied by a component
  // that stopped rendering images altogether.
  it("still requests a DIFFERENT image", () => {
    const { container } = render(<LoadingImage src={OK} />);
    expect(container.querySelector("img")).toBeTruthy();
    expect(container.querySelector("img").getAttribute("src")).toBe(OK);
  });

  // AND A FAILURE IS NOT INFERRED FROM SILENCE. An image still loading must not
  // be remembered as dead, or a slow cover would be permanently blank.
  //
  // THE ASSERTION IS THE SRC, NOT THE ELEMENT. The element is present in EVERY
  // state by design (the frame must not resize), so `querySelector("img")` is
  // true whether or not the image was written off — an earlier draft asserted
  // exactly that and passed against a mutation that remembered every unfinished
  // image as dead. What discriminates is whether it is still being REQUESTED.
  it("does not remember an image that simply has not finished", () => {
    const SLOW = "https://example.com/slow.jpg";
    const a = render(<LoadingImage src={SLOW} />);
    expect(a.container.querySelector("img").getAttribute("src")).toBe(SLOW);
    a.unmount();

    const b = render(<LoadingImage src={SLOW} />);
    expect(
      b.container.querySelector("img")?.getAttribute("src"),
      "an image that never finished was written off as dead",
    ).toBe(SLOW);
  });
});
