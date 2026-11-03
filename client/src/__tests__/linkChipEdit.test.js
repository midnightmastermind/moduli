import { describe, it, expect } from "vitest";
import { linkEditText, parseLinkEdit } from "../docs/linkChipEdit.js";

describe("a link chip edits as text[link]", () => {
  it("shows the words and the address in one line", () => {
    expect(linkEditText("Meeting chat", "https://zoom.us/c")).toBe("Meeting chat[https://zoom.us/c]");
  });
  it("reads a changed label and address back", () => {
    expect(parseLinkEdit("Chat[https://a.b/x]", "https://old")).toEqual({ label: "Chat", url: "https://a.b/x" });
  });
  it("keeps the address when the brackets are gone or empty", () => {
    expect(parseLinkEdit("Just words", "https://old")).toEqual({ label: "Just words", url: "https://old" });
    expect(parseLinkEdit("Words[]", "https://old")).toEqual({ label: "Words", url: "https://old" });
  });
  it("only a TRAILING bracket is the address", () => {
    expect(parseLinkEdit("a [note] here[https://x.y]", "o")).toEqual({ label: "a [note] here", url: "https://x.y" });
  });
});
