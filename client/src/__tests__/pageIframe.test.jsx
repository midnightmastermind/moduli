// The iframe view's two decisions: which MODE to show, and whether to frame.
//
// Both are pure functions on purpose. The surface itself needs the whole store
// to mount, and the parts that regress silently are these — a mode that quietly
// reverts, or a frame that renders where it should not.
import { describe, it, expect } from "vitest";
import { resolveMode, fallbackReason, FRAME_SANDBOX } from "../modules/pages/PageIframe.jsx";

const ok = (words, usable) => ({ ok: true, words, usable, markdown: "x" });

describe("resolveMode", () => {
  it("shows READER when the fetch produced something worth reading", () => {
    // "can you make sure to open in text preview mode if possible"
    expect(resolveMode({ fetched: ok(6106, true) })).toBe("reader");
  });

  it("falls through to WEB when the page returned a shell", () => {
    // reddit measured 0 words server-side. A reader showing nav chrome is worse
    // than the site.
    expect(resolveMode({ fetched: ok(0, false) })).toBe("web");
  });

  it("falls through to WEB when the fetch FAILED", () => {
    expect(resolveMode({ fetched: { ok: false, error: "fetch failed (429)" } })).toBe("web");
  });

  it("an explicit choice always wins, in both directions", () => {
    // A toggle that silently reverts is a suggestion, not a control.
    expect(resolveMode({ chosen: "web", fetched: ok(6106, true) })).toBe("web");
    expect(resolveMode({ chosen: "reader", fetched: ok(0, false) })).toBe("reader");
  });

  it("is LOADING before the fetch answers, not web", () => {
    // Defaulting to web while waiting would flash the live site for a moment on
    // every open, which is the opposite of reader-first.
    expect(resolveMode({ fetched: null })).toBe("loading");
  });
});

describe("fallbackReason", () => {
  it("reports WHY the reader was skipped, so the strip can say it", () => {
    expect(fallbackReason({ ok: false, error: "timed out" })).toBe("timed out");
    expect(fallbackReason(ok(0, false))).toBe("no readable text");
  });

  it("is null when the reader worked — the control", () => {
    // Without this, a function returning a string unconditionally would pass
    // the test above and print a reason on every healthy page.
    expect(fallbackReason(ok(6106, true))).toBeNull();
    expect(fallbackReason(null)).toBeNull();
  });
});

describe("the frame's sandbox", () => {
  it("permits scripts, forms and popups so the page actually works", () => {
    for (const t of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-popups"]) {
      expect(FRAME_SANDBOX).toContain(t);
    }
  });

  it("does NOT permit top-navigation — the grid cannot be navigated away", () => {
    // The user asked to navigate INSIDE the page; that works without this token.
    // What it blocks is a page replacing the whole app, which would lose
    // whatever was unsaved.
    expect(FRAME_SANDBOX).not.toContain("allow-top-navigation");
  });
});
