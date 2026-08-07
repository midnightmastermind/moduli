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

// Regression — task #8 (handoff). The live grid seeds occurrence fields with
// optionsSource in the FLAT shape (over/predicate/valuePath at the same
// level as mode, no `find:` wrapper) AND uses `conjunction` instead of
// `operator` on the predicate group. Confirm the resolver still filters
// correctly under that exact shape — the user reported the picker "lets
// me select anything" even though predicates were scoped, suggesting the
// flat shape might bypass filtering. This test pins the contract.
describe("resolveOptions — find mode (live-seed flat shape, regression for handoff task #8)", () => {
  const liveSeedCtx = {
    occurrencesById: {
      movie1: { id: "movie1", moduleId: "mInception", role: "instance", fields: { libraryFid: { value: "movie", flow: "in" } } },
      movie2: { id: "movie2", moduleId: "mDune",      role: "instance", fields: { libraryFid: { value: "movie", flow: "in" } } },
      book1:  { id: "book1",  moduleId: "mAtomic",    role: "instance", fields: { libraryFid: { value: "book",  flow: "in" } } },
      // Tasks have NO library field — must NOT appear in a "library IS movie" pick.
      task1:  { id: "task1",  moduleId: "mWater",     role: "instance", fields: {} },
      // Containers must be excluded by the $allInstances filter.
      cont1:  { id: "cont1",  moduleId: "mCont",      role: "container", fields: { libraryFid: { value: "movie", flow: "in" } } },
    },
    modulesById: {
      mInception: { id: "mInception", label: "Inception",     role: "instance" },
      mDune:      { id: "mDune",      label: "Dune",          role: "instance" },
      mAtomic:    { id: "mAtomic",    label: "Atomic Habits", role: "instance" },
      mWater:     { id: "mWater",     label: "Drink Water",   role: "instance" },
      mCont:      { id: "mCont",      label: "Library",       role: "container" },
    },
    fieldsById: {},
    foldersById: {},
  };

  // Mirrors moviesWatchedFieldId in createLiveData.js exactly.
  const liveSeedField = {
    type: "occurrence",
    meta: {
      multiSelect: true,
      optionsSource: {
        mode: "find",
        over: "$allInstances",
        predicate: {
          conjunction: "AND",  // ← seed uses `conjunction` (not `operator`)
          rules: [
            { left: "fields.libraryFid.value", comparator: "IS", right: "movie" },
          ],
        },
        valuePath: "id",
        labelPath: "label",
      },
    },
  };

  it("flat-shape predicate filters $allInstances by library === 'movie' (no `find:` wrapper)", () => {
    const { options, totalMatched } = resolveOptions(liveSeedField, liveSeedCtx);
    // Only the two movie instances pass — books/tasks/containers excluded.
    expect(options.map(o => o.label).sort()).toEqual(["Dune", "Inception"]);
    expect(totalMatched).toBe(2);
  });

  it("instances missing the library field are excluded (resolveRecordPath returns null → IS fails)", () => {
    const { options } = resolveOptions(liveSeedField, liveSeedCtx);
    // task1 has no fields.libraryFid → null → "null" !== "movie" → excluded.
    expect(options.find(o => o.label === "Drink Water")).toBeUndefined();
  });

  it("$allInstances filter excludes container-role records even when they carry library=movie", () => {
    const { options } = resolveOptions(liveSeedField, liveSeedCtx);
    // cont1 IS movie-tagged but has role:"container" — buildCollection drops it.
    expect(options.find(o => o.label === "Library")).toBeUndefined();
  });

  it("occurrence-type field with NO optionsSource returns empty list (does NOT fall through to 'show all')", () => {
    // Catches a class of "lets me select anything" bugs where a missing
    // optionsSource accidentally fell through to the unscoped collection.
    const fieldMissingSource = { type: "occurrence", meta: { multiSelect: true } };
    const { options, totalMatched } = resolveOptions(fieldMissingSource, liveSeedCtx);
    expect(options).toEqual([]);
    expect(totalMatched).toBe(0);
  });

  it("find-mode with EMPTY predicate.rules matches ALL records in the collection (no rules = open pool)", () => {
    // This is the one path where an unscoped pool IS expected — if the
    // author truly wants every instance, they pass an empty rules array.
    // Tests pin that intent so future "tighten the default" refactors are
    // intentional, not accidental.
    const fieldOpen = {
      type: "occurrence",
      meta: {
        optionsSource: {
          mode: "find",
          over: "$allInstances",
          predicate: { conjunction: "AND", rules: [] },
          valuePath: "id",
          labelPath: "label",
        },
      },
    };
    const { options } = resolveOptions(fieldOpen, liveSeedCtx);
    // 4 instance-role records (movies + book + task). Container excluded.
    expect(options.map(o => o.label).sort()).toEqual(["Atomic Habits", "Drink Water", "Dune", "Inception"]);
  });

  it("predicate.conjunction is silently ignored (group reads `operator`, defaults to AND) — multi-rule still works", () => {
    const multiRule = {
      ...liveSeedField,
      meta: {
        ...liveSeedField.meta,
        optionsSource: {
          ...liveSeedField.meta.optionsSource,
          predicate: {
            conjunction: "AND",
            rules: [
              { left: "fields.libraryFid.value", comparator: "IS", right: "movie" },
              { left: "label",                   comparator: "IS", right: "Inception" },
            ],
          },
        },
      },
    };
    const { options } = resolveOptions(multiRule, liveSeedCtx);
    expect(options.map(o => o.label)).toEqual(["Inception"]);
  });
});

