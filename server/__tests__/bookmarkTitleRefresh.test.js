// THE PREDICATE IS THE WHOLE SAFETY OF `0330` — it rewrites labels the user sees.
//
// Measured before writing it: 30 of 1,468 bookmarks are uninformative, and of 91
// YouTube rows exactly ONE is. **A substring rule would rewrite the other 90**,
// every one of which carries a real title ("The Egg - A Short Story",
// "17776 (WebComic Dub)"). So the rule is EQUALITY, never containment, and these
// pin that distinction rather than the strings.
import { describe, it, expect } from "vitest";
import { isUninformative, titleFrom, hostOf } from "../migrations/0330-a-bookmark-that-names-only-its-host.mjs";

const YT = "https://www.youtube.com/watch?v=J-FkR8L2X5E";

describe("isUninformative", () => {
  it("catches the host and the bare brand — the 30 that need fixing", () => {
    expect(isUninformative("YouTube", YT)).toBe(true);
    expect(isUninformative("youtube.com", YT)).toBe(true);
    expect(isUninformative("JPOMS.COM", "http://jpoms.com")).toBe(true);
    expect(isUninformative("192.168.3.1", "http://192.168.3.1/x")).toBe(true);
    expect(isUninformative("", YT)).toBe(true);
  });

  // THE CONTROL, and it is the one that matters. 90 of the 91 YouTube bookmarks
  // are already right; a containment rule would rewrite every one of them.
  it("leaves a REAL title alone even when it contains the brand", () => {
    expect(isUninformative("The Egg - A Short Story", YT)).toBe(false);
    expect(isUninformative("YouTube Rewind 2018", YT)).toBe(false);
    expect(isUninformative("17776 (WebComic Dub)", YT)).toBe(false);
    expect(isUninformative("George Carlin — full compilation", YT)).toBe(false);
  });

  it("refuses to judge when the url gives no host", () => {
    expect(isUninformative("Something", "not a url")).toBe(false);
  });
});

describe("titleFrom", () => {
  it("prefers og:title — the clean name, without the site suffix", () => {
    const html = `<title>Futuristic HUD Sound Design | Blake Sanchez - YouTube</title>
      <meta property="og:title" content="Futuristic HUD Sound Design | Blake Sanchez">`;
    expect(titleFrom(html, YT)).toBe("Futuristic HUD Sound Design | Blake Sanchez");
  });

  it("falls back to <title>, trimming the site's own name off the END", () => {
    expect(titleFrom("<title>Some Video - YouTube</title>", YT)).toBe("Some Video");
    // Only at the end, and only the site's own name — a title that legitimately
    // ends in a dash keeps it.
    expect(titleFrom("<title>YouTube - the early years</title>", YT)).toBe("YouTube - the early years");
  });

  it("decodes entities so a title is not written with &amp; in it", () => {
    expect(titleFrom("<title>Salt &amp; Pepper</title>", "https://x.test")).toBe("Salt & Pepper");
  });

  it("gives nothing when the page declares nothing", () => {
    expect(titleFrom("<html><body>hi</body></html>", YT)).toBe("");
  });
});

describe("hostOf", () => {
  it("drops www and survives junk", () => {
    expect(hostOf("https://www.youtube.com/x")).toBe("youtube.com");
    expect(hostOf("nonsense")).toBe("");
  });
});
