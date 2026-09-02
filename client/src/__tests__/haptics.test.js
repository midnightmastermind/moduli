/**
 * EVERY BUTTON AND EVERY PICKER BUZZES — and the exclusions carry the weight.
 *
 * The feature is one document-level `pointerdown` listener, so what needs
 * pinning is the PREDICATE: which presses are a control being acted on, and
 * which are something else wearing a button. The two that matter most:
 *
 *  - a DRAG HANDLE must stay quiet, because `dragSystem` already buzzes 15ms
 *    when the drag lifts. Buzzing here too puts two pulses ~150ms apart on one
 *    gesture, which reads as a stutter rather than as two events.
 *  - TEXT ENTRY must stay quiet. A buzz per tap into a doc, a textblock or a
 *    table cell turns writing into a rattle, and those are most of the grid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shouldBuzzFor, buzz, hapticsEnabled, armHaptics } from "../helpers/haptics.js";

beforeEach(() => {
  document.body.innerHTML = "";
  delete window.__haptics;
  try { window.localStorage.removeItem("moduli-haptics"); } catch { /* ignore */ }
});
// `armed` is module-level by design (one listener per document), so a test that
// arms and then fails would leave the listener attached and the NEXT arm would
// return a no-op detach — quietly making later assertions test the wrong
// listener. Every arming test registers its detach here instead.
let detach = null;
afterEach(() => { detach?.(); detach = null; delete navigator.vibrate; });

const mount = (html) => { document.body.innerHTML = html; return document.body.firstElementChild; };

describe("shouldBuzzFor — what counts as a control", () => {
  it("buzzes for a plain button", () => {
    expect(shouldBuzzFor(mount("<button>go</button>"))).toBe(true);
  });

  it("buzzes for a press on something INSIDE a button (the icon, the label)", () => {
    // Every button in this app wraps an icon or a span, so the raw event target
    // is almost never the button itself.
    const b = mount("<button><svg><path/></svg></button>");
    expect(shouldBuzzFor(b.querySelector("path"))).toBe(true);
  });

  it("buzzes for a select, a switch and a checkbox", () => {
    expect(shouldBuzzFor(mount("<select><option>a</option></select>"))).toBe(true);
    // Radix renders a Switch as button[role=switch]; role is asserted directly
    // so the rule survives that component being swapped.
    expect(shouldBuzzFor(mount('<div role="switch"></div>'))).toBe(true);
    expect(shouldBuzzFor(mount('<input type="checkbox" />'))).toBe(true);
  });

  it("buzzes for a menu row", () => {
    expect(shouldBuzzFor(mount('<div role="menuitem">Delete</div>'))).toBe(true);
  });

  it("stays QUIET on a drag handle — dragSystem owns that gesture's haptics", () => {
    const h = mount('<button data-dnd-handle="true"><span>::</span></button>');
    expect(shouldBuzzFor(h.querySelector("span"))).toBe(false);
  });

  it("stays QUIET on text entry, even inside a button", () => {
    const card = mount('<button><div class="ProseMirror"><p>words</p></div></button>');
    expect(shouldBuzzFor(card.querySelector("p"))).toBe(false);
    expect(shouldBuzzFor(mount('<div contenteditable="true">x</div>'))).toBe(false);
  });

  it("stays QUIET on a disabled control — a buzz there says it worked", () => {
    expect(shouldBuzzFor(mount("<button disabled>go</button>"))).toBe(false);
    expect(shouldBuzzFor(mount('<div role="button" aria-disabled="true">go</div>'))).toBe(false);
  });

  it("stays quiet on ordinary prose and on a plain text input", () => {
    expect(shouldBuzzFor(mount("<p>just text</p>"))).toBe(false);
    expect(shouldBuzzFor(mount('<input type="text" />'))).toBe(false);
    expect(shouldBuzzFor(null)).toBe(false);
  });
});

describe("buzz — it must never take a control down with it", () => {
  it("fires the vibration when the API is there", () => {
    navigator.vibrate = vi.fn(() => true);
    expect(buzz()).toBe(true);
    expect(navigator.vibrate).toHaveBeenCalledWith(10);
  });

  it("is a no-op where the API does not exist (desktop, iOS Safari)", () => {
    expect(buzz()).toBe(false);
  });

  it("swallows a THROWING vibrate rather than breaking the press", () => {
    // Some embedded contexts throw on access; a haptic is decoration and must
    // never propagate out of a pointerdown handler.
    navigator.vibrate = vi.fn(() => { throw new Error("blocked"); });
    expect(() => buzz()).not.toThrow();
    expect(buzz()).toBe(false);
  });

  it("can be muted for the session and across reloads", () => {
    navigator.vibrate = vi.fn(() => true);
    window.__haptics = false;
    expect(hapticsEnabled()).toBe(false);
    expect(buzz()).toBe(false);
    delete window.__haptics;
    window.localStorage.setItem("moduli-haptics", "off");
    expect(buzz()).toBe(false);
    window.localStorage.removeItem("moduli-haptics");
    expect(buzz()).toBe(true);   // the control: it CAN fire
  });
});

describe("armHaptics — one listener, and it reaches a stopPropagation'd control", () => {
  it("buzzes on pointerdown even when the control stops propagation", () => {
    navigator.vibrate = vi.fn(() => true);
    detach = armHaptics();
    const b = mount("<button>go</button>");
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
  });

  it("ignores a right-click — the MENU's rows buzz when they are pressed", () => {
    navigator.vibrate = vi.fn(() => true);
    detach = armHaptics();
    const b = mount("<button>go</button>");
    b.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 2 }));
    expect(navigator.vibrate).not.toHaveBeenCalled();
    b.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);   // the control
  });

  it("stops buzzing once detached", () => {
    navigator.vibrate = vi.fn(() => true);
    armHaptics()();
    mount("<button>go</button>").dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });
});
