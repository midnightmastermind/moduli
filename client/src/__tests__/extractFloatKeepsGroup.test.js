// A float dragged out of a group with two floats is lifted out alone; the group
// keeps its other float, the lead and the host (2026-10-02 — it used to unwrap all).
import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { extractGroupMember } from "../helpers/wrapGroupOps";
import fs from "fs";
import path from "path";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
    moduleEmbed: { group: "block", atom: true, attrs: { occurrenceId: { default: "" } } },
    wrapGroup: { group: "block", content: "moduleEmbed{2,}", attrs: { side: { default: "right" }, floatCount: { default: null }, wrap: { default: true } } },
  },
});
const e = (id) => schema.nodes.moduleEmbed.create({ occurrenceId: id });

function fakeEditor(doc) {
  const ed = { state: EditorState.create({ schema, doc }) };
  ed.chain = () => { const cmds = []; const c = { focus: () => c, command: (fn) => { cmds.push(fn); return c; }, run: () => { const tr = ed.state.tr; cmds.forEach((fn) => fn({ tr })); ed.state = ed.state.apply(tr); return true; } }; return c; };
  return ed;
}

describe("extractGroupMember with two floats", () => {
  it("lifts one float out and keeps float + lead + host wrapped", () => {
    const group = schema.nodes.wrapGroup.create({ floatCount: 2 }, [e("sq"), e("yin"), e("bravo"), e("alpha")]);
    const ed = fakeEditor(schema.nodes.doc.create(null, [group, schema.nodes.paragraph.create()]));
    extractGroupMember(ed, 0, "yin");
    const top = [];
    ed.state.doc.forEach((n) => top.push(n));
    expect(top[0].type.name).toBe("wrapGroup");
    expect(top[0].attrs.floatCount).toBe(1);
    const kids = []; top[0].forEach((k) => kids.push(k.attrs.occurrenceId));
    expect(kids).toEqual(["sq", "bravo", "alpha"]);
    expect(top[1].attrs.occurrenceId).toBe("yin");
  });
});

describe("Editor drop branch", () => {
  it("lifts a float (neighbor) out instead of unwrapping the whole group", () => {
    const src = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
    expect(src).toMatch(/draggedMode !== "copy" && \(isLead \|\| isNeighbor\)\)[\s\S]{0,200}extractGroupMember/);
  });
});

describe("a group's own float dropped on its text side", () => {
  const src = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
  it("detectSideHost offers the text side to a member float when the group has 2+ floats", () => {
    expect(src).toMatch(/memberIndex < floatCount && floatCount >= 2 && !overFloatCol[\s\S]{0,200}member: true, memberIndex/);
  });
  it("the drop moves it into the text side with one fewer float, before the re-morph branch", () => {
    const join = src.indexOf("float moves to its own group's text side");
    const remorph = src.indexOf("grouped → re-morph notch in place");
    expect(join).toBeGreaterThan(0);
    expect(join).toBeLessThan(remorph);
    expect(src).toMatch(/floatCount: fc - 1/);
  });
});

describe("a row moved from a board into a doc", () => {
  it("takes the doc as its parent when the board owned it", () => {
    const src = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
    expect(src).toMatch(/moved\?\.parentId === parentOcc\.id\)[\s\S]{0,200}parentId: occurrence\.id/);
  });
});
