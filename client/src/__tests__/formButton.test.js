// "Add a form button" on a container: the planner reads the container's own instances and builds
// a button field, an operation (form → Create → scroll to) and the binding. Nothing names movies.
import { describe, it, expect, afterEach, vi } from "vitest";
import { planFormButton, agreedValues } from "../helpers/formButton.js";
import { executePipeline } from "../helpers/operationExecutor.js";
import { operationsBridge } from "../state/bindSocketToStore.js";

const fieldsById = {
  title: { id: "title", name: "Title", type: "text" },
  year: { id: "year", name: "Year", type: "number" },
  cat: { id: "cat", name: "Board Category", type: "select" },
  poster: { id: "poster", name: "Poster", type: "media" },
  secret: { id: "secret", name: "Secret", type: "text" },
  total: { id: "total", name: "Total", type: "number", displayEnabled: true },
};
const binds = [
  { fieldId: "title", role: "input" }, { fieldId: "year", role: "input" },
  { fieldId: "cat", role: "input", hidden: true }, { fieldId: "poster", role: "media" },
  { fieldId: "secret", role: "input", hidden: true }, { fieldId: "total", role: "display" },
];

function world({ shared = true, rows = 2 } = {}) {
  const modulesById = { boardMod: { id: "boardMod", role: "container", kind: "board", label: "Movies", fieldBindings: [] } };
  const occurrencesById = {};
  const kids = [];
  for (let i = 0; i < rows; i++) {
    const modId = shared ? "movieMod" : `m${i}`;
    modulesById[modId] = { id: modId, role: "artifact", kind: "movie", label: "Movie", fieldBindings: binds };
    occurrencesById[`r${i}`] = {
      id: `r${i}`, moduleId: modId, parentId: "c1",
      fields: { title: { value: `T${i}` }, year: { value: 2000 + i }, cat: { value: ["movie"] }, secret: { value: "s" } },
    };
    kids.push(`r${i}`);
  }
  occurrencesById.c1 = { id: "c1", moduleId: "boardMod", occurrences: kids };
  return { container: occurrencesById.c1, containerModule: modulesById.boardMod, occurrencesById, modulesById, fieldsById, gridId: "g" };
}

const stepOf = (plan, type) => plan.operation.pipeline.steps.find((s) => s.config.type === type)?.config;

describe("planFormButton", () => {
  it("asks Name then the input fields the instances use — not agreed, media, display or button fields", () => {
    const plan = planFormButton({ ...world(), noun: "movie" });
    const form = stepOf(plan, "ASK_FORM");
    expect(form.title).toBe("New movie");
    expect(form.items.map((i) => i.key)).toEqual(["name", "title", "year"]);
    expect(form.items[0]).toMatchObject({ required: true, type: "text" });
    expect(form.items[1].fieldId).toBe("title");
  });

  it("writes the values every instance agrees on as fixed values, the rest from the form", () => {
    const create = stepOf(planFormButton({ ...world(), noun: "movie" }), "CREATE");
    expect(create.fields.cat).toEqual(["movie"]);
    expect(create.fields.secret).toBe("literal:s");
    expect(create.fields.title).toBe("$form.fields.title");
    expect(create.fields.year).toBe("$form.fields.year");
    expect(create.parent).toBe("$trigger.occurrenceId");
    expect(create.itemIdVar).toBe("$newId");
  });

  it("places the board's shared module and names the new occurrence from the form", () => {
    const create = stepOf(planFormButton({ ...world(), noun: "movie" }), "CREATE");
    expect(create.module).toBe("movieMod");
    expect(create.occurrenceLabel).toBe("$form.values.name");
  });

  it("without a shared module, makes an occurrence of the instances' role and kind", () => {
    const create = stepOf(planFormButton({ ...world({ shared: false }), noun: "movie" }), "CREATE");
    expect(create.module).toBeUndefined();
    expect(create).toMatchObject({ role: "artifact", kind: "movie", name: "$form.values.name" });
  });

  it("ends by scrolling to the new occurrence", () => {
    const steps = planFormButton({ ...world(), noun: "movie" }).operation.pipeline.steps;
    expect(steps.at(-1).config).toMatchObject({ type: "SCROLL_TO", itemIdExpr: "$newId" });
  });

  it("an empty container asks only Name and makes an instance", () => {
    const plan = planFormButton({ ...world({ rows: 0 }), noun: "idea" });
    expect(stepOf(plan, "ASK_FORM").items.map((i) => i.key)).toEqual(["name"]);
    expect(stepOf(plan, "CREATE")).toMatchObject({ role: "instance", name: "$form.values.name", fields: {} });
  });

  it("one instance agrees with nobody — its values are asked, not copied", () => {
    const create = stepOf(planFormButton({ ...world({ rows: 1 }), noun: "movie" }), "CREATE");
    expect(create.fields.title).toBe("$form.fields.title");
    expect(create.fields.cat).toBeUndefined();
    expect(create.module).toBeUndefined();
  });

  it("button field points at the operation, gets a unique name, and is bound visibly on the container", () => {
    const w = world();
    w.fieldsById = { ...w.fieldsById, x: { id: "x", name: "New movie", type: "button" } };
    const plan = planFormButton({ ...w, noun: "movie" });
    expect(plan.field).toMatchObject({ type: "button", name: "New movie 2", meta: { buttonLabel: "New movie", operationId: plan.operation.id } });
    expect(plan.operation.triggerObjects[0]).toMatchObject({ eventType: "onButton", targetId: plan.field.id });
    expect(plan.containerModule.fieldBindings.at(-1)).toEqual({ fieldId: plan.field.id, role: "input" });
  });
});

