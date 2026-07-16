import { describe, it, expect } from "vitest";
import { planContainerKindConversion, planLeafRoleConversion, textmapToPlainText } from "../helpers/convertOccurrence";

const mod = (kind) => ({ id: "m1", role: "container", kind, label: "Notes" });
const occ = (children) => ({ id: "o1", moduleId: "m1", occurrences: children });

describe("planContainerKindConversion", () => {
  it("no-ops for same kind / missing inputs", () => {
    expect(planContainerKindConversion({ occurrence: occ([]), module: mod("board"), targetKind: "board" })).toBeNull();
    expect(planContainerKindConversion({ occurrence: occ([]), module: null, targetKind: "doc" })).toBeNull();
    expect(planContainerKindConversion({ occurrence: occ([]), module: mod("board"), targetKind: "" })).toBeNull();
    expect(planContainerKindConversion({ occurrence: occ([]), module: mod("board"), targetKind: "bogus" })).toBeNull();
  });

  it("board → doc materializes a textmap embedding each child IN ORDER, preserving occurrences[]", () => {
    const plan = planContainerKindConversion({ occurrence: occ(["a", "b", "c"]), module: mod("board"), targetKind: "doc" });
    expect(plan.modulePatch.kind).toBe("doc");
    expect(plan.occurrencePatch.textmap).toEqual({
      type: "doc",
      content: [
        { type: "moduleEmbed", attrs: { occurrenceId: "a" } },
        { type: "moduleEmbed", attrs: { occurrenceId: "b" } },
        { type: "moduleEmbed", attrs: { occurrenceId: "c" } },
      ],
    });
    // children preserved (not minted/moved)
    expect(plan.occurrencePatch.occurrences).toEqual(["a", "b", "c"]);
  });

  it("→ doc with no children emits a non-empty paragraph (TipTap invariant)", () => {
    const plan = planContainerKindConversion({ occurrence: occ([]), module: mod("list"), targetKind: "doc" });
    expect(plan.occurrencePatch.textmap.content).toEqual([{ type: "paragraph" }]);
  });

  it("doc → board clears the stale textmap and keeps children in occurrences[]", () => {
    const source = { ...occ(["a", "b"]), textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "a" } }] } };
    const plan = planContainerKindConversion({ occurrence: source, module: mod("doc"), targetKind: "board" });
    expect(plan.modulePatch.kind).toBe("board");
    expect(plan.occurrencePatch.textmap).toBeNull();
    expect(plan.occurrencePatch.occurrences).toEqual(["a", "b"]);
  });

  it("board → list is a pure kind flip (no occurrence patch, both render occurrences[])", () => {
    const plan = planContainerKindConversion({ occurrence: occ(["a"]), module: mod("board"), targetKind: "list" });
    expect(plan.modulePatch.kind).toBe("list");
    expect(plan.occurrencePatch).toBeNull();
  });
});

describe("textmapToPlainText", () => {
  it("flattens paragraphs/marks to plain text", () => {
    const tm = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Buy milk", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "and eggs" }] },
    ]};
    expect(textmapToPlainText(tm)).toBe("Buy milk and eggs");
  });
  it("empty / non-object → ''", () => {
    expect(textmapToPlainText(null)).toBe("");
    expect(textmapToPlainText({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
  });
});

describe("planLeafRoleConversion", () => {
  const tbMod = () => ({ id: "m1", role: "textblock", kind: "doc", label: "" });
  const instMod = () => ({ id: "m1", role: "instance", kind: "list", label: "Buy milk" });

  it("no-ops for same role / non-convertible roles", () => {
    expect(planLeafRoleConversion({ occurrence: {}, module: tbMod(), targetRole: "textblock" })).toBeNull();
    expect(planLeafRoleConversion({ occurrence: {}, module: { role: "container" }, targetRole: "instance" })).toBeNull();
    expect(planLeafRoleConversion({ occurrence: {}, module: tbMod(), targetRole: "container" })).toBeNull();
  });

  it("textblock → instance flattens the prose to the label, clears the textmap", () => {
    const occurrence = { id: "o1", textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Call mom" }] }] } };
    const plan = planLeafRoleConversion({ occurrence, module: tbMod(), targetRole: "instance" });
    expect(plan.modulePatch.role).toBe("instance");
    expect(plan.modulePatch.kind).toBe("list");
    expect(plan.occurrencePatch.textmap).toBeNull();
    expect(plan.occurrencePatch.label).toBe("Call mom");
  });

  it("instance → textblock seeds an editable prose textmap from the label", () => {
    const plan = planLeafRoleConversion({ occurrence: { id: "o1" }, module: instMod(), targetRole: "textblock" });
    expect(plan.modulePatch.role).toBe("textblock");
    expect(plan.modulePatch.kind).toBe("doc");
    expect(plan.occurrencePatch.textmap).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Buy milk" }] }] });
  });
});
