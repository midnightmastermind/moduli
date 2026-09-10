// THE INTERACTIVE READER GETS A SHORTER LEASH THAN AN IMPORT.
//
// User, 2026-09-10, with a screen recording: ~20 seconds of an empty overlay
// before anything appeared. `safeFetchUrl` gives a page 20s, and the Washington
// Post never answers — so the reader burned the whole budget and only THEN fell
// through to the frame, which renders in about a second.
//
// That default is right for a background import and wrong for the one call
// somebody is watching, so `page_reader` names its own.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { READER_TIMEOUT_MS } from "../socketHandlers/import.js";
import { fetchPageHtml } from "../utils/safeFetchUrl.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.resolve(here, "..", rel), "utf8");

describe("the reader fetch bounds how long someone waits", () => {
  it("is well under the background default", () => {
    expect(READER_TIMEOUT_MS).toBeGreaterThan(1000);   // not so short it never reads
    expect(READER_TIMEOUT_MS).toBeLessThanOrEqual(8000);
  });

  // THE CONTROL. The claim is that this is SHORTER than the shared default, so
  // that default has to be read rather than assumed — if `safeFetchUrl` ever
  // drops to 5s this test should start failing, not silently mean nothing.
  it("and the shared default really is the longer one", () => {
    const m = src("utils/safeFetchUrl.js").match(/timeoutMs\s*=\s*(\d+)/);
    expect(m, "safeFetchUrl no longer declares a default timeout").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(READER_TIMEOUT_MS);
  });

  it("and page_reader actually passes it — a constant nothing uses is a comment", () => {
    const handler = src("socketHandlers/import.js");
    const at = handler.indexOf('socket.on("page_reader"');
    expect(at).toBeGreaterThan(-1);
    const body = handler.slice(at, at + 2500);
    expect(body).toContain("fetchPageHtml(url, { timeoutMs: READER_TIMEOUT_MS })");
  });

  // The OTHER callers are deliberately left on the long default: an import is
  // work you asked for and walked away from, not a page you are staring at.
  it("leaves the import fetches on the long default", () => {
    const handler = src("socketHandlers/import.js");
    const plain = (handler.match(/fetchPageHtml\(url\)/g) || []).length;
    expect(plain, "every fetchPageHtml call was changed, not just the reader").toBeGreaterThan(0);
  });

  it("exports a real function to fetch with — the control", () => {
    expect(typeof fetchPageHtml).toBe("function");
  });
});
