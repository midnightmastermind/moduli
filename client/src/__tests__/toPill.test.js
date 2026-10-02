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
