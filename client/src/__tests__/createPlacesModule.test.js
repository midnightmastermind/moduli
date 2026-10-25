// CREATE can PLACE an existing module (`module`) and name the new occurrence (`occurrenceLabel`; `label` already means the module name on the server) — what a form button needs to
// add a movie to the Movies board as the board's own shared movie module, named from the form.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor.js";

const fieldsById = { f1: { id: "f1", name: "Rating", type: "number" } };
const movieMod = { id: "movieMod", role: "artifact", kind: "movie", label: "Movie", fieldBindings: [{ fieldId: "f1", order: 0 }] };

function run(config, vars = {}) {
  const op = { id: "op", name: "op", enabled: true, pipeline: { steps: [
    { id: "c", type: "action", config: { type: "CREATE", ...config } },
  ] } };
  const occurrencesById = { c1: { id: "c1", moduleId: "boardMod", occurrences: [] } };
  const state = { grid: { _id: "g" }, modules: [movieMod, { id: "boardMod", role: "container", kind: "board" }], occurrences: Object.values(occurrencesById) };
  return executePipeline(op, { state, fieldsById, occurrencesById, operationsById: {}, modulesById: { movieMod } }, { type: "ButtonOp" }, vars)
    .filter((u) => u && u._effect);
}

describe("CREATE module + occurrenceLabel", () => {
  it("places the existing module, names the occurrence, writes the fields — and mints no module", () => {
    const effects = run({ module: "movieMod", occurrenceLabel: "$name", parent: "c1", fields: { f1: "7" } }, { $name: "Dune" });
    const created = effects.filter((e) => e._effect === "CREATE_ITEM");
    expect(created).toHaveLength(1);
    expect(created[0].templateExists).toBe(true);
    expect(created[0].instance).toMatchObject({ templateId: "movieMod", parentId: "c1", label: "Dune", fields: { f1: { value: "7" } } });
    expect(created[0].template).toMatchObject({ id: "movieMod", role: "artifact", kind: "movie" });
    expect(effects.some((e) => e._effect === "CREATE_MODULE" || e._effect === "UPDATE_MODULE")).toBe(false);
  });

  it("a module that does not exist falls back to finding / minting by name", () => {
    const created = run({ module: "nope", name: "Thing", role: "instance", parent: "c1" }).filter((e) => e._effect === "CREATE_ITEM");
    expect(created).toHaveLength(1);
    expect(created[0].templateExists).toBeFalsy();
    expect(created[0].template).toMatchObject({ label: "Thing", role: "instance" });
  });

  it("without the keys nothing changes: no label, a minted module", () => {
    const created = run({ name: "Thing", role: "instance", parent: "c1" }).filter((e) => e._effect === "CREATE_ITEM");
    expect(created[0].instance.label).toBeUndefined();
    expect(created[0].templateExists).toBeFalsy();
  });

  it("binds a field the placed module does not bind yet", () => {
    const effects = run({ module: "movieMod", occurrenceLabel: "Dune", parent: "c1", fields: { f2: "x" } });
    const upd = effects.find((e) => e._effect === "UPDATE_MODULE");
    expect(upd.moduleId).toBe("movieMod");
    expect(upd.patch.fieldBindings.map((b) => b.fieldId)).toEqual(["f1", "f2"]);
  });

  it("finds an existing module by name unless newModule is set", () => {
    const named = run({ name: "Movie", role: "instance", parent: "c1" }).filter((e) => e._effect === "CREATE_ITEM");
    expect(named[0].instance.templateId).toBe("movieMod");
    const fresh = run({ name: "Movie", role: "instance", parent: "c1", newModule: true }).filter((e) => e._effect === "CREATE_ITEM");
    expect(fresh[0].instance.templateId).not.toBe("movieMod");
    expect(fresh[0].template).toMatchObject({ label: "Movie", role: "instance" });
  });
});
