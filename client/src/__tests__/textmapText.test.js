// __tests__/textmapText.test.js
import { describe, it, expect } from "vitest";
import { plainText } from "../helpers/textmapText";

describe("plainText", () => {
  it("concatenates text nodes depth-first", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] },
        { type: "paragraph", content: [{ type: "text", text: "!" }] },
      ],
    };
    expect(plainText(doc)).toBe("Hello world!");
  });

  it("ignores non-text nodes and is null-safe", () => {
    expect(plainText({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "x" } }] })).toBe("");
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
  });
});
