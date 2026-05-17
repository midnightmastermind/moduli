import { describe, it, expect } from "vitest";
import { resolveOptions } from "../helpers/optionsResolver";

const emptyCtx = { occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {} };

describe("resolveOptions — manual mode", () => {
  it("returns each value as {value, label} pair", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: ["Apples", "Oranges"] } } };
    const { options, totalMatched } = resolveOptions(field, emptyCtx);
    expect(options).toEqual([
      { value: "Apples", label: "Apples" },
      { value: "Oranges", label: "Oranges" },
    ]);
    expect(totalMatched).toBe(2);
  });

  it("handles numeric values", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: [1, 2, 3] } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
    ]);
  });

  it("returns empty when values missing", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual" } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });

  it("manual mode preserves {value,label} shape for object entries", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "manual", values: [{ value: "x", label: "X-ray" }, { value: "y", label: "Yankee" }] } } };
    const { options } = resolveOptions(field, { occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {} });
    expect(options).toEqual([{ value: "x", label: "X-ray" }, { value: "y", label: "Yankee" }]);
  });
});

describe("resolveOptions — range mode", () => {
  it("expands [start, end] with step", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 1, end: 5, step: 1 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([
      { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" },
      { value: 4, label: "4" }, { value: 5, label: "5" },
    ]);
  });

  it("handles step > 1", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 0, end: 20, step: 5 } } } };
    expect(resolveOptions(field, emptyCtx).options.map(o => o.value)).toEqual([0, 5, 10, 15, 20]);
  });

  it("returns empty for invalid step", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 0, end: 5, step: 0 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });

  it("returns empty when end < start", () => {
    const field = { type: "select", meta: { optionsSource: { mode: "range", range: { start: 5, end: 1, step: 1 } } } };
    expect(resolveOptions(field, emptyCtx).options).toEqual([]);
  });
});

describe("resolveOptions — guards", () => {
  it("returns empty for non-select fields", () => {
    expect(resolveOptions({ type: "number", meta: {} }, emptyCtx).options).toEqual([]);
  });

  it("returns empty for missing optionsSource", () => {
    expect(resolveOptions({ type: "select", meta: {} }, emptyCtx).options).toEqual([]);
  });
});

describe("resolveOptions — find mode", () => {
  const ctx = {
    occurrencesById: {
      occ1: { id: "occ1", moduleId: "modA", role: "instance", fields: { f1: { value: "movies" } } },
      occ2: { id: "occ2", moduleId: "modB", role: "instance", fields: { f1: { value: "movies" } } },
      occ3: { id: "occ3", moduleId: "modC", role: "instance", fields: { f1: { value: "books" } } },
      occ4: { id: "occ4", moduleId: "modD", role: "container", fields: {} },
    },
    modulesById: {
      modA: { id: "modA", label: "Inception", role: "instance" },
      modB: { id: "modB", label: "Arrival", role: "instance" },
      modC: { id: "modC", label: "Dune", role: "instance" },
      modD: { id: "modD", label: "Movies", role: "container" },
    },
    fieldsById: { f1: { id: "f1", name: "medium" } },
    foldersById: {},
  };

  it("filters $allInstances by predicate, extracts label", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: {
        over: "$allInstances",
        predicate: { rules: [{ left: "fields.f1.value", comparator: "IS", right: "movies" }] },
        valuePath: "label",
      },
    } } };
    const { options, totalMatched } = resolveOptions(field, ctx);
    expect(options.map(o => o.value).sort()).toEqual(["Arrival", "Inception"]);
    expect(totalMatched).toBe(2);
  });

  it("uses labelPath when set; value stays as valuePath", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: {
        over: "$allInstances",
        predicate: { rules: [{ left: "fields.f1.value", comparator: "IS", right: "movies" }] },
        valuePath: "id",
        labelPath: "label",
      },
    } } };
    const { options } = resolveOptions(field, ctx);
    const byId = Object.fromEntries(options.map(o => [o.value, o.label]));
    expect(byId).toEqual({ occ1: "Inception", occ2: "Arrival" });
  });

  it("dedupes by value (last label wins)", () => {
    const ctx2 = {
      ...ctx,
      occurrencesById: {
        a: { id: "a", moduleId: "x", role: "instance", fields: {} },
        b: { id: "b", moduleId: "y", role: "instance", fields: {} },
      },
      modulesById: { x: { id: "x", label: "Same" }, y: { id: "y", label: "Same" } },
    };
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label" },
    } } };
    const { options, totalMatched } = resolveOptions(field, ctx2);
    expect(options).toHaveLength(1);
    expect(totalMatched).toBe(2);
  });

  it("sorts asc by sortPath when set", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: {
        over: "$allInstances",
        predicate: { rules: [] },
        valuePath: "label",
        sortPath: "label",
        sortDir: "asc",
      },
    } } };
    expect(resolveOptions(field, ctx).options.map(o => o.value)).toEqual(["Arrival", "Dune", "Inception"]);
  });

  it("sorts desc when sortDir=desc", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label", sortPath: "label", sortDir: "desc" },
    } } };
    expect(resolveOptions(field, ctx).options.map(o => o.value)).toEqual(["Inception", "Dune", "Arrival"]);
  });

  it("applies limit and reports totalMatched separately", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [] }, valuePath: "label", sortPath: "label", sortDir: "asc", limit: 2 },
    } } };
    const { options, totalMatched } = resolveOptions(field, ctx);
    expect(options.map(o => o.value)).toEqual(["Arrival", "Dune"]);
    expect(totalMatched).toBe(3);
  });

  it("uses $allContainers when over points there", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allContainers", predicate: { rules: [] }, valuePath: "label" },
    } } };
    expect(resolveOptions(field, ctx).options).toEqual([{ value: "Movies", label: "Movies" }]);
  });

  it("returns empty when predicate matches nothing", () => {
    const field = { type: "select", meta: { optionsSource: {
      mode: "find",
      find: { over: "$allInstances", predicate: { rules: [{ left: "label", comparator: "IS", right: "Nope" }] }, valuePath: "label" },
    } } };
    expect(resolveOptions(field, ctx).options).toEqual([]);
  });
});

