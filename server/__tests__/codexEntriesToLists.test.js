import { classifyEntry, groupOf, listDoc, noteLines } from "../migrations/0432-codex-entries-to-lists.mjs";
import { describe, it, expect } from "vitest";

describe("0432 codex entries", () => {
  it("reads property lines and created-only stubs as entries, prose as a note", () => {
    expect(classifyEntry(["Author: Ivan Savov", "Physical Copy: No"])).toBe("properties");
    expect(classifyEntry(["Box: On me", "Packed: Yes", "Plan: Must Keep", "Room: Bedroom"])).toBe("properties");
    expect(classifyEntry(["Created: June 12, 2019 3:42 PM"])).toBe("created-only");
    expect(classifyEntry(["This is the Jibengong (basic practice) we do on the Wednesdays and Thursdays."])).toBeNull();
    expect(classifyEntry(["date: 2023-7-04 week: 2023-W27 year: 2023 Mission Log July 4th, 2023 P".repeat(5)])).toBeNull();
  });
  it("an empty page is empty only when nothing is inside it", () => {
    expect(classifyEntry([])).toBe("empty");
    expect(classifyEntry([], { images: 1 })).toBeNull();
    expect(classifyEntry([], { hasChildren: true })).toBeNull();
  });
  it("groups by the codex path and keeps the subfolder as a section", () => {
    expect(groupOf("environment/inventory/library/books/X.md")).toEqual({ group: "environment/inventory", section: "library/books" });
    expect(groupOf("interests/tiny_home/a.md")).toEqual({ group: "interests/tiny_home", section: "" });
    expect(groupOf("personal_development/schedule/2023-07-04.md")).toBeNull();
  });
  it("lists each entry with its properties, pictures and board", () => {
    const img = { type: "image", attrs: { src: "/x.png" } };
    const doc = listDoc("Inventory — list", [
      { title: "Inception", lines: ["Seen: No"], images: [], section: "movies", board: "Movies" },
      { title: "Staff", lines: ["Box: On me"], images: [img], section: "", board: null },
    ]);
    const text = JSON.stringify(doc);
    expect(text).toContain("Inception"); expect(text).toContain("Seen: No"); expect(text).toContain("on Movies");
    expect(text).toContain("/x.png");
    expect(doc.content.filter((n) => n.type === "bulletList")).toHaveLength(2);
  });
  it("noteLines takes one line per block", () => {
    expect(noteLines({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Author: A" }] }, { type: "paragraph", content: [{ type: "text", text: "Seen: No" }] }] }))
      .toEqual(["Author: A", "Seen: No"]);
  });
});
