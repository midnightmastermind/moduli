// "Make inline textblock" builds the chip from the SELECTION'S CONTENT, marks
// included. Before 2026-10-07 it used the selection's plain text, so a bullet
// like "**Barbell Bench Press** – 4 sets" lost its bold inside the chip and the
// rebuild could not match poms exactly.
import { describe, it, expect, vi } from "vitest";
import { inlineContentFromSlice } from "../helpers/selectionInline";

const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const bold = [{ type: "bold" }];

describe("inlineContentFromSlice", () => {
  it("keeps marked runs as they are", () => {
    expect(inlineContentFromSlice([t("Barbell Bench Press", bold), t(" – 4 sets of 6-8 reps")]))
      .toEqual([t("Barbell Bench Press", bold), t(" – 4 sets of 6-8 reps")]);
  });
  it("unwraps a paragraph / list item and trims the outer ends", () => {
    const slice = [{ type: "paragraph", content: [t("  Days 1, 2, 3", bold), t(": Training days ")] }];
    expect(inlineContentFromSlice(slice)).toEqual([t("Days 1, 2, 3", bold), t(": Training days")]);
  });
  it("joins blocks with one space", () => {
    const slice = [{ type: "paragraph", content: [t("one")] }, { type: "paragraph", content: [t("two")] }];
    expect(inlineContentFromSlice(slice)).toEqual([t("one two")]);   // same-mark runs merge, as ProseMirror stores them
  });
  it("drops atoms a chip cannot hold, a hard break becomes a space", () => {
    const slice = [t("a"), { type: "instanceTextblockInline", attrs: { occurrenceId: "x" } }, { type: "hardBreak" }, t("b")];
    expect(inlineContentFromSlice(slice)).toEqual([t("a b")]);
  });
  it("an empty or whitespace selection yields nothing", () => {
    expect(inlineContentFromSlice([])).toEqual([]);
    expect(inlineContentFromSlice([t("   ")])).toEqual([]);
  });
});

describe("createInlineTextblock with content", () => {
  it("stores the given inline content as the chip's paragraph", async () => {
    const emitted = [];
    const socket = { connected: true, emit: (e, p) => emitted.push([e, p]) };
    const { createInlineTextblock } = await import("../helpers/CommitHelpers");
    createInlineTextblock({ dispatch: vi.fn(), socket, userId: "u", gridId: "g", parentId: "p", text: "ignored", content: [t("Bold", bold), t(" rest")] });
    const occ = emitted.find(([e]) => e === "create_occurrence")?.[1]?.occurrence;
    expect(occ.textmap).toEqual({ type: "doc", content: [{ type: "paragraph", content: [t("Bold", bold), t(" rest")] }] });
  });
  it("CONTROL: without content it still stores the plain text", async () => {
    const emitted = [];
    const socket = { connected: true, emit: (e, p) => emitted.push([e, p]) };
    const { createInlineTextblock } = await import("../helpers/CommitHelpers");
    createInlineTextblock({ dispatch: vi.fn(), socket, userId: "u", gridId: "g", parentId: "p", text: "plain" });
    const occ = emitted.find(([e]) => e === "create_occurrence")?.[1]?.occurrence;
    expect(occ.textmap.content[0].content).toEqual([t("plain")]);
  });
});