describe("agreedValues", () => {
  it("keeps only values every instance holds identically", () => {
    const rows = [{ fields: { a: { value: 1 }, b: { value: 2 } } }, { fields: { a: { value: 1 }, b: { value: 3 } } }];
    expect(agreedValues(rows, ["a", "b", "c"])).toEqual({ a: 1 });
  });
});

describe("the planned operation, run", () => {
  afterEach(() => { operationsBridge.requestUserInput = null; operationsBridge.applyEffect = null; });

  it("press → form → a new placement of the shared module, named and valued", async () => {
    const w = world();
    const plan = planFormButton({ ...w, noun: "movie" });
    operationsBridge.requestUserInput = vi.fn(() => Promise.resolve({ name: "Dune", title: "Dune", year: 2021 }));
    operationsBridge.applyEffect = () => {};
    const all = await new Promise((resolve) => {
      executePipeline(plan.operation, {
        state: { grid: { _id: "g" }, modules: Object.values(w.modulesById), occurrences: Object.values(w.occurrencesById) },
        fieldsById, occurrencesById: w.occurrencesById, modulesById: w.modulesById, operationsById: {},
        _onPipelineDone: resolve,
      }, { type: "ButtonOp", occurrenceId: "c1", instanceId: "boardMod", fieldId: plan.field.id });
    });
    const created = all.filter((u) => u?._effect === "CREATE_ITEM");
    expect(created).toHaveLength(1);
    expect(created[0].instance).toMatchObject({
      templateId: "movieMod", parentId: "c1", label: "Dune",
      fields: { title: { value: "Dune" }, year: { value: 2021 }, cat: { value: ["movie"] } },
    });
    expect(all.some((u) => u?._effect === "SCROLL_TO" && u.itemId === created[0].instance.id)).toBe(true);
  });
});

describe("the container radial carries it", () => {
  it("all three header variants offer Add a form button", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../modules/ModuleContainer.jsx", import.meta.url), "utf8");
    expect(src.match(/formButtonItem\(\{/g)?.length).toBe(3);
    expect(src).toMatch(/exportMarkdownItem\(\{/); // control: the neighbour item is still there
  });

  it("guesses the noun from the container's name", async () => {
    const { nounGuess } = await import("../ui/formButtonItem.js");
    expect(nounGuess("Movies")).toBe("movie");
    expect(nounGuess("Bookmarks")).toBe("bookmark");
    expect(nounGuess("Ideas")).toBe("idea");
    expect(nounGuess("Movies")).not.toBe("movy"); // "ies" is not a rule English keeps
    expect(nounGuess("Grass")).toBe("grass");
  });
});
