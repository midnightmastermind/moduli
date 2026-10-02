// The embed's wrap menu is memoized on wrapMenuKey — it must change whenever
// anything the menu is built from changes, and stay put otherwise (2026-10-02).
import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import fs from "fs";
import path from "path";
import { wrapMenuKey } from "../docs/wrapRoles";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
    moduleEmbed: { group: "block", atom: true, attrs: { occurrenceId: { default: "" } } },
    instanceTextblock: { group: "block", atom: true, attrs: { occurrenceId: { default: "" } } },
    wrapGroup: { group: "block", content: "moduleEmbed{2,}", attrs: { side: { default: "right" }, floatCount: { default: null }, wrap: { default: true } } },
  },
});
const e = (id) => schema.nodes.moduleEmbed.create({ occurrenceId: id });
const p = () => schema.nodes.paragraph.create();
const grp = (attrs, ids) => schema.nodes.wrapGroup.create(attrs, ids.map(e));
const doc = (...kids) => schema.nodes.doc.create(null, kids);
/** Position of the embed naming `id`. */
const posOf = (d, id) => { let at = null; d.descendants((n, pos) => { if (n.attrs?.occurrenceId === id && at == null) at = pos; }); return at; };
const key = (d, id, text = []) => wrapMenuKey(d, posOf(d, id), (x) => text.includes(x));

describe("wrapMenuKey", () => {
  const base = doc(grp({ floatCount: 1 }, ["pic", "bravo", "alpha"]), e("next"));

  it("changes when the host's module turns out to hold text (the Firefox case)", () => {
    expect(key(base, "alpha", [])).not.toBe(key(base, "alpha", ["alpha"]));
  });
  it("changes when the group's wrap attr flips", () => {
    const cols = doc(grp({ floatCount: 1, wrap: false }, ["pic", "bravo", "alpha"]), e("next"));
    expect(key(cols, "alpha")).not.toBe(key(base, "alpha"));
  });
  it("changes when this block's role changes (host -> lead as a block joins)", () => {
    const joined = doc(grp({ floatCount: 1 }, ["pic", "bravo", "alpha", "next"]));
    expect(key(joined, "alpha")).not.toBe(key(base, "alpha"));
  });
  it("changes when floatCount changes", () => {
    const two = doc(grp({ floatCount: 2 }, ["pic", "bravo", "alpha"]), e("next"));
    expect(key(two, "bravo")).not.toBe(key(base, "bravo"));
  });
  it("changes when the group moves — the items capture its position", () => {
    const shifted = doc(p(), grp({ floatCount: 1 }, ["pic", "bravo", "alpha"]), e("next"));
    expect(key(shifted, "alpha")).not.toBe(key(base, "alpha"));
  });
  it("changes when the block after the group changes or becomes text", () => {
    const none = doc(grp({ floatCount: 1 }, ["pic", "bravo", "alpha"]), p());
    expect(key(none, "alpha")).not.toBe(key(base, "alpha"));
    expect(key(base, "alpha", ["next"])).not.toBe(key(base, "alpha", []));
  });
  it("an embed outside a group ignores blocks added above it (the control)", () => {
    const a = doc(e("one"), e("two"));
    const b = doc(p(), p(), e("one"), e("two"));
    expect(key(a, "two")).toBe(key(b, "two"));
    expect(key(a, "two")).not.toBe(key(doc(p(), e("two")), "two"));
  });
  it("is empty for an unresolvable position", () => {
    expect(wrapMenuKey(base, 9999)).toBe("");
    expect(wrapMenuKey(null, 0)).toBe("");
  });
  it("the embed's items memo depends on it", () => {
    const src = fs.readFileSync(path.join(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf8");
    expect(src).toMatch(/socket, wrapKey, moduleOfOcc, canPill\]\);/);
    expect(src).toMatch(/editor\.on\("transaction", onTr\)/);
  });
});
