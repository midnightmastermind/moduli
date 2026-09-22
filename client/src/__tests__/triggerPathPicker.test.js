/**
 * triggerPathPicker.test.js
 *
 * THE PATH PICKER DESCRIBED $trigger AS AN OCCURRENCE. IT IS NOT ONE.
 *
 * Found building an operation through the UI on the rebuild grid (2026-09-22).
 * The Steps header tells the author to "use $trigger.* directly", and the
 * trigger row prints the props it carries — `$trigger.fieldId · $trigger.itemId
 * · $trigger.value · $trigger.previousValue · $trigger.flow · …`. But
 * `BUILTIN_VAR_SHAPES` mapped `$trigger: "occurrence"`, so drilling into it in
 * the picker offered:
 *
 *   id · moduleId · parentId · _ancestors · label · templateId · fields ·
 *   meta.x · meta.y · meta.date · … · filterOverride · _effectiveFilter
 *
 * NOT ONE of the props the trigger actually carries, and NOT `occurrence` —
 * the key the executor really sets (operationExecutor.js ~2024, `enriched.occurrence
 * = { id, moduleId, parentId, fields, _ancestors }`) and the one every poms
 * operation reaches through (`$trigger.occurrence.fields.<id>.value`).
 *
 * So the picker offered paths that resolve to undefined at runtime and hid the
 * only path that works. A picked path is not a typo the author can spot: it
 * renders as a chip chain and reads as correct.
 *
 * The key list is derived from `getTriggerVars` — the same function the trigger
 * row prints from — so a prop added there reaches the picker without a second
 * edit.
 */
import { describe, it, expect } from "vitest";
import { itemsForLevel } from "../ui/DrilldownPicker";
import { CATEGORIES } from "../ui/categoryRegistry";

const ctx = {
  sources: [],
  localVars: [],
  fields: [{ id: "f-done", name: "Done", type: "boolean" }],
  fieldsById: { "f-done": { id: "f-done", name: "Done", type: "boolean" } },
  modulesById: {},
  occurrencesById: {},
};

const keysAt = (chain) => itemsForLevel(chain, ctx, CATEGORIES).items.map((i) => i.value);

describe("$trigger in the path picker", () => {
  it("offers the trigger's own props, not an occurrence's", () => {
    const keys = keysAt(["builtins", "$trigger"]);
    for (const k of ["fieldId", "itemId", "value", "previousValue", "flow", "userId", "timestamp"]) {
      expect(keys, `missing $trigger.${k}`).toContain(k);
    }
  });

  it("offers `occurrence` — the key the executor actually sets", () => {
    expect(keysAt(["builtins", "$trigger"])).toContain("occurrence");
  });

  it("does not offer occurrence keys the runtime never puts on $trigger", () => {
    const keys = keysAt(["builtins", "$trigger"]);
    // `fields` is the sharp one: `$trigger.fields.<id>.value` reads as the
    // obvious path and is undefined at runtime for every trigger type.
    // NOT `parentId` — the union was measured and it IS a trigger prop, for
    // onAdd/onRemove (getTriggerVars). The first version of this test asserted
    // it away on the assumption that it was occurrence-only.
    for (const k of ["fields", "meta.x", "_effectiveFilter", "_ancestors"]) {
      expect(keys, `$trigger.${k} is not a real path`).not.toContain(k);
    }
  });

  it("drills through `occurrence` into the occurrence shape", () => {
    const keys = keysAt(["builtins", "$trigger", "occurrence"]);
    expect(keys).toEqual(expect.arrayContaining(["id", "moduleId", "parentId", "fields", "_ancestors"]));
  });

  it("and one more level reaches this grid's fields by name", () => {
    const items = itemsForLevel(["builtins", "$trigger", "occurrence", "fields"], ctx, CATEGORIES).items;
    expect(items.map((i) => i.title)).toContain("Done");
    expect(items.map((i) => i.value)).toContain("f-done");
  });

  it("CONTROL — $allItems still drills into the occurrence shape", () => {
    const keys = keysAt(["occurrences", "$allItems"]);
    expect(keys).toEqual(expect.arrayContaining(["id", "moduleId", "fields", "_effectiveFilter"]));
  });

  it("CONTROL — $grid is untouched", () => {
    expect(keysAt(["builtins", "$grid"]).length).toBeGreaterThan(0);
  });
});
