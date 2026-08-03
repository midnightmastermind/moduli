// client/src/__tests__/applyTemplateAutoSign.test.js
//
// APPLY_TEMPLATE mode:"merge" decides "this already exists" by
// identitySignature. An UNSIGNED template node used to mean "clone fresh on
// EVERY merge" — and `Day Page: Build` merges into the same day column on every
// app load, so anything nobody had hand-signed was re-cloned every load. That
// is what produced 23 duplicate Daily Question wrappers in a single day
// (2026-07-31), and since identitySignature has no UI anywhere, it made adding
// a section to a template a trap instead of a feature.
//
// Unsigned nodes now fall back to a signature derived from their own template
// occurrence id: deterministic, unique, and requires no mutation of the
// template. First merge clones + stamps it; later merges match it.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const TPL_ROOT = "tpl-root";
const TPL_SECTION = "tpl-section";     // deliberately UNSIGNED, like a user-added section
const TARGET = "day-col";

function world() {
  const occurrencesById = {
    [TPL_ROOT]: { id: TPL_ROOT, moduleId: "m-root", occurrences: [TPL_SECTION] },
    [TPL_SECTION]: { id: TPL_SECTION, moduleId: "m-sec", occurrences: [], identitySignature: null },
    [TARGET]: { id: TARGET, moduleId: "m-col", occurrences: [] },
  };
  const modulesById = {
    "m-root": { id: "m-root", role: "container", kind: "doc", label: "Day Page", fieldBindings: [] },
    "m-sec": { id: "m-sec", role: "container", kind: "doc", label: "New Section", fieldBindings: [] },
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Column", fieldBindings: [] },
  };
  return { occurrencesById, modulesById };
}

function applyMerge({ occurrencesById, modulesById }) {
  const $vars = {
    $allOccurrences: Object.values(occurrencesById),
    $allItems: Object.values(occurrencesById),
    $tplId: TPL_ROOT,
    $colId: TARGET,
  };
  const updates = executeActionItem(
    "APPLY_TEMPLATE",
    { templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge", unwrapRoot: true },
    $vars,
    { occurrencesById, modulesById, fieldsById: {} },
  ) || [];
  return updates.filter(u => u._effect === "CREATE_ITEM");
}

describe("merge auto-signs unsigned template nodes", () => {
  it("clones an unsigned section on the FIRST merge and stamps a derived signature", () => {
    const w = world();
    const created = applyMerge(w);

    expect(created).toHaveLength(1);
    const sig = created[0].template?.identitySignature ?? created[0].instance?.identitySignature;
    expect(sig).toBe(`auto:${TPL_SECTION}`);
  });

  it("does NOT clone it again once the target already carries that signature", () => {
    const w = world();
    // Simulate the state after the first merge: the column now holds the clone.
    w.occurrencesById["clone-1"] = {
      id: "clone-1", moduleId: "m-sec", occurrences: [],
      identitySignature: `auto:${TPL_SECTION}`,
    };
    w.occurrencesById[TARGET] = { ...w.occurrencesById[TARGET], occurrences: ["clone-1"] };

    expect(applyMerge(w)).toHaveLength(0);   // was: cloned again on every load
  });

  it("a hand-written signature still wins over the derived one", () => {
    const w = world();
    w.occurrencesById[TPL_SECTION] = {
      ...w.occurrencesById[TPL_SECTION], identitySignature: "daypage:Journal",
    };
    const created = applyMerge(w);
    const sig = created[0].template?.identitySignature ?? created[0].instance?.identitySignature;
    expect(sig).toBe("daypage:Journal");
  });

  it("matches an EXISTING hand-signed section — the pre-existing contract is unchanged", () => {
    const w = world();
    w.occurrencesById[TPL_SECTION] = {
      ...w.occurrencesById[TPL_SECTION], identitySignature: "daypage:Journal",
    };
    w.occurrencesById["journal-1"] = {
      id: "journal-1", moduleId: "m-sec", occurrences: [], identitySignature: "daypage:Journal",
    };
    w.occurrencesById[TARGET] = { ...w.occurrencesById[TARGET], occurrences: ["journal-1"] };

    expect(applyMerge(w)).toHaveLength(0);
  });

  it("two distinct unsigned sections stay distinct (ids differ, so signatures do)", () => {
    const w = world();
    w.occurrencesById["tpl-section-2"] = {
      id: "tpl-section-2", moduleId: "m-sec", occurrences: [], identitySignature: null,
    };
    w.occurrencesById[TPL_ROOT] = {
      ...w.occurrencesById[TPL_ROOT], occurrences: [TPL_SECTION, "tpl-section-2"],
    };
    const created = applyMerge(w);
    const sigs = created.map(c => c.template?.identitySignature ?? c.instance?.identitySignature);
    expect(new Set(sigs).size).toBe(2);
  });
});
