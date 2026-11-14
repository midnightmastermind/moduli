import { describe, it, expect } from "vitest";
import { readableImportError } from "../services/importJobs.js";

describe("readableImportError", () => {
  it("says a 403 is the site refusing the server", () => {
    expect(readableImportError("fetch failed (403)")).toMatch(/refused the server \(403\)/);
  });
  it("names a gone page and a busy site", () => {
    expect(readableImportError("fetch failed (404)")).toMatch(/gone/);
    expect(readableImportError("fetch failed (429)")).toMatch(/limiting/);
    expect(readableImportError("fetch failed (503)")).toMatch(/error \(503\)/);
  });
  it("leaves any other reason as it is", () => {
    expect(readableImportError("the page has no readable text")).toBe("the page has no readable text");
    expect(readableImportError("fetch failed (302)")).toBe("fetch failed (302)");
  });
});
