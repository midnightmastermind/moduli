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

// ── BUILD-then-MERGE (2026-08-07) ──────────────────────────────────────────
//
// The auto-sign above only ever ran in MERGE mode, and `Day Page: Build` uses
// BOTH branches: a brand-new column is cloned through the DEFAULT (append)
// branch via `rootParent`, and existing columns are topped up through MERGE.
// So a fresh column's clones carried `identitySignature: null` while the very
// next merge computed `auto:<templateChildId>` and matched nothing — it
// re-cloned the WHOLE subtree once, permanently doubling every day column.
// Measured on a date navigation: 128 CREATE_ITEM on the first merge after a
// fresh build, 0 on every merge after that.
//
// The fix signs non-root clones in EVERY mode. These tests drive the real
// two-step sequence, because neither step is wrong on its own — only the
// handoff between them was.
const FOLDER = "day-pages-folder";

// Fold CREATE_ITEM effects back into the world, the way the reducer does, so
// step 2 sees what step 1 actually built.
function applyCreates(w, created) {
  for (const c of created) {
    w.modulesById[c.template.id] = { ...c.template };
    w.occurrencesById[c.instance.id] = {
      ...c.instance,
      moduleId: c.instance.templateId,
      occurrences: c.instance.occurrences || [],
    };
  }
  return created.map(c => c.instance.id);
}

// `Day Page: Build`'s MINT branch — clone the whole template under a folder.
function applyBuild({ occurrencesById, modulesById }) {
  const $vars = {
    $allOccurrences: Object.values(occurrencesById),
    $allItems: Object.values(occurrencesById),
    $tplId: TPL_ROOT,
    $folderId: FOLDER,
  };
  const updates = executeActionItem(
    "APPLY_TEMPLATE",
    { templateRef: "$tplId", rootParent: "$folderId", rootLabel: "Day Page - 2026-08-07" },
    $vars,
    { occurrencesById, modulesById, fieldsById: {} },
  ) || [];
  return updates.filter(u => u._effect === "CREATE_ITEM");
}

function mergeInto({ occurrencesById, modulesById }, targetId) {
  const $vars = {
    $allOccurrences: Object.values(occurrencesById),
    $allItems: Object.values(occurrencesById),
    $tplId: TPL_ROOT,
    $colId: targetId,
  };
  const updates = executeActionItem(
    "APPLY_TEMPLATE",
    { templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge", unwrapRoot: true },
    $vars,
    { occurrencesById, modulesById, fieldsById: {} },
  ) || [];
  return updates.filter(u => u._effect === "CREATE_ITEM");
}

describe("a column BUILT by append is not re-cloned by the next merge", () => {
  it("build then merge creates NOTHING the second time", () => {
    const w = world();
    w.occurrencesById[FOLDER] = { id: FOLDER, moduleId: "m-folder", occurrences: [] };
    w.modulesById["m-folder"] = { id: "m-folder", role: "container", kind: "doc", label: "Day Pages", fieldBindings: [] };

    // Step 1 — the mint branch clones root + section.
    const built = applyBuild(w);
    expect(built).toHaveLength(2);
    const ids = applyCreates(w, built);
    const columnId = ids.find(id => w.occurrencesById[id].parentId === FOLDER);
    expect(columnId).toBeTruthy();

    // Step 2 — the top-up branch merges the SAME template into that column.
    // THE ASSERTION: it must recognise what step 1 built.
    expect(mergeInto(w, columnId)).toHaveLength(0);
  });

  it("the built section carries the derived signature the merge looks for", () => {
    const w = world();
    w.occurrencesById[FOLDER] = { id: FOLDER, moduleId: "m-folder", occurrences: [] };
    w.modulesById["m-folder"] = { id: "m-folder", role: "container", kind: "doc", label: "Day Pages", fieldBindings: [] };

    const built = applyBuild(w);
    const section = built.find(c => c.instance.parentId !== FOLDER);
    expect(section.instance.identitySignature).toBe(`auto:${TPL_SECTION}`);
  });

  it("a NON-merge root stays unsigned — every day column would otherwise share one signature", () => {
    const w = world();
    w.occurrencesById[FOLDER] = { id: FOLDER, moduleId: "m-folder", occurrences: [] };
    w.modulesById["m-folder"] = { id: "m-folder", role: "container", kind: "doc", label: "Day Pages", fieldBindings: [] };

    const built = applyBuild(w);
    const root = built.find(c => c.instance.parentId === FOLDER);
    // The root's identity belongs to whatever placed it (a dated column), not
    // to the template — the same reason gridIntegrity exempts a template root.
    expect(root.instance.identitySignature).toBeNull();
  });

  it("a MERGE root is still signed — that path matches against the target's siblings", () => {
    const w = world();
    // No unwrapRoot: the root itself is matched against the target's children.
    const $vars = {
      $allOccurrences: Object.values(w.occurrencesById),
      $allItems: Object.values(w.occurrencesById),
      $tplId: TPL_ROOT,
      $colId: TARGET,
    };
    const created = (executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge" },
      $vars,
      { occurrencesById: w.occurrencesById, modulesById: w.modulesById, fieldsById: {} },
    ) || []).filter(u => u._effect === "CREATE_ITEM");

    const root = created.find(c => c.instance.parentId === TARGET);
    expect(root.instance.identitySignature).toBe(`auto:${TPL_ROOT}`);
  });
});
