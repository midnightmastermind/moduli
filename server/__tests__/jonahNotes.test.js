import { describe, it, expect } from "vitest";
import { noteToText, noteSections, readNote, appendRemembered, MODULI_MD, ABOUT_MD, NOTE_READ_MAX } from "../services/jonahNotes.js";
import { noteDoc } from "../migrations/0421-jonah-notes.mjs";

const moduliText = noteToText(noteDoc(MODULI_MD));

describe("Jonah's notes", () => {
  it("the guide survives the trip into a doc and back, topic by topic", () => {
    const titles = noteSections(moduliText).map((s) => s.title);
    expect(titles).toContain("Moving and copying");
    expect(titles).toContain("Templates and feeds");
    expect(moduliText).toContain("- Copy-link: a linked copy");
  });
  it("a topic reads just that part", () => {
    const r = readNote(moduliText, { topic: "feeds" });
    expect(r.text).toMatch(/^## Templates and feeds/);
    expect(r.text).not.toContain("## The grid and panels");
  });
  it("an unknown topic lists the topics instead", () => {
    const r = readNote(moduliText, { topic: "zebras" });
    expect(r.text).toBeUndefined();
    expect(r.topics).toContain("Filters and dates");
  });
  it("a short note reads whole; a long one gives its topics", () => {
    const about = noteToText(noteDoc(ABOUT_MD));
    expect(readNote(about).text).toContain('Say "instances", never "rows"');
    const long = readNote(moduliText + "\n" + "x".repeat(NOTE_READ_MAX));
    expect(long.topics.length).toBeGreaterThan(5);
  });
  it("every guide section fits one read", () => {
    for (const s of noteSections(moduliText)) expect(s.body.length).toBeLessThan(NOTE_READ_MAX);
  });
  it("remembering adds one dated line and keeps the rest", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Things." }] }, { type: "paragraph" }] };
    const next = appendRemembered(doc, "  Coffee is black  ", new Date("2026-10-18T12:00:00Z"));
    expect(noteToText(next)).toBe("Things.\n2026-10-18 — Coffee is black");
  });
});
