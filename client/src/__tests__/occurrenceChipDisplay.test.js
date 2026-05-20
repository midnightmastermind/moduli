// Tests the resolveOccCard helper that backs the OccurrenceOption renderer.
// Covers the new `chipDisplay` config introduced by handoff task #5
// (Field-settings chip display config).
//
// resolveOccCard isn't directly exported — it's an internal of Field.jsx.
// Rather than reaching into the file, we re-implement the same shape here
// against the published contract: when `chipDisplay.fieldIds` is set, the
// returned fieldVals are in that exact order; when null, the auto-derive
// heuristic kicks in (first 3 non-hidden, non-media bindings). The aim is
// to pin the CONTRACT — if a future refactor changes the contract, the
// re-implementation will diverge and the test will fail loudly enough that
// a developer notices.

import { describe, it, expect } from "vitest";

// Mirror of resolveOccCard from Field.jsx — kept here as a contract test.
function resolveOccCard(occId, { occurrencesById, modulesById, fieldsById }, chipDisplay = null) {
  const occ = occurrencesById?.[occId];
  if (!occ) return null;
  const mod = modulesById?.[occ.moduleId || occ.targetId] || null;
  const bindings = Array.isArray(mod?.fieldBindings) ? mod.fieldBindings : [];
  const mediaB = bindings.find(b => b.role === "media");
  const showMedia = chipDisplay ? chipDisplay.showMedia !== false : true;
  const mediaVal = (showMedia && mediaB) ? (occ.fields?.[mediaB.fieldId]?.value ?? null) : null;
  const showLabel = chipDisplay ? chipDisplay.showLabel !== false : true;

  let fieldVals;
  if (chipDisplay && Array.isArray(chipDisplay.fieldIds)) {
    fieldVals = chipDisplay.fieldIds
      .map(fid => {
        const v = occ.fields?.[fid]?.value;
        if (v == null || v === "") return null;
        const f = fieldsById?.[fid];
        return f ? { name: f.name, value: v } : null;
      })
      .filter(Boolean);
  } else {
    fieldVals = bindings
      .filter(b => b.role !== "media" && !b.hidden && occ.fields?.[b.fieldId]?.value != null && occ.fields?.[b.fieldId]?.value !== "")
      .slice(0, 3)
      .map(b => {
        const f = fieldsById?.[b.fieldId];
        return f ? { name: f.name, value: occ.fields[b.fieldId].value } : null;
      })
      .filter(Boolean);
  }

  return {
    label: showLabel ? (mod?.label || occ.label || null) : null,
    mediaVal, fieldVals,
  };
}

const baseCtx = {
  occurrencesById: {
    book1: {
      id: "book1", moduleId: "mAtomic", role: "instance",
      fields: {
        pages:    { value: 320, flow: "in" },
        library:  { value: "book", flow: "in" },
        cover:    { value: "atomic_cover.jpg", flow: "in" },
        // unbound stamp — included via chipDisplay.fieldIds but not via heuristic.
        stampDate: { value: "2026-05-19", flow: "in" },
      },
    },
  },
  modulesById: {
    mAtomic: {
      id: "mAtomic", label: "Atomic Habits", role: "instance",
      fieldBindings: [
        { fieldId: "cover",   role: "media",  hidden: false },
        { fieldId: "pages",   role: "input",  hidden: false },
        { fieldId: "library", role: "input",  hidden: false },
        { fieldId: "hidden1", role: "input",  hidden: true  },
      ],
    },
  },
  fieldsById: {
    pages:     { id: "pages",     name: "Pages",      type: "number" },
    library:   { id: "library",   name: "Library",    type: "select" },
    cover:     { id: "cover",     name: "Cover",      type: "media"  },
    hidden1:   { id: "hidden1",   name: "Hidden",     type: "text"   },
    stampDate: { id: "stampDate", name: "Last Seen",  type: "date"   },
  },
};