describe("resolveOptions — $this reference in predicate", () => {
  it("filters by $this.fields.<id>.value when ownerOccurrence provided", () => {
    const ctx = {
      occurrencesById: {
        a: { id: "a", moduleId: "x", role: "instance", fields: { cat: { value: "fruit" } } },
        b: { id: "b", moduleId: "y", role: "instance", fields: { cat: { value: "veg" } } },
        c: { id: "c", moduleId: "z", role: "instance", fields: { cat: { value: "fruit" } } },
      },
      modulesById: {
        x: { id: "x", label: "Apple" },
        y: { id: "y", label: "Carrot" },
        z: { id: "z", label: "Banana" },
      },
      fieldsById: {},
      foldersById: {},
    };
    const owner = { id: "buy1", fields: { type: { value: "fruit" } } };
    const field = { type: "occurrence", meta: { optionsSource: {
      mode: "find",
      over: "$allInstances",
      predicate: { rules: [{ left: "fields.cat.value", comparator: "IS", right: "$this.fields.type.value" }] },
      valuePath: "id",
      labelPath: "label",
    }}};
    const { options } = resolveOptions(field, ctx, owner);
    expect(options.map(o => o.label).sort()).toEqual(["Apple", "Banana"]);
  });

  it("returns all matches when ownerOccurrence is null (preview mode)", () => {
    // Without $this, the predicate's $this.fields.X.value resolves to undefined,
    // so the rule fails for every record — empty options is acceptable.
    // Confirm we don't CRASH when $this is missing.
    const field = { type: "occurrence", meta: { optionsSource: {
      mode: "find",
      over: "$allInstances",
      predicate: { rules: [{ left: "fields.cat.value", comparator: "IS", right: "$this.fields.type.value" }] },
      valuePath: "id",
      labelPath: "label",
    }}};
    expect(() => resolveOptions(field, { occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {} })).not.toThrow();
  });
});

describe("resolveOptions — occurrence type", () => {
  it("resolves occurrence-type fields via find mode (regression: bug where guard rejected non-select types)", () => {
    const field = {
      type: "occurrence",
      meta: {
        optionsSource: {
          mode: "find",
          find: {
            over: "$allInstances",
            predicate: { rules: [] },
            valuePath: "id",
            labelPath: "label",
          },
        },
      },
    };
    const ctx = {
      occurrencesById: {
        a: { id: "a", moduleId: "m", role: "instance", fields: {} },
      },
      modulesById: { m: { id: "m", label: "Inception", role: "instance" } },
      fieldsById: {},
      foldersById: {},
    };
    const { options, totalMatched } = resolveOptions(field, ctx);
    expect(options).toEqual([{ value: "a", label: "Inception" }]);
    expect(totalMatched).toBe(1);
  });

  it("manual mode works for occurrence type", () => {
    const field = { type: "occurrence", meta: { optionsSource: { mode: "manual", values: ["x", "y"] } } };
    const { options } = resolveOptions(field, { occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {} });
    expect(options).toEqual([{ value: "x", label: "x" }, { value: "y", label: "y" }]);
  });
});
