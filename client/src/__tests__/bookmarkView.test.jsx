// The iframe view's two decisions: which MODE to show, and whether to frame.
//
// Both are pure functions on purpose. The surface itself needs the whole store
// to mount, and the parts that regress silently are these — a mode that quietly
// reverts, or a frame that renders where it should not.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import BookmarkView, { resolveMode, fallbackReason, FRAME_SANDBOX } from "../modules/BookmarkView.jsx";

// Mounting the real surface needs the grid store; only two slices are read.
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({ fieldsById: {}, dispatch: () => {} }),
}));

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

describe("resolveMode — ARCHIVE", () => {
  // "add a web arcvhive version in next to web ... make that next to reader
  // mode and web mode" (2026-08-23).
  it("is honoured whatever the live site said", () => {
    // The snapshot is a different page on a different host, so the live site's
    // own headers say nothing about it. Measured: web.archive.org sends no
    // x-frame-options and a CSP with no frame-ancestors, so it frames where
    // the original refuses — which is much of the point.
    expect(resolveMode({ chosen: "archive", fetched: { ok: true, usable: false, framable: false } })).toBe("archive");
    expect(resolveMode({ chosen: "archive", fetched: { ok: false, error: "fetch failed (404)" } })).toBe("archive");
    expect(resolveMode({ chosen: "archive", fetched: null })).toBe("archive");
  });

  it("is never reached WITHOUT being picked", () => {
    // A peer button, not a fallback: it must not appear only when something
    // breaks, and equally must not be selected on someone's behalf. The dead
    // link is exactly when a silent switch would be most confusing.
    const states = [
      { ok: true, usable: true }, { ok: true, usable: false },
      { ok: true, usable: false, framable: false }, { ok: false, error: "x" }, null,
    ];
    for (const fetched of states) expect(resolveMode({ fetched })).not.toBe("archive");
  });

  it("does not disturb the other two", () => {
    expect(resolveMode({ chosen: "reader", fetched: { ok: true, usable: false } })).toBe("reader");
    expect(resolveMode({ chosen: "web", fetched: { ok: true, framable: false } })).toBe("blocked");
  });
});

// ── EMBEDDABLE URLS (2026-09-04) ───────────────────────────────────────────
// User: *"id like to watch youtube videos and such without having to click on a
// bookmark."* Pasting a YouTube link used to land on "blocked", which was true
// of the PAGE and wrong about what we would actually show.
describe("resolveMode — an embeddable url", () => {
  const refuses = { ok: true, usable: false, framable: false };

  it("is never blocked, even though the PAGE refuses framing", () => {
    // youtube.com/watch sends SAMEORIGIN; youtube.com/embed sends no header.
    // `framable` describes the page, and the frame shows the other url.
    expect(resolveMode({ chosen: "web", fetched: refuses, embeddable: true })).toBe("web");
    expect(resolveMode({ chosen: "web", fetched: refuses, embeddable: false })).toBe("blocked");
  });

  it("defaults to the player, ahead of reader", () => {
    // Reader on a video page gives the description and nav chrome — never the
    // thing you opened it for.
    const readable = { ok: true, usable: true, framable: false };
    expect(resolveMode({ fetched: readable, embeddable: true })).toBe("web");
    expect(resolveMode({ fetched: readable, embeddable: false })).toBe("reader");
  });

  it("still lets you ask for reader or archive", () => {
    expect(resolveMode({ chosen: "reader", fetched: refuses, embeddable: true })).toBe("reader");
    expect(resolveMode({ chosen: "archive", fetched: refuses, embeddable: true })).toBe("archive");
  });

  // The default must not change for the whole rest of the web.
  it("changes nothing for a url the table does not know", () => {
    for (const f of [null, { ok: true, usable: true }, { ok: false }, refuses]) {
      expect(resolveMode({ fetched: f, embeddable: false }))
        .toBe(resolveMode({ fetched: f }));
    }
  });
});

// ── THE BLANK SCRATCH BROWSER (2026-09-04) ─────────────────────────────────
// Found while creating the first one to test with: BookmarkView early-returned
// "Nothing to open — this row carries no link" when there was no url, BEFORE the
// address bar rendered. For a saved bookmark that is right; for a scratch
// browser it hid the one control it exists for, so a fresh one could not be
// typed into at all. Exactly the class this repo's history keeps recording as
// "not verified in a browser".
describe("BookmarkView with no url", () => {
  const socket = { emit: () => {} };

  it("offers an address bar when it is a scratch browser", () => {
    render(<BookmarkView occurrence={{ id: "b1", meta: { scratch: true } }} socket={socket} />);
    expect(screen.getByPlaceholderText("Type an address…")).toBeTruthy();
    expect(screen.queryByText(/carries no link/)).toBeNull();
  });

  // The saved case is unchanged: a bookmark with no link genuinely has nothing
  // to show, and inviting someone to type into it would be inviting them to
  // edit their library by accident.
  it("still says so for a saved bookmark", () => {
    render(<BookmarkView occurrence={{ id: "b2", meta: {} }} socket={socket} />);
    expect(screen.getByText(/carries no link/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Type an address…")).toBeNull();
  });
});
