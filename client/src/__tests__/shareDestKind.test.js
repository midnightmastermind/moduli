import { describe, it, expect } from "vitest";
import { destKind } from "../ui/SharePlace.jsx";
describe("destKind — what each search result is", () => {
  it("names pages, folder pages and containers", () => {
    expect(destKind({ role: "page", kind: "board" })).toBe("page");
    expect(destKind({ role: "page", kind: "folder" })).toBe("folder page");
    expect(destKind({ role: "container", kind: "board" })).toBe("board");
    expect(destKind({ role: "container", kind: "list" })).toBe("container");
    expect(destKind({ role: "container" })).toBe("container");
  });
});

import { withArticle } from "../ui/SharePlace.jsx";
describe("withArticle", () => {
  it("an image, a bookmark", () => {
    expect(withArticle("image")).toBe("an image");
    expect(withArticle("bookmark")).toBe("a bookmark");
  });
});
