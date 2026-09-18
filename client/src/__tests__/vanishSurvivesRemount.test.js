/**
 * vanishSurvivesRemount.test.js
 *
 * User, 2026-09-18: *"now its currently deleting the textblock right away (or
 * disappearing), immediately after being clicked on and focused."*
 *
 * Their [mint] table, on a block they were still inside:
 *     304  editor:blur    f5db8f70
 *     318  editor:destroy f5db8f70  inst=5
 *     318  editor:create  f5db8f70  inst=6     <- a REMOUNT, not a click-away
 *     339  vanish:fire                         <- so the block deleted itself
 *
 * Tearing down the DOM node that holds the caret fires `blur` exactly as moving
 * away does. The discriminator is what happens NEXT: a real click-away leaves the
 * component mounted, a teardown does not. So the scheduled vanish must not
 * survive the unmount that follows it.
 *
 * `Editor` cannot be mounted here (it needs the whole grid store), so this drives
 * the SCHEDULING RULE the handler implements, against a stand-in with the same
 * shape. The wiring itself is pinned by the source guard at the bottom.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// The rule, as Editor implements it: blur SCHEDULES, unmount CANCELS.
function makeBlurHost({ onVanish }) {
  let timer = 0;
  let destroyed = false;
  let focused = false;
  return {
    blur() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        if (destroyed) return;
        if (focused) return;
        onVanish();
      }, 0);
    },
    unmount() { if (timer) { clearTimeout(timer); timer = 0; } destroyed = true; },
    refocus() { focused = true; },
  };
}

describe("a blur that is really a teardown must not delete the block", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // THE USER'S CASE.
  test("unmounting before the vanish runs cancels it", () => {
    const onVanish = vi.fn();
    const host = makeBlurHost({ onVanish });
    host.blur();      // 304 — the DOM node is being torn down
    host.unmount();   // 318 — inst 5 destroyed, inst 6 created
    vi.runAllTimers();
    expect(onVanish).not.toHaveBeenCalled();
  });

  // THE CONTROL, and it carries the weight: without it "never deletes" also
  // satisfies the test above, and a block you click away from would live forever.
  test("a real click-away still deletes the empty block", () => {
    const onVanish = vi.fn();
    const host = makeBlurHost({ onVanish });
    host.blur();
    vi.runAllTimers();
    expect(onVanish).toHaveBeenCalledTimes(1);
  });

  test("focus coming straight back also cancels it", () => {
    const onVanish = vi.fn();
    const host = makeBlurHost({ onVanish });
    host.blur();
    host.refocus();   // the radial handle / toolbar took focus and gave it back
    vi.runAllTimers();
    expect(onVanish).not.toHaveBeenCalled();
  });

  test("two blurs in a row schedule only one vanish", () => {
    const onVanish = vi.fn();
    const host = makeBlurHost({ onVanish });
    host.blur();
    host.blur();
    vi.runAllTimers();
    expect(onVanish).toHaveBeenCalledTimes(1);
  });
});

// ── THE WIRING, WHICH NO TEST CAN MOUNT ────────────────────────────────────
describe("Editor cancels a pending vanish on unmount", () => {
  const src = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf-8");

  test("the vanish timer is held in a ref, not a bare setTimeout", () => {
    expect(src).toContain("vanishTimerRef");
    expect(src).toMatch(/vanishTimerRef\.current = setTimeout/);
  });

  test("an unmount clears it", () => {
    expect(src).toContain("vanish:cancelled");
    expect(src).toMatch(/clearTimeout\(vanishTimerRef\.current\)/);
  });

  // TDZ: `vanishTimerRef` is read inside onBlur, which is passed to useEditor.
  // The closure only RUNS after render, so a later declaration would resolve —
  // but this file has paid for that trap before, so source order is pinned.
  test("the ref is declared before useEditor", () => {
    expect(src.indexOf("const vanishTimerRef")).toBeLessThan(src.indexOf("const editor = useEditor("));
  });

  // The CONTROL: without it, everything above also passes against a file whose
  // vanish path was deleted outright.
  test("the vanish path still exists", () => {
    expect(src).toContain("onEmptyBlurRef.current?.()");
    expect(src).toContain('mintMark("vanish:fire")');
  });
});
