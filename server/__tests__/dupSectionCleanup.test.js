// 0070 DELETES occurrences from protected live data, so the tests weigh the
// refusals far above the happy path.
import { describe, it, expect } from "vitest";
import { chooseKeeper, textCharsOf } from "../migrations/0070-remove-duplicate-signed-sections.mjs";

const copy = (id, chars, listed) => ({ occ: { id }, chars, listed });

describe("0070 textCharsOf — TEXT only, never field values", () => {
  it("counts text at any depth", () => {
    expect(textCharsOf({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: " world" }] }]}]},
    ]})).toBe(11);
  });

  it("reports an empty doc as zero — the shape every duplicate here has", () => {
    expect(textCharsOf({ type: "doc", content: [{ type: "paragraph" }] })).toBe(0);
    expect(textCharsOf({ type: "doc", content: [] })).toBe(0);
    expect(textCharsOf(null)).toBe(0);
  });

  it("does not count whitespace as writing", () => {
    expect(textCharsOf({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "   \n " }] }]})).toBe(0);
  });

  // The 0038 trap: it scored FIELD VALUES and fired on the app's own date stamp,
  // so it protected debris forever. Nothing but text reaches this function.
  it("ignores everything that is not a text node", () => {
    expect(textCharsOf({ type: "doc", content: [
      { type: "moduleEmbed", attrs: { occurrenceId: "abc" } },
      { type: "image", attrs: { src: "x.png" } },
    ]})).toBe(0);
  });
});

describe("0070 chooseKeeper", () => {
  it("keeps the copy that holds writing, even when it is UNLISTED", () => {
    const k = chooseKeeper([copy("a", 0, true), copy("b", 42, false)]);
    expect(k.occ.id).toBe("b");
  });

  // THE REFUSAL THAT MATTERS. Merging two written-in sections is a human call;
  // a migration guessing here destroys a journal entry.
  it("REFUSES the group when more than one copy holds writing", () => {
    expect(chooseKeeper([copy("a", 10, true), copy("b", 3, false)])).toBeNull();
  });

  it("prefers the LISTED copy when none hold writing, so render order is stable", () => {
    const k = chooseKeeper([copy("stray", 0, false), copy("shown", 0, true)]);
    expect(k.occ.id).toBe("shown");
  });

  it("keeps the FIRST listed when several are listed", () => {
    const k = chooseKeeper([copy("x", 0, false), copy("first", 0, true), copy("second", 0, true)]);
    expect(k.occ.id).toBe("first");
  });

  it("falls back to the first copy when nothing is listed and nothing is written", () => {
    expect(chooseKeeper([copy("a", 0, false), copy("b", 0, false)]).occ.id).toBe("a");
  });

  it("returns null for an empty group rather than throwing", () => {
    expect(chooseKeeper([])).toBeNull();
  });
});
