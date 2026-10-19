// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as CH from "../helpers/CommitHelpers";

const emits = [];
const socket = { emit: (ev, payload) => emits.push({ ev, payload }), connected: true };
const dispatch = vi.fn();
const lastEmit = (ev) => [...emits].reverse().find((e) => e.ev === ev)?.payload;

describe("renameFileTile — the rename goes to whichever name the card shows", () => {
  beforeEach(() => { emits.length = 0; dispatch.mockClear(); });

  it("a placement with its own title renames the PLACEMENT, never the shared module", () => {
    const module = { id: "movie-type", role: "artifact", label: "Movie", meta: {} };
    const occurrence = { id: "o1", moduleId: "movie-type", label: "John Wick" };
    CH.renameFileTile({ dispatch, socket, module, occurrence, label: "John Wick 2" });
    expect(lastEmit("update_module")).toBeUndefined();
    expect(lastEmit("update_occurrence")?.occurrence ?? lastEmit("update_occurrence")).toMatchObject({ id: "o1", label: "John Wick 2" });
  });

  it("an upload showing its file name renames the file name with the label", () => {
    const module = { id: "m2", role: "artifact", label: "a.png", meta: { originalName: "a.png" } };
    CH.renameFileTile({ dispatch, socket, module, occurrence: { id: "o2", moduleId: "m2" }, label: "Sunset" });
    const m = lastEmit("update_module")?.module ?? lastEmit("update_module");
    expect(m).toMatchObject({ id: "m2", label: "Sunset" });
    expect(m.meta.originalName).toBe("Sunset");
  });

  it("no placement title: the module label is renamed", () => {
    const module = { id: "m3", role: "artifact", label: "Report", meta: {} };
    CH.renameFileTile({ dispatch, socket, module, occurrence: { id: "o3", moduleId: "m3" }, label: "Report 2026" });
    expect((lastEmit("update_module")?.module ?? lastEmit("update_module"))).toMatchObject({ id: "m3", label: "Report 2026" });
  });

  it("an empty name changes nothing", () => {
    CH.renameFileTile({ dispatch, socket, module: { id: "m4", label: "x", meta: {} }, occurrence: { id: "o4", label: "y" }, label: "  " });
    expect(emits.length).toBe(0);
  });
});
