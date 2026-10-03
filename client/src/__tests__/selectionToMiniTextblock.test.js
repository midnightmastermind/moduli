// The doc toolbar's selection button makes a MINI TEXTBLOCK (a real occurrence
// whose body is the text), not a bare instancePill with no module behind it
// (user, 2026-10-03: "we have minitextblock occurances, not just something in line").
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");

describe("createInlineTextblock", () => {
  it("mints a textblock/inline module and an occurrence whose body is the text, parented to the doc", async () => {
    const { createInlineTextblock } = await import("../helpers/CommitHelpers");
    const emitted = []; const socket = { emit: (ev, p) => emitted.push([ev, p]), connected: true };
    const attrs = createInlineTextblock({ dispatch: () => {}, socket, userId: "u", gridId: "g", parentId: "doc", text: "  call the dentist " });
    const mod = emitted.find(([ev]) => ev === "create_module")?.[1]?.module;
    const occ = emitted.find(([ev]) => /create_occurrence|create_batch/.test(ev))?.[1];
    const o = occ?.occurrence || occ?.occurrences?.[0] || occ;
    expect(mod).toMatchObject({ id: attrs.instanceId, role: "textblock", kind: "inline", label: "" });
    expect(o).toMatchObject({ id: attrs.occurrenceId, moduleId: attrs.instanceId, parentId: "doc" });
    expect(o.textmap).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "call the dentist" }] }] });
  });
});

describe("wiring", () => {
  it("the toolbar button no longer mints an instancePill from text", () => {
    const src = read("../docs/DocToolbar.jsx");
    expect(src).not.toMatch(/instanceLabel: selectedText/);
    expect(src).toMatch(/onMakeInlineTextblock\(from, to, editor\.state\.doc\.textBetween\(from, to\)\)/);
  });
  it("the editor hands the toolbar its one selection action, and both menu items use the shared creator", () => {
    const src = read("../ui/Editor.jsx");
    expect(src).toMatch(/<DocToolbar editor=\{editor\} onMakeInlineTextblock=/);
    expect(src).toMatch(/onClick: \(\) => makeInlineTextblockAt\(capturedFrom, capturedTo, capturedText\)/);
    expect(src).toMatch(/CommitHelpers\.createInlineTextblock\(\{ dispatch, socket, userId, gridId, parentId: occurrence\?\.id, text: tok \}\)/);
    expect(src).not.toMatch(/role: "textblock", kind: "inline", label: "" \},\s*emit: true/);
  });
});