describe("resolveOptions — ancestor-scoped predicates (2026-07-07 regression)", () => {
  // The Account picker's seed predicate is
  //   `$record._ancestors HAS_ANCESTOR <library accounts container>`.
  // Two independent bugs made every ancestor-scoped optionsSource resolve to
  // ZERO options: (1) resolveRecordPath didn't strip the `$record.` prefix,
  // (2) buildCollection never enriched records with `_ancestors` at all.
  const ctx = {
    occurrencesById: {
      lib: { id: "lib", moduleId: "libMod", occurrences: ["acct1", "acct2"] },
      acct1: { id: "acct1", moduleId: "acctMod1", parentId: "lib" },
      acct2: { id: "acct2", moduleId: "acctMod2" }, // linked only via lib.occurrences[]
      other: { id: "other", moduleId: "otherMod" },
    },
    modulesById: {
      libMod: { id: "libMod", role: "container", label: "Accounts" },
      acctMod1: { id: "acctMod1", role: "instance", label: "Checking" },
      acctMod2: { id: "acctMod2", role: "instance", label: "Savings" },
      otherMod: { id: "otherMod", role: "instance", label: "Loose Task" },
    },
    fieldsById: {},
    foldersById: {},
  };
  const field = {
    type: "occurrence",
    meta: {
      optionsSource: {
        mode: "find",
        over: "$allInstances",
        predicate: {
          conjunction: "AND",
          rules: [{ left: "$record._ancestors", comparator: "HAS_ANCESTOR", right: "lib" }],
        },
        valuePath: "id",
        labelPath: "label",
      },
    },
  };

  it("resolves records under the ancestor — via parentId AND via parent occurrences[]", () => {
    const { options } = resolveOptions(field, ctx);
    expect(options.map(o => o.value).sort()).toEqual(["acct1", "acct2"]);
  });

  it("excludes records outside the ancestor", () => {
    const { options } = resolveOptions(field, ctx);
    expect(options.map(o => o.value)).not.toContain("other");
  });

  it("bare `_ancestors` path (no $record. prefix) matches identically", () => {
    const bare = JSON.parse(JSON.stringify(field));
    bare.meta.optionsSource.predicate.rules[0].left = "_ancestors";
    const { options } = resolveOptions(bare, ctx);
    expect(options.map(o => o.value).sort()).toEqual(["acct1", "acct2"]);
  });

  // ── Cache staleness (2026-08-07) ──────────────────────────────────────
  // buildCollection is memoised per `occurrencesById` OBJECT IDENTITY so a
  // render pass builds the parent map + enriched records once instead of once
  // per resolveOptions call. The failure mode that memoisation can introduce
  // is SILENT: a stale parent map makes `_ancestors` wrong, and a wrong
  // `_ancestors` makes every ancestor-scoped dropdown resolve to ZERO options
  // — the 2026-07-07 bug, which nobody notices for days.
  //
  // These cases are the guard. Each one moves the tree WITHOUT changing the
  // occurrence COUNT, so a cache keyed on a derived scalar (a length, a count
  // — exactly what FieldRenderer's `occSetKey` dep is) cannot pass them.
  describe("cache invalidation", () => {
    it("a NEW map object with a re-parented record re-resolves (count unchanged)", () => {
      const before = resolveOptions(field, ctx);
      expect(before.options.map(o => o.value).sort()).toEqual(["acct1", "acct2"]);

      // Same ids, same count — acct2 moves OUT of the ancestor, `other` moves IN.
      const moved = {
        ...ctx,
        occurrencesById: {
          lib: { id: "lib", moduleId: "libMod", occurrences: ["acct1", "other"] },
          acct1: { id: "acct1", moduleId: "acctMod1", parentId: "lib" },
          acct2: { id: "acct2", moduleId: "acctMod2" },
          other: { id: "other", moduleId: "otherMod" },
        },
      };
      expect(Object.keys(moved.occurrencesById).length)
        .toBe(Object.keys(ctx.occurrencesById).length);

      const after = resolveOptions(field, moved);
      expect(after.options.map(o => o.value).sort()).toEqual(["acct1", "other"]);
    });

    it("a NEW map object with an ADDED record under the ancestor re-resolves", () => {
      resolveOptions(field, ctx); // prime
      const grown = {
        ...ctx,
        occurrencesById: {
          ...ctx.occurrencesById,
          lib: { id: "lib", moduleId: "libMod", occurrences: ["acct1", "acct2", "acct3"] },
          acct3: { id: "acct3", moduleId: "acctMod3", parentId: "lib" },
        },
        modulesById: {
          ...ctx.modulesById,
          acctMod3: { id: "acctMod3", role: "instance", label: "Brokerage" },
        },
      };
      const { options } = resolveOptions(field, grown);
      expect(options.map(o => o.value).sort()).toEqual(["acct1", "acct2", "acct3"]);
    });

    it("a renamed MODULE re-resolves even when the occurrence map is identical", () => {
      // Records carry the module's label, so the cache cannot key on the
      // occurrence map alone.
      resolveOptions(field, ctx); // prime
      const renamed = {
        ...ctx,
        modulesById: { ...ctx.modulesById, acctMod1: { id: "acctMod1", role: "instance", label: "Chequing" } },
      };
      const { options } = resolveOptions(field, renamed);
      expect(options.find(o => o.value === "acct1")?.label).toBe("Chequing");
    });

    it("repeated calls on the SAME maps stay correct (the cached path)", () => {
      const a = resolveOptions(field, ctx);
      const b = resolveOptions(field, ctx);
      const c = resolveOptions(field, ctx);
      for (const r of [a, b, c]) {
        expect(r.options.map(o => o.value).sort()).toEqual(["acct1", "acct2"]);
      }
    });

    it("role-filtered collections do not leak into each other", () => {
      const containersField = JSON.parse(JSON.stringify(field));
      containersField.meta.optionsSource.over = "$allContainers";
      containersField.meta.optionsSource.predicate.rules = [];
      const instancesField = JSON.parse(JSON.stringify(field));
      instancesField.meta.optionsSource.predicate.rules = [];

      const containers = resolveOptions(containersField, ctx);
      const instances = resolveOptions(instancesField, ctx);
      expect(containers.options.map(o => o.value)).toEqual(["lib"]);
      expect(instances.options.map(o => o.value).sort()).toEqual(["acct1", "acct2", "other"]);
      // …and again, from the cache, in the other order.
      expect(resolveOptions(instancesField, ctx).options.map(o => o.value).sort())
        .toEqual(["acct1", "acct2", "other"]);
      expect(resolveOptions(containersField, ctx).options.map(o => o.value)).toEqual(["lib"]);
    });
  });
});