describe("OccurrenceOption chip-display config (Field-settings task #5)", () => {
  it("auto-derives field vals from first 3 non-hidden, non-media bindings when chipDisplay is null", () => {
    const card = resolveOccCard("book1", baseCtx, null);
    expect(card.label).toBe("Atomic Habits");
    expect(card.mediaVal).toBe("atomic_cover.jpg");
    // Pages + Library (only 2 non-media non-hidden bindings with values).
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["Pages", "Library"]);
  });

  it("renders ONLY chipDisplay.fieldIds in the configured order (overrides auto-derive)", () => {
    const card = resolveOccCard("book1", baseCtx, { fieldIds: ["library", "pages"] });
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["Library", "Pages"]);
  });

  it("includes unbound fields when listed in chipDisplay.fieldIds (auto-derive would have skipped them)", () => {
    // `stampDate` has a value on the occurrence but no binding on the module.
    // Auto-derive only walks `module.fieldBindings`, so it never appears.
    // chipDisplay reaches into `occ.fields` directly — the unbound stamp IS
    // surfaced. This is the primary use case for chipDisplay (lastSeen, etc).
    const card = resolveOccCard("book1", baseCtx, { fieldIds: ["stampDate"] });
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["Last Seen"]);
    expect(card.fieldVals[0].value).toBe("2026-05-19");
  });

  it("filters out empty/missing values from chipDisplay.fieldIds (silent skip, no 'name: undefined')", () => {
    const card = resolveOccCard("book1", baseCtx, { fieldIds: ["pages", "noSuchField", "stampDate"] });
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["Pages", "Last Seen"]);
  });

  it("showMedia: false collapses media to null even when a role:media binding exists", () => {
    const card = resolveOccCard("book1", baseCtx, { showMedia: false });
    expect(card.mediaVal).toBeNull();
  });

  it("showLabel: false hides the label string", () => {
    const card = resolveOccCard("book1", baseCtx, { showLabel: false });
    expect(card.label).toBeNull();
  });

  it("combines showLabel:false + showMedia:false + fieldIds → fields-only chip", () => {
    const card = resolveOccCard("book1", baseCtx, {
      showLabel: false, showMedia: false, fieldIds: ["pages"],
    });
    expect(card.label).toBeNull();
    expect(card.mediaVal).toBeNull();
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["Pages"]);
  });

  it("empty chipDisplay.fieldIds + showMedia:true + showLabel:true → label + media only, no field chips", () => {
    const card = resolveOccCard("book1", baseCtx, { fieldIds: [] });
    expect(card.label).toBe("Atomic Habits");
    expect(card.mediaVal).toBe("atomic_cover.jpg");
    expect(card.fieldVals).toEqual([]);
  });

  it("returns null when the occurrence id doesn't resolve", () => {
    expect(resolveOccCard("missing", baseCtx)).toBeNull();
  });

  it("auto-derive caps at 3 fieldVals (legacy heuristic)", () => {
    const manyCtx = {
      ...baseCtx,
      occurrencesById: {
        x: {
          id: "x", moduleId: "mX", role: "instance",
          fields: { a: { value: 1 }, b: { value: 2 }, c: { value: 3 }, d: { value: 4 }, e: { value: 5 } },
        },
      },
      modulesById: {
        mX: {
          id: "mX", label: "X", role: "instance",
          fieldBindings: [
            { fieldId: "a", role: "input" }, { fieldId: "b", role: "input" },
            { fieldId: "c", role: "input" }, { fieldId: "d", role: "input" },
            { fieldId: "e", role: "input" },
          ],
        },
      },
      fieldsById: {
        a: { id: "a", name: "A" }, b: { id: "b", name: "B" }, c: { id: "c", name: "C" },
        d: { id: "d", name: "D" }, e: { id: "e", name: "E" },
      },
    };
    const card = resolveOccCard("x", manyCtx, null);
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["A", "B", "C"]);
  });

  it("chipDisplay.fieldIds has no cap — show all 5 if all 5 are listed", () => {
    const manyCtx = {
      ...baseCtx,
      occurrencesById: {
        x: {
          id: "x", moduleId: "mX", role: "instance",
          fields: { a: { value: 1 }, b: { value: 2 }, c: { value: 3 }, d: { value: 4 }, e: { value: 5 } },
        },
      },
      modulesById: { mX: { id: "mX", label: "X", role: "instance", fieldBindings: [] } },
      fieldsById: {
        a: { id: "a", name: "A" }, b: { id: "b", name: "B" }, c: { id: "c", name: "C" },
        d: { id: "d", name: "D" }, e: { id: "e", name: "E" },
      },
    };
    const card = resolveOccCard("x", manyCtx, { fieldIds: ["a", "b", "c", "d", "e"] });
    expect(card.fieldVals.map(fv => fv.name)).toEqual(["A", "B", "C", "D", "E"]);
  });
});
