// Moving several rows out of the SAME parent must remove all of them from it.
//
// `_pasteInto` read each row's source parent and the destination from ONE
// snapshot taken before the loop, so every move wrote the source list as it
// was BEFORE the earlier removals — re-listing the rows already moved.
// Measured 2026-09-28 moving the rebuild grid's old schedule rows into a day
// column: in each group of 2–4, every row reached the new slot but all except
// the last were ALSO still listed by the old slot (a move that left a copy).
import { describe, it, expect, vi } from "vitest";
import { runPasteClipboard as pasteInto } from "../helpers/pasteClipboard";

describe("bulk move out of one parent", () => {
  it("the source's final list no longer holds ANY of the moved rows", () => {
    const socket = { connected: true, emit: vi.fn() };
    const occurrencesById = {
      oldSlot: { id: "oldSlot", occurrences: ["a", "b", "keep"] },
      newSlot: { id: "newSlot", occurrences: ["x"] },
      a: { id: "a", parentId: "oldSlot" }, b: { id: "b", parentId: "oldSlot" }, keep: { id: "keep", parentId: "oldSlot" }, x: { id: "x", parentId: "newSlot" },
    };
    pasteInto({ mode: "move", ids: ["a", "b"], destinationOccurrence: occurrencesById.newSlot, destinationModule: { role: "container" }, occurrencesById, dispatch: vi.fn(), socket, gridId: "g", userId: "u" });
    const writes = socket.emit.mock.calls.filter(([e, p]) => e === "update_occurrence" && p?.occurrence?.occurrences);
    const last = (id) => writes.filter(([, p]) => p.occurrence.id === id).at(-1)?.[1].occurrence.occurrences;
    expect(last("oldSlot")).toEqual(["keep"]);
    expect(last("newSlot")).toEqual(["x", "a", "b"]);
  });
});
