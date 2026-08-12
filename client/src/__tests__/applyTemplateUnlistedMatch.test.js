// client/src/__tests__/applyTemplateUnlistedMatch.test.js
//
// APPLY_TEMPLATE mode:"merge" decides "this already exists" by scanning the
// TARGET's `occurrences[]` for a matching identitySignature. A child that fell
// OUT of that array — the created-but-unlinked class this repo has repaired
// from four directions — was invisible to that scan, so merge concluded "not
// here yet" and cloned a second one. Then a third.
//
// MEASURED ON POMS GRID, 2026-08-11, which is what these fixtures reproduce:
//
//   Monday, August 10th  Journal         x3   1 UNLISTED + 2 listed
//                        Notes           x3   1 UNLISTED + 2 listed
//                        Tasks Completed x3   1 UNLISTED + 2 listed
//                        Highlights      x3   1 UNLISTED + 2 listed
//
// A signed child whose `parentId` points at the target IS the node that
// signature names, listed or not.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const TPL_ROOT = "tpl-root";
const TPL_SECTION = "tpl-section";
const TARGET = "day-col";
const SIG = "daypage:Journal";

const mods = {
  "m-root": { id: "m-root", role: "container", kind: "doc", label: "Day Page", fieldBindings: [] },
  "m-sec": { id: "m-sec", role: "container", kind: "doc", label: "Journal", fieldBindings: [] },
  "m-col": { id: "m-col", role: "container", kind: "doc", label: "Column", fieldBindings: [] },
};

/** @param existing  the section already under the target, or null for none */
function world(existing) {
  const occurrencesById = {
    [TPL_ROOT]: { id: TPL_ROOT, moduleId: "m-root", occurrences: [TPL_SECTION] },
    [TPL_SECTION]: { id: TPL_SECTION, moduleId: "m-sec", occurrences: [], identitySignature: SIG },
    [TARGET]: {
      id: TARGET, moduleId: "m-col",
      occurrences: existing?.listed ? [existing.id] : [],
    },
  };
  if (existing) {
    occurrencesById[existing.id] = {
      id: existing.id, moduleId: "m-sec", occurrences: [],
      identitySignature: existing.sig ?? SIG,
      parentId: existing.parentId ?? TARGET,
    };
  }
  return { occurrencesById, modulesById: mods, fieldsById: {} };
}

function applyMerge(ctx) {
  const $vars = {
    $allOccurrences: Object.values(ctx.occurrencesById),
    $allItems: Object.values(ctx.occurrencesById),
    $tplId: TPL_ROOT, $colId: TARGET,
  };
  const updates = executeActionItem(
    "APPLY_TEMPLATE",
    { templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge", unwrapRoot: true },
    $vars, ctx,
  ) || [];
  return {
    created: updates.filter(u => u._effect === "CREATE_ITEM"),
    relinks: updates.filter(u => u._effect === "UPDATE_OCCURRENCE" && Array.isArray(u.occurrence?.occurrences)),
  };
}

describe("merge matches a signed child the parent no longer lists", () => {
  // THE REGRESSION. Before this, the unlisted copy was invisible and merge
  // cloned a duplicate on every single load.
  it("does NOT clone when an UNLISTED signed child already points at the target", () => {
    const { created } = applyMerge(world({ id: "stray", listed: false }));
    expect(created).toHaveLength(0);
  });

  it("RE-LISTS the adopted child, or the merge succeeds and the section stays invisible", () => {
    const { relinks } = applyMerge(world({ id: "stray", listed: false }));
    const onTarget = relinks.find(u => u.occurrence.id === TARGET);
    expect(onTarget).toBeTruthy();
    expect(onTarget.occurrence.occurrences).toContain("stray");
  });

  it("still clones when the target genuinely has nothing", () => {
    const { created } = applyMerge(world(null));
    expect(created).toHaveLength(1);
  });

  it("is unchanged for the normal LISTED match — no clone, no relink", () => {
    const { created, relinks } = applyMerge(world({ id: "kid", listed: true }));
    expect(created).toHaveLength(0);
    expect(relinks.find(u => u.occurrence.id === TARGET)).toBeFalsy();
  });

  // A child pointing at some OTHER parent is not this target's node, however
  // well its signature matches — `parentId` is doing the identity work here.
  it("does NOT adopt a signed child that belongs to a different parent", () => {
    const w = world({ id: "elsewhere", listed: false, parentId: "some-other-column" });
    const { created } = applyMerge(w);
    expect(created).toHaveLength(1);
  });

  it("does NOT adopt on a signature mismatch", () => {
    const w = world({ id: "other", listed: false, sig: "daypage:Notes" });
    const { created } = applyMerge(w);
    expect(created).toHaveLength(1);
  });

  // On a grid that ALREADY carries duplicates, preferring the stray would top
  // up the invisible copy and leave the visible one stale. Listed wins.
  it("prefers the LISTED copy when both exist, so existing data never gets worse", () => {
    const ctx = world({ id: "kid", listed: true });
    ctx.occurrencesById.stray = {
      id: "stray", moduleId: "m-sec", occurrences: [],
      identitySignature: SIG, parentId: TARGET,
    };
    const { created, relinks } = applyMerge(ctx);
    expect(created).toHaveLength(0);
    expect(relinks.find(u => u.occurrence.id === TARGET)).toBeFalsy();
  });

  it("re-running after the adopt is a no-op — the child is listed now", () => {
    const ctx = world({ id: "stray", listed: false });
    applyMerge(ctx);
    // The action patches the in-pipeline overlay, so the second pass sees it.
    ctx.occurrencesById[TARGET] = {
      ...ctx.occurrencesById[TARGET],
      occurrences: [...(ctx.occurrencesById[TARGET].occurrences || []), "stray"],
    };
    const second = applyMerge(ctx);
    expect(second.created).toHaveLength(0);
    expect(second.relinks.find(u => u.occurrence.id === TARGET)).toBeFalsy();
  });
});
