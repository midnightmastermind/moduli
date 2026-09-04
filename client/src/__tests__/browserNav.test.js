// __tests__/browserNav.test.js
import { describe, it, expect } from "vitest";
import {
  initialNav, currentUrl, canGoBack, canGoForward, goBack, goForward,
  navigate, normalizeTyped, isScratch,
} from "../helpers/browserNav";

describe("normalizeTyped — what a person types vs what a frame needs", () => {
  it("adds https to a bare host, because http would be blocked as mixed content", () => {
    expect(normalizeTyped("youtube.com")).toBe("https://youtube.com/");
    expect(normalizeTyped("  en.wikipedia.org/wiki/Otter  "))
      .toBe("https://en.wikipedia.org/wiki/Otter");
  });

  it("leaves an explicit scheme alone", () => {
    expect(normalizeTyped("http://localhost:8096/")).toBe("http://localhost:8096/");
  });

  // DEFENCE IN DEPTH, and the A/B says so: removing the explicit scheme list
  // fails nothing, because `https://javascript:alert(1)` has an invalid port and
  // URL parsing rejects it anyway. Kept because that redundancy is an accident
  // of another component's behaviour rather than a proof, and this value goes
  // straight into an iframe `src` — the one place in this feature where being
  // wrong is dangerous rather than untidy.
  it("refuses schemes that must never reach an iframe src", () => {
    for (const s of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd"])
      expect(normalizeTyped(s), s).toBe(null);
  });

  it("refuses something that is plainly not an address", () => {
    // A single WORD is the case the dotless-host check exists for: "hello world"
    // is caught earlier by URL parsing (the space), so it never reaches it.
    // Without the check, `hello` becomes https://hello and frames an error page
    // — which reads as the app being broken rather than the address not being one.
    expect(normalizeTyped("hello")).toBe(null);
    expect(normalizeTyped("hello world")).toBe(null);
    expect(normalizeTyped("")).toBe(null);
    expect(normalizeTyped(null)).toBe(null);
    expect(normalizeTyped(42)).toBe(null);
  });

  it("keeps localhost, the one dotless host that is real", () => {
    expect(normalizeTyped("localhost:3000")).toContain("localhost:3000");
  });
});

describe("history", () => {
  const A = "https://a.com/", B = "https://b.com/", C = "https://c.com/";

  it("starts on the url it was given", () => {
    const nav = initialNav("a.com");
    expect(currentUrl(nav)).toBe(A);
    expect(canGoBack(nav)).toBe(false);
    expect(canGoForward(nav)).toBe(false);
  });

  it("starts empty when there is nothing to open", () => {
    expect(currentUrl(initialNav(null))).toBe(null);
    expect(currentUrl(initialNav("hello world"))).toBe(null);
  });

  it("walks back and forward", () => {
    let n = navigate(navigate(initialNav("a.com"), "b.com"), "c.com");
    expect(currentUrl(n)).toBe(C);
    n = goBack(n); expect(currentUrl(n)).toBe(B);
    n = goBack(n); expect(currentUrl(n)).toBe(A);
    expect(canGoBack(n)).toBe(false);
    n = goForward(n); expect(currentUrl(n)).toBe(B);
  });

  it("does not run off either end", () => {
    const n = initialNav("a.com");
    expect(goBack(n)).toBe(n);
    expect(goForward(n)).toBe(n);
  });

  // What every browser does. Without it, Forward after a new navigation jumps
  // somewhere unrelated to where you are.
  it("truncates the forward branch on a new navigation", () => {
    let n = navigate(navigate(initialNav("a.com"), "b.com"), "c.com");
    n = goBack(n); n = goBack(n);            // back at A, B and C still ahead
    expect(canGoForward(n)).toBe(true);
    n = navigate(n, "d.com");
    expect(canGoForward(n)).toBe(false);
    expect(n.entries).toEqual([A, "https://d.com/"]);
  });

  // Enter twice is a reload, not two history entries — otherwise Back looks
  // broken because it appears to do nothing.
  it("treats re-committing the current url as a reload", () => {
    const n = initialNav("a.com");
    expect(navigate(n, "a.com")).toBe(n);
    expect(navigate(n, "https://a.com/")).toBe(n);
  });

  it("ignores an address it cannot make sense of", () => {
    const n = initialNav("a.com");
    expect(navigate(n, "javascript:alert(1)")).toBe(n);
    expect(navigate(n, "")).toBe(n);
  });
});

describe("isScratch", () => {
  // Every bookmark that exists predates the flag; treating those as scratch
  // would make the whole library look disposable.
  it("defaults to saved", () => {
    expect(isScratch(undefined)).toBe(false);
    expect(isScratch({})).toBe(false);
    expect(isScratch({ meta: {} })).toBe(false);
    expect(isScratch({ meta: { scratch: false } })).toBe(false);
  });
  it("is scratch only when it says so", () => {
    expect(isScratch({ meta: { scratch: true } })).toBe(true);
  });
});

// ── HOW A BOOKMARK OPENS (2026-09-04) ──────────────────────────────────────
// User: *"its showing up as a doc page … this is me just navigating to the
// browser."* Clicking an artifact mints a display page whose View comes from
// `viewFieldsForArtifactKind`. `bookmark` was not in that list, so it fell
// through to the markdown default and rendered the doc editor.
//
// The kind existed long before this function was asked about it — which is why
// the failure looked like a missing feature rather than a wrong default.
import { viewFieldsForArtifactKind } from "../helpers/importsFolder";

describe("viewFieldsForArtifactKind", () => {
  it("routes a bookmark to the display view ArtifactContent looks for", () => {
    // ArtifactContent renders BookmarkView on artifactType === "bookmark".
    expect(viewFieldsForArtifactKind("bookmark"))
      .toEqual({ viewType: "display", artifactType: "bookmark" });
  });

  it("leaves every other kind exactly as it was", () => {
    for (const k of ["image", "video", "audio", "pdf"])
      expect(viewFieldsForArtifactKind(k), k).toEqual({ viewType: "display", artifactType: k });
    expect(viewFieldsForArtifactKind("code")).toEqual({ viewType: "code", artifactType: null });
    // The default is still markdown — for kinds that genuinely have no viewer.
    expect(viewFieldsForArtifactKind("markdown")).toEqual({ viewType: "markdown", artifactType: null });
    expect(viewFieldsForArtifactKind(undefined)).toEqual({ viewType: "markdown", artifactType: null });
  });
});
