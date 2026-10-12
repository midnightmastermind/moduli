// A shared Reddit link (phone app / Windows share) carries only a URL and a title, so a textblock filed from it had
// no body (user, 2026-10-12). The server reads the post's own text (GET /share/stage/:id/text); the placement window
// makes it the body by default — falling back to the selection, then the title (the user's pick).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { defaultBodyMapping } from "../helpers/sharePlacement.js";
import { resolveMapping, SHARE_SOURCES } from "../helpers/shareMapping.js";

describe("the default body of a shared textblock", () => {
  it("is the post's text when the server found one", () => {
    expect(defaultBodyMapping({ postText: "Para.", selection: "sel", title: "T" })).toEqual({ source: "postText" });
  });
  it("falls back to the selection, then the title", () => {
    expect(defaultBodyMapping({ postText: "", selection: "sel", title: "T" })).toEqual({ source: "selection" });
    expect(defaultBodyMapping({ title: "T" })).toEqual({ source: "title" });
  });
  it("'post text' is a source the body row can pick, and it reads the fetched text", () => {
    expect(SHARE_SOURCES.some((s) => s.value === "postText")).toBe(true);
    expect(resolveMapping({ postText: "Line one\n\nLine two" }, { source: "postText" })).toBe("Line one\n\nLine two");
  });
  it("a preset that stored 'post text' still fills a body on a share without one", () => {
    expect(resolveMapping({ postText: "", selection: "sel", title: "T" }, { source: "postText" })).toBe("sel");
    expect(resolveMapping({ title: "T" }, { source: "postText" })).toBe("T");
  });
  it("the window fetches /text and uses the helper (control: it still fetches /cover)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../ui/SharePlace.jsx"), "utf8");
    expect(src).toMatch(/share\/stage\/\$\{enc\(stageId\)\}\/text\?k=/);
    expect(src).toMatch(/defaultBodyMapping\(clip\)/);
    expect(src).toMatch(/\/cover\?k=/);
  });
});
