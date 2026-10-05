// A DOC container renders its TEXTMAP and nothing else (ModuleContainer's doc
// branch is DocEditorShell alone). So a child its header "+" creates must be
// EMBEDDED in the parent's textmap as well as listed, or it exists in the data
// and never appears — found building the Day Page template by clicking
// (2026-10-05): five sections added, zero drawn.
import { describe, test, expect, vi } from "vitest";
import { createChildInContainer } from "../helpers/CommitHelpers";
import { appendDocEmbed } from "../helpers/docEmbedAppend";

const mocks = () => ({ dispatch: vi.fn(), socket: { emit: vi.fn(), connected: true } });
const updates = (socket) => socket.emit.mock.calls.filter((c) => c[0] === "update_occurrence").map((c) => c[1].occurrence);
const base = (kind, textmap) => ({
  gridId: "g1", userId: "u1",
  containerOccurrence: { id: "p1", moduleId: "pm1", occurrences: ["a"], ...(textmap ? { textmap } : {}) },
  containerModule: { id: "pm1", role: "container", kind },
});
const finalTextmap = (socket) => updates(socket).filter((u) => u.id === "p1" && u.textmap).at(-1)?.textmap;

describe("appendDocEmbed", () => {
  test("appends to existing content and keeps it", () => {
    const tm = { type: "doc", content: [{ type: "paragraph" }] };
    expect(appendDocEmbed(tm, { type: "moduleEmbed", attrs: { occurrenceId: "x" } }).content)
      .toEqual([{ type: "paragraph" }, { type: "moduleEmbed", attrs: { occurrenceId: "x" } }]);
  });
  test("a null textmap becomes a doc holding just the embed", () => {
    expect(appendDocEmbed(null, { type: "moduleEmbed", attrs: { occurrenceId: "x" } }))
      .toEqual({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "x" } }] });
  });
});

describe("createChildInContainer into a DOC container", () => {
  test("a nested container is listed AND embedded", () => {
    const { dispatch, socket } = mocks();
    const out = createChildInContainer({ dispatch, socket, ...base("doc", null), kind: "doc" });
    expect(updates(socket).some((u) => u.id === "p1" && u.occurrences?.includes(out.occurrenceId))).toBe(true);
    expect(finalTextmap(socket)?.content).toEqual([{ type: "moduleEmbed", attrs: { occurrenceId: out.occurrenceId } }]);
  });

  test("existing text in the parent is kept, the embed goes last", () => {
    const { dispatch, socket } = mocks();
    const tm = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
    const out = createChildInContainer({ dispatch, socket, ...base("doc", tm), kind: "board" });
    expect(finalTextmap(socket).content).toEqual([tm.content[0], { type: "moduleEmbed", attrs: { occurrenceId: out.occurrenceId } }]);
  });

  test("a textblock is embedded as an instanceTextblock node", () => {
    const { dispatch, socket } = mocks();
    const out = createChildInContainer({ dispatch, socket, ...base("doc", null), kind: "textblock" });
    expect(finalTextmap(socket).content).toEqual([{ type: "instanceTextblock", attrs: { instanceId: out.moduleId, occurrenceId: out.occurrenceId } }]);
  });

  // Control: a BOARD parent renders occurrences[], so it gets no textmap write.
  test("a board parent is only listed", () => {
    const { dispatch, socket } = mocks();
    createChildInContainer({ dispatch, socket, ...base("board", null), kind: "doc" });
    expect(updates(socket).some((u) => u.id === "p1" && "textmap" in u)).toBe(false);
  });
});
