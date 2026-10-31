import { describe, it, expect } from "vitest";
import { holdBackText } from "../utils/splitFullState.js";

const mods = [{ id: "mPanel", role: "panel" }, { id: "mPage", role: "page", kind: "doc" }, { id: "mFolder", role: "page", kind: "folder" },
  { id: "mText", role: "textblock" }, { id: "mCont", role: "container", kind: "doc" }];
const tm = (...embeds) => ({ type: "doc", content: embeds.map((id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id } })) });
const core = [
  { id: "panel", moduleId: "mPanel", occurrences: ["open", "root"] },
  { id: "open", moduleId: "mPage", occurrences: ["c1"], textmap: tm("t1") },
  { id: "c1", moduleId: "mCont", textmap: tm("t1") },
  { id: "t1", moduleId: "mText", textmap: { type: "doc", content: [] } },
  { id: "root", moduleId: "mFolder", occurrences: ["note"] },
  { id: "note", moduleId: "mPage", occurrences: ["nc"], textmap: tm("nt") },
  { id: "nc", moduleId: "mCont", textmap: tm("nt") },
  { id: "nt", moduleId: "mText", textmap: { type: "doc", content: [{ type: "paragraph" }] } },
  { id: "loose", moduleId: "mText", textmap: { type: "doc" } },
];

describe("holdBackText", () => {
  const { core: out, textmaps } = holdBackText(core, { keepRootIds: ["panel"], modules: mods });
  const row = (id) => out.find((o) => o.id === id);
  it("keeps the text of what the panels show, through lists and embeds", () => {
    for (const id of ["open", "c1", "t1"]) { expect(row(id).textmap).toBeTruthy(); expect(row(id).textHeld).toBeUndefined(); }
  });
  it("holds back the text of a page reached only through a folder page, marked", () => {
    expect(Object.keys(textmaps).sort()).toEqual(["nc", "note", "nt"]);
    expect(row("nt").textmap).toBeUndefined();
    expect(row("nt").textHeld).toBe(true);
  });
  it("keeps the rows themselves, and the text of a row under no page", () => {
    expect(out).toHaveLength(core.length);
    expect(row("loose").textmap).toBeTruthy();
  });
  it("holds nothing back when the note itself is kept", () => {
    expect(Object.keys(holdBackText(core, { keepRootIds: ["panel", "note"], modules: mods }).textmaps)).toEqual([]);
  });
});
