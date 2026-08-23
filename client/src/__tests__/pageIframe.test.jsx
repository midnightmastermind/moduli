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

// `framable` comes from the headers the reader fetch already received, so the
// surface can pick a mode that WORKS instead of framing, waiting, and
// discovering a blank box. Measured against the real sites: github DENY,
// youtube/reddit/google/danbrown SAMEORIGIN, wikipedia allows.
describe("a site that refuses to be framed", () => {
  const blocked = (usable) => ({ ok: true, usable, framable: false, frameBlockedBy: "x-frame-options: deny" });

  it("is BLOCKED when there is no readable text either — not a blank frame", () => {
    expect(resolveMode({ fetched: blocked(false) })).toBe("blocked");
  });

  it("still prefers the READER when there IS text — refusing to frame is irrelevant then", () => {
    expect(resolveMode({ fetched: blocked(true) })).toBe("reader");
  });

  it("cannot be forced into a frame by picking Web", () => {
    // The choice normally wins, but a blank box is a worse answer than saying
    // the site refuses.
    expect(resolveMode({ chosen: "web", fetched: blocked(true) })).toBe("blocked");
  });

  it("a framable site still honours the Web choice — the control", () => {
    // Without this, a rule that returned "blocked" for every explicit Web pick
    // would pass the test above.
    expect(resolveMode({ chosen: "web", fetched: { ok: true, usable: true, framable: true } })).toBe("web");
  });

  it("an UNKNOWN framable (older reply, no field) still frames", () => {
    // Fails open: a reply without the field must not withhold the live page.
    expect(resolveMode({ chosen: "web", fetched: { ok: true, usable: false } })).toBe("web");
    expect(resolveMode({ fetched: { ok: true, usable: false } })).toBe("web");
  });
});
