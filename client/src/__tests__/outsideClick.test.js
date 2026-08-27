import { describe, it, expect } from "vitest";
import { clickedInsidePortalLayer } from "../helpers/outsideClick";

const build = (html) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

describe("clickedInsidePortalLayer", () => {
  it("recognises a Radix popper — the QuickAdd repro", () => {
    // The option's real ancestor chain, read off the live page:
    // SPAN.truncate < BUTTON < DIV < DIV[role=listbox] < [data-radix-popper-content-wrapper] < BODY
    const host = build(`<div data-radix-popper-content-wrapper>
        <div role="listbox"><div><button><span class="truncate" id="opt">Monday</span></button></div></div>
      </div>`);
    expect(clickedInsidePortalLayer(host.querySelector("#opt"))).toBe(true);
  });

  it("says NO for an ordinary click on the page — the control", () => {
    // Without this, "always return true" passes the test above and every
    // outside-click menu stops closing entirely.
    const host = build(`<div class="board"><span id="row">a row</span></div>`);
    expect(clickedInsidePortalLayer(host.querySelector("#row"))).toBe(false);
  });

  it("covers a portalled layer that is not Radix", () => {
    const host = build(`<div role="dialog"><span id="x">inside</span></div>`);
    expect(clickedInsidePortalLayer(host.querySelector("#x"))).toBe(true);
  });

  it("fails CLOSED on a target it cannot test", () => {
    // Failing closed restores today's behaviour rather than wedging a menu open.
    expect(clickedInsidePortalLayer(null)).toBe(false);
    expect(clickedInsidePortalLayer({})).toBe(false);
    expect(clickedInsidePortalLayer(document)).toBe(false);
  });
});
