// client/src/__tests__/disarmDraggable.test.js
//
// Firefox will not let the user place a caret OR select text anywhere inside an
// element carrying the `draggable` attribute. Pragmatic stamps that attribute on
// every element it registers — including the wrapper around a textblock's whole
// editable body — so text inside a drag source was unselectable
// (user 2026-08-01: "i cant highlight text at all inside textblocks so i
// couldnt copy and paste it").
//
// The contract: draggable is OFF at rest so text is selectable, and ON only
// while the drag handle is being pressed so real drags still work.
import { describe, it, expect, beforeEach } from "vitest";
import { disarmDraggableUntilHandle } from "../helpers/dragSystem";

// NOTE ON COVERAGE: these assert the `draggable` ATTRIBUTE only, not the
// `-webkit-user-drag` style the helper also toggles — jsdom's CSSOM silently
// drops that non-standard property (`setProperty` then `getPropertyValue`
// returns ""), so asserting it would be testing jsdom, not the code. The
// attribute is the half Firefox keys off, and Firefox is where the bug was.
let el, handle;
beforeEach(() => {
  document.body.innerHTML = "";
  el = document.createElement("div");
  handle = document.createElement("button");
  el.appendChild(handle);
  document.body.appendChild(el);
  el.draggable = true;                       // what Pragmatic just did
});

describe("disarmDraggableUntilHandle", () => {
  it("turns draggable OFF at rest so the text inside can be selected", () => {
    disarmDraggableUntilHandle(el, handle);
    expect(el.draggable).toBe(false);
  });

  it("arms on handle pointerdown so a real drag still starts", () => {
    disarmDraggableUntilHandle(el, handle);
    handle.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(el.draggable).toBe(true);
  });

  it("disarms again on pointerup — a finished drag must not leave it stuck on", () => {
    disarmDraggableUntilHandle(el, handle);
    handle.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    window.dispatchEvent(new Event("pointerup"));
    expect(el.draggable).toBe(false);
  });

  it("disarms on dragend too (a drop fires no pointerup)", () => {
    disarmDraggableUntilHandle(el, handle);
    handle.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    window.dispatchEvent(new Event("dragend"));
    expect(el.draggable).toBe(false);
  });

  it("a pointerdown on the BODY (not the handle) leaves it disarmed — that is the selection gesture", () => {
    disarmDraggableUntilHandle(el, handle);
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(el.draggable).toBe(false);
  });

  it("cleanup detaches the handle listener", () => {
    const cleanup = disarmDraggableUntilHandle(el, handle);
    cleanup();
    handle.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(el.draggable).toBe(false);
  });

  it("is a no-op without a handle — handle-less draggables must stay draggable", () => {
    const cleanup = disarmDraggableUntilHandle(el, null);
    expect(el.draggable).toBe(true);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
