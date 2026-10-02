// "To pill" on a textblock made an instancePill reading "Item" — a textblock has
// no label, its words are its body (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { pillNodeFor, isPlainOneLiner } from "../docs/toPill";

const para = (...content) => ({ type: "paragraph", content });
const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const doc = (...content) => ({ type: "doc", content });

describe("pillNodeFor", () => {
  it("a one-line textblock becomes the inline textblock chip, which shows its body", () => {
    const n = pillNodeFor({ mod: { id: "m", role: "textblock", label: "" }, occurrence: { textmap: doc(para(text("Charlie three"))) }, occurrenceId: "o" });
    expect(n).toEqual({ type: "instanceTextblockInline", attrs: { instanceId: "m", occurrenceId: "o" } });
  });
  it("a formatted or multi-paragraph textblock is not offered — the chip would flatten it", () => {
    const mod = { id: "m", role: "textblock" };
    expect(pillNodeFor({ mod, occurrence: { textmap: doc(para(text("a")), para(text("b"))) }, occurrenceId: "o" })).toBeNull();
    expect(pillNodeFor({ mod, occurrence: { textmap: doc(para(text("a", [{ type: "bold" }]))) }, occurrenceId: "o" })).toBeNull();
    expect(pillNodeFor({ mod, occurrence: { textmap: doc({ type: "table" }) }, occurrenceId: "o" })).toBeNull();
  });
  it("an instance is named by its PLACEMENT, the module label only as the fallback", () => {
    const mod = { id: "movie", role: "instance", label: "Movie" };
    expect(pillNodeFor({ mod, occurrence: { label: "John Wick" }, occurrenceId: "o" }).attrs.instanceLabel).toBe("John Wick");
    expect(pillNodeFor({ mod, occurrence: {}, occurrenceId: "o" }).attrs.instanceLabel).toBe("Movie");
    expect(pillNodeFor({ mod, occurrence: {}, occurrenceId: "o" }).type).toBe("instancePill");
  });
  it("nothing without a module or an occurrence", () => {
    expect(pillNodeFor({ mod: null, occurrenceId: "o" })).toBeNull();
    expect(pillNodeFor({ mod: { id: "m", role: "instance" }, occurrenceId: null })).toBeNull();
  });
  it("an empty body counts as one plain line", () => {
    expect(isPlainOneLiner(doc(para()))).toBe(true);
    expect(isPlainOneLiner(null)).toBe(true);
  });
});

describe("wiring", () => {
  it("the embed's To pill goes through pillNodeFor", () => {
    const src = fs.readFileSync(path.join(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf8");
    expect(src).toMatch(/insertContentAt\(pos, pill\)/);
    expect(src).not.toMatch(/instanceLabel: mod\.label/);
  });
  it("a rendered pill reads the placement's name before the module's", () => {
    const src = fs.readFileSync(path.join(__dirname, "../docs/pills/InstancePillNode.jsx"), "utf8");
    expect(src).toMatch(/const displayLabel = occurrenceDisplayLabel\(/);
  });
});

// ── the way back ────────────────────────────────────────────────────────────
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { liftInlineToBlock } from "../docs/toPill";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph+" },
    text: { group: "inline" },
    instancePill: { group: "inline", inline: true, atom: true, attrs: { occurrenceId: { default: "" } } },
    moduleEmbed: { group: "block", atom: true, attrs: { occurrenceId: { default: "" } } },
  },
});
const P = (...c) => schema.nodes.paragraph.create(null, c);
const T = (t) => schema.text(t);
const pill = schema.nodes.instancePill.create({ occurrenceId: "o" });
const embed = () => schema.nodes.moduleEmbed.create({ occurrenceId: "o" });
const shape = (d) => { const out = []; d.forEach((n) => out.push(n.type.name === "paragraph" ? `p(${n.textContent}${n.childCount && [...Array(n.childCount)].some((_, i) => n.child(i).type.name === "instancePill") ? "+pill" : ""})` : n.type.name)); return out; };
const pillPos = (d) => { let at = null; d.descendants((n, pos) => { if (n.type.name === "instancePill") at = pos; }); return at; };
const lift = (d) => { const tr = EditorState.create({ schema, doc: d }).tr; const ok = liftInlineToBlock(tr, pillPos(d), embed()); return { ok, doc: tr.doc, changed: tr.docChanged }; };

describe("liftInlineToBlock", () => {
  it("a pill alone on its line: the block replaces the line", () => {
    const r = lift(schema.nodes.doc.create(null, [P(T("before")), P(pill), P(T("after"))]));
    expect(r.ok).toBe(true);
    expect(shape(r.doc)).toEqual(["p(before)", "moduleEmbed", "p(after)"]);
  });
  it("trailing whitespace beside the pill does not count as a sentence", () => {
    const r = lift(schema.nodes.doc.create(null, [P(pill, T(" "))]));
    expect(shape(r.doc)).toEqual(["moduleEmbed"]);
  });
  it("a pill inside a sentence: the sentence STAYS, the block goes after it", () => {
    const r = lift(schema.nodes.doc.create(null, [P(T("see "), pill, T(" for details")), P(T("next"))]));
    expect(r.ok).toBe(true);
    expect(shape(r.doc)).toEqual(["p(see  for details)", "moduleEmbed", "p(next)"]);
  });
  it("refuses where a block cannot go (a list item) and changes nothing", () => {
    const li = schema.nodes.listItem.create(null, [P(T("a "), pill)]);
    const r = lift(schema.nodes.doc.create(null, [schema.nodes.bulletList.create(null, [li])]));
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(false);
  });
  it("both pill kinds go through it", () => {
    const a = fs.readFileSync(path.join(__dirname, "../docs/pills/InstancePillNode.jsx"), "utf8");
    const b = fs.readFileSync(path.join(__dirname, "../docs/pills/InstanceTextblockInlineNode.jsx"), "utf8");
    expect(a).toMatch(/liftInlineToBlock\(tr, getPos\(\), embedNode\)/);
    expect(a).not.toMatch(/tr\.replaceWith\(paraStart, paraEnd, embedNode\)/);
    expect(b).toMatch(/label: "To block"/);
    expect(b).toMatch(/liftInlineToBlock\(tr, getPos\(\), embedNode\)/);
  });
});
