// 0218 merges modules only when they are IDENTICAL on everything an occurrence
// can observe. 93 modules on the live grid share a label+role+kind while
// differing somewhere — the fingerprint is what keeps them apart.
import { describe, it, expect } from "vitest";
import { moduleFingerprint, planCollapse } from "../migrations/0218-collapse-identical-clone-modules.mjs";

const mod = (id, over = {}) => ({ id, label: "Journal", role: "container", kind: "doc",
  fieldBindings: [{ fieldId: "f1", role: "input", hidden: false, order: 0 }], meta: {}, ...over });
const counts = (...ids) => new Map(ids.map((i) => [i, 1]));

describe("moduleFingerprint", () => {
  it("matches two identical modules", () => {
    expect(moduleFingerprint(mod("a"))).toBe(moduleFingerprint(mod("b")));
  });

  it("separates a different LABEL, ROLE, KIND, ownStyle or BINDING", () => {
    for (const over of [{ label: "Notes" }, { role: "instance" }, { kind: "board" },
                        { ownStyle: { bg: "#fff" } },
                        { fieldBindings: [{ fieldId: "f2", role: "input", hidden: false, order: 0 }] },
                        { fieldBindings: [{ fieldId: "f1", role: "input", hidden: true, order: 0 }] }]) {
      expect(moduleFingerprint(mod("a"))).not.toBe(moduleFingerprint(mod("b", over)));
    }
  });

  it("IGNORES the three provenance keys — they say where it came from, not what it is", () => {
    expect(moduleFingerprint(mod("a", { meta: { clonedFromModuleId: "x", appliedFromTemplateId: "y", templateName: "z" } })))
      .toBe(moduleFingerprint(mod("b")));
  });

  it("does NOT ignore any other meta key", () => {
    expect(moduleFingerprint(mod("a", { meta: { cardChrome: true } })))
      .not.toBe(moduleFingerprint(mod("b")));
  });

  it("is order-insensitive on bindings and meta", () => {
    const a = mod("a", { fieldBindings: [{ fieldId: "f1", order: 0 }, { fieldId: "f2", order: 1 }], meta: { x: 1, y: 2 } });
    const b = mod("b", { fieldBindings: [{ fieldId: "f2", order: 1 }, { fieldId: "f1", order: 0 }], meta: { y: 2, x: 1 } });
    expect(moduleFingerprint(a)).toBe(moduleFingerprint(b));
  });
});

describe("planCollapse", () => {
  const run = (modules, extra = {}) => planCollapse({
    modules, occurrenceCountByModule: counts(...modules.map((m) => m.id)), ...extra });

  it("groups identical modules onto one keeper", () => {
    const p = run([mod("a"), mod("b"), mod("c")]);
    expect(p).toHaveLength(1);
    expect(p[0].losers.map((m) => m.id).sort()).toEqual(["b", "c"]);
  });

  it("picks the keeper DETERMINISTICALLY, so a re-run converges", () => {
    const list = [mod("b", { createdAt: "2026-02-01" }), mod("a", { createdAt: "2026-01-01" })];
    expect(run(list)[0].keeper.id).toBe("a");
    expect(run([...list].reverse())[0].keeper.id).toBe("a");
  });

  it("leaves a module referenced by an operation or textmap alone", () => {
    // Repointing its occurrence would leave that reference naming a module that
    // places nothing.
    const p = run([mod("a"), mod("b")], { referencedIds: new Set(["b"]) });
    expect(p).toHaveLength(0);
  });

  it("never touches a module placed more than once, or placed nowhere", () => {
    const modules = [mod("a"), mod("b")];
    expect(planCollapse({ modules, occurrenceCountByModule: new Map([["a", 2], ["b", 1]]) })).toHaveLength(0);
    expect(planCollapse({ modules, occurrenceCountByModule: new Map([["a", 0], ["b", 0]]) })).toHaveLength(0);
  });

  it("never merges genuinely UNIQUE content", () => {
    // A bookmark's URL lives in `fileRef`; an unlabelled textblock's text lives
    // on its occurrence. Both are supposed to be 1:1.
    expect(run([mod("a", { fileRef: "http://x" }), mod("b", { fileRef: "http://x" })])).toHaveLength(0);
    expect(run([mod("a", { role: "textblock", label: null }), mod("b", { role: "textblock", label: null })])).toHaveLength(0);
  });

  it("never merges a TEMPLATE — it is not a placement", () => {
    expect(run([mod("a", { meta: { templateModule: true } }), mod("b", { meta: { templateModule: true } })])).toHaveLength(0);
  });

  it("skips a trashed module", () => {
    expect(run([mod("a"), mod("b", { trashed: true })])).toHaveLength(0);
  });

  it("keeps DIFFERENT things apart — the case worth 93 modules on the live grid", () => {
    expect(run([mod("a"), mod("b", { fieldBindings: [] })])).toHaveLength(0);
  });
});
