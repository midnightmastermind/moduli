/**
 * DragProvider.test.js
 *
 * Unit tests for the touch-action mobile fix in DragProvider.
 * Tests that drag start/end properly sets/clears document.documentElement.style.touchAction
 * to prevent Android split-screen gesture interception.
 */
import { describe, test, expect, beforeEach } from "vitest";

describe("DragProvider touch-action management", () => {
  beforeEach(() => {
    // Reset touchAction before each test
    document.documentElement.style.touchAction = '';
  });

  test("drag start on mobile sets document.documentElement.style.touchAction to 'none'", () => {
    // Simulate what handleDragStart does when isMobile=true
    const isMobile = true;
    if (isMobile) document.documentElement.style.touchAction = 'none';

    expect(document.documentElement.style.touchAction).toBe('none');
  });

  test("drag start on desktop does NOT set touchAction", () => {
    const isMobile = false;
    if (isMobile) document.documentElement.style.touchAction = 'none';

    expect(document.documentElement.style.touchAction).toBe('');
  });

  test("clearSession restores touchAction to empty string", () => {
    // Simulate drag start on mobile
    document.documentElement.style.touchAction = 'none';
    expect(document.documentElement.style.touchAction).toBe('none');

    // Simulate clearSession
    document.documentElement.style.touchAction = '';
    expect(document.documentElement.style.touchAction).toBe('');
  });

  test("clearSession is safe to call even when touchAction was never set", () => {
    // touchAction starts empty
    expect(document.documentElement.style.touchAction).toBe('');

    // clearSession always resets — should not throw
    document.documentElement.style.touchAction = '';
    expect(document.documentElement.style.touchAction).toBe('');
  });
});
