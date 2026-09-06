// addNewOption — the "+ Add new" flow on occurrence dropdowns (Task 3.5,
// nine-dimensions rebuild). Covers:
//   1. multi-target addNew surfaces every candidate, labeled by the LIVE
//      occurrence labels (never config strings)
//   2. creating under the chosen parent: parentId + occurrences[] splice +
//      the parent's own predicate-field values (boardCategory) stamped on
//      the new occurrence at run time
//   3. legacy single { parentOccurrenceId } shape → no chooser
//   4. one-element targets[] → no chooser
//   5. entry fields (addNew.fieldIds) are bound on the minted module and the
//      prompted values land on the created occurrence's fields
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeAddNewTargets,
  targetOptionsForAddNew,
  buildStampFields,
  createOptionUnderParent,
  promptEntryFields,
  candidateFieldsForOption,
} from "../helpers/addNewOption";
import { operationsBridge } from "../state/bindSocketToStore";

const BOARD_CAT = "field-board-category";
const ING_FIELD = "field-ingredient";

const groceryCont = {
  id: "occ-grocery", moduleId: "mod-grocery",
  fields: { [BOARD_CAT]: { value: "grocery", flow: "in" } },
  occurrences: ["occ-milk"],
};
const wishlistCont = {
  id: "occ-wishlist", moduleId: "mod-wishlist",
  label: "Wish List (renamed live)", // occurrence label override wins
  fields: { [BOARD_CAT]: { value: "wishlist", flow: "in" } },
  occurrences: [],
};
const occurrencesById = {
  [groceryCont.id]: groceryCont,
  [wishlistCont.id]: wishlistCont,
};
const modulesById = {
  "mod-grocery": { id: "mod-grocery", role: "container", label: "Grocery List" },
  "mod-wishlist": { id: "mod-wishlist", role: "container", label: "Wish List" },
};

const purchaseItemField = {
  id: "field-purchase-item",
  name: "Purchase Item",
  type: "occurrence",
  meta: {
    multiSelect: true,
    optionsSource: {
      mode: "find",
      over: "$allInstances",
      predicate: {
        operator: "AND",
        rules: [
          { operator: "OR", rules: [
            { left: `fields.${BOARD_CAT}.value`, comparator: "IS", right: "grocery" },
            { left: `fields.${BOARD_CAT}.value`, comparator: "IS", right: "wishlist" },
          ]},
          { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
        ],
      },
      valuePath: "id",
      labelPath: "label",
      addNew: { targets: [groceryCont.id, wishlistCont.id] },
    },
  },
};

describe("normalizeAddNewTargets", () => {
  it("targets[] passes through", () => {
    expect(normalizeAddNewTargets({ targets: ["a", "b"] })).toEqual(["a", "b"]);
  });
  it("legacy { parentOccurrenceId } becomes a one-element list (no chooser)", () => {
    expect(normalizeAddNewTargets({ parentOccurrenceId: "a" })).toEqual(["a"]);
  });
  it("one-element targets[] stays one element (no chooser)", () => {
    expect(normalizeAddNewTargets({ targets: ["a"] })).toEqual(["a"]);
  });
  it("empty/missing → []", () => {
    expect(normalizeAddNewTargets(null)).toEqual([]);
    expect(normalizeAddNewTargets({})).toEqual([]);
  });
});

describe("targetOptionsForAddNew", () => {
  it("labels every candidate from the live occurrence data, not config strings", () => {
    const opts = targetOptionsForAddNew(purchaseItemField.meta.optionsSource.addNew, { occurrencesById, modulesById });
    expect(opts.map(o => o.id)).toEqual([groceryCont.id, wishlistCont.id]);
    expect(opts[0].label).toBe("Grocery List");            // module label fallback
    expect(opts[1].label).toBe("Wish List (renamed live)"); // occurrence label override
  });
});

describe("buildStampFields", () => {
  it("copies the chosen parent's predicate-field values (the tag) at run time", () => {
    const stamp = buildStampFields(purchaseItemField, wishlistCont);
    expect(stamp[BOARD_CAT]?.value).toBe("wishlist");
  });
  it("legacy addNew.stampFields merge in (config stamps kept)", () => {
    const f = {
      ...purchaseItemField,
      meta: {
        ...purchaseItemField.meta,
        optionsSource: {
          ...purchaseItemField.meta.optionsSource,
          addNew: { targets: [groceryCont.id], stampFields: { "field-library": { value: "person", flow: "in" } } },
        },
      },
    };
    const stamp = buildStampFields(f, groceryCont);
    expect(stamp["field-library"]?.value).toBe("person");
    expect(stamp[BOARD_CAT]?.value).toBe("grocery");
  });
});

describe("createOptionUnderParent", () => {
  it("creates under the CHOSEN parent: parentId, occurrences[] splice, run-time tag stamp", () => {
    const dispatched = [];
    const dispatch = (a) => dispatched.push(a);
    const res = createOptionUnderParent({
      field: purchaseItemField,
      parentOcc: wishlistCont,
      label: "Record Player",
      dispatch, socket: null, gridId: "g1", userId: "u1",
    });
    expect(res?.occurrenceId).toBeTruthy();

    // The created occurrence: parented under the chosen occurrence + tagged
    // with ITS boardCategory value.
    const createdOcc = dispatched
      .map(a => a?.payload?.occurrence || a?.occurrence || a?.payload)
      .find(o => o?.id === res.occurrenceId && o?.parentId);
    expect(createdOcc?.parentId).toBe(wishlistCont.id);
    expect(createdOcc?.fields?.[BOARD_CAT]?.value).toBe("wishlist");

    // The chosen parent's occurrences[] gains the new id.
    const parentPatch = dispatched
      .map(a => a?.payload?.occurrence || a?.occurrence || a?.payload)
      .find(o => o?.id === wishlistCont.id && Array.isArray(o?.occurrences));
    expect(parentPatch?.occurrences).toContain(res.occurrenceId);
  });

  it("binds addNew.fieldIds as input bindings on the minted module and reports them for entry", () => {
    const f = {
      ...purchaseItemField,
      meta: {
        ...purchaseItemField.meta,
        optionsSource: {
          ...purchaseItemField.meta.optionsSource,
          addNew: { targets: [groceryCont.id], fieldIds: [ING_FIELD] },
        },
      },
    };
    const dispatched = [];
    const res = createOptionUnderParent({
      field: f, parentOcc: groceryCont, label: "Tortillas",
      dispatch: (a) => dispatched.push(a), socket: null, gridId: "g1", userId: "u1",
    });
    expect(res?.entryFieldIds).toEqual([ING_FIELD]);
    const createdMod = dispatched
      .map(a => a?.payload?.module || a?.module || a?.payload)
      .find(m => m?.id === res.moduleId);
    const bindings = createdMod?.fieldBindings || [];
    expect(bindings.some(b => b.fieldId === ING_FIELD && !b.hidden)).toBe(true);
    // Stamp field is bound HIDDEN so the tag never renders inline.
    expect(bindings.some(b => b.fieldId === BOARD_CAT && b.hidden)).toBe(true);
  });
});

describe("promptEntryFields", () => {
  let origRequest;
  beforeEach(() => { origRequest = operationsBridge.requestUserInput; });
  afterEach(() => { operationsBridge.requestUserInput = origRequest; });

  it("prompts per entry field via the EXISTING user-input modal and writes the values", async () => {
    const asked = [];
    operationsBridge.requestUserInput = (req) => { asked.push(req); return Promise.resolve("occ-milk"); };
    const dispatched = [];
    const createdOcc = { id: "occ-new", moduleId: "m", parentId: groceryCont.id, fields: {} };
    await promptEntryFields({
      entryFieldIds: [ING_FIELD],
      occurrenceId: createdOcc.id,
      fieldsById: { [ING_FIELD]: { id: ING_FIELD, name: "Ingredient", type: "occurrence", meta: { multiSelect: true, optionsSource: { mode: "manual", values: [] } } } },
      ctx: { occurrencesById: { ...occurrencesById, [createdOcc.id]: createdOcc }, modulesById, fieldsById: {} },
      dispatch: (a) => dispatched.push(a),
      socket: null,
    });
    // The DECLARED field is asked first; the second question is the
    // "add a field?" picker added 2026-09-06, whose default is "— done —".
    expect(asked[0].question).toBe("Ingredient");
    expect(asked[0].inputType).toBe("select"); // occurrence field → select of resolved options
    expect(asked[1]?.question).toBe("Add a field?");
    expect(asked[1]?.options?.[0]?.value).toBe("__done__");
    // The write landed on the created occurrence — multiSelect coerces to array.
    const write = dispatched
      .map(a => a?.payload?.occurrence || a?.occurrence || a?.payload)
      .find(o => o?.id === createdOcc.id && o?.fields?.[ING_FIELD]);
    expect(write?.fields?.[ING_FIELD]?.value).toEqual(["occ-milk"]);
  });

  it("cancel (rejection) stops the chain silently — the occurrence survives", async () => {
    operationsBridge.requestUserInput = () => Promise.reject(new Error("cancelled"));
    await expect(promptEntryFields({
      entryFieldIds: [ING_FIELD],
      occurrenceId: "occ-new",
      fieldsById: { [ING_FIELD]: { id: ING_FIELD, name: "Ingredient", type: "text", meta: {} } },
      ctx: { occurrencesById: {}, modulesById: {}, fieldsById: {} },
      dispatch: () => {}, socket: null,
    })).resolves.toBeUndefined();
  });
});

// ── Adding a field the config never declared ────────────────────────────────
// User, 2026-09-06: *"we should be able to add fields and values to those
// fields to the options we add in that option select dropdown just like quick
// adding occurances"*. `addNew.fieldIds` is PRE-DECLARED — it can fill a field
// but never introduce one.
describe("candidateFieldsForOption", () => {
  const F = {
    "f-cal": { id: "f-cal", name: "Calories", type: "number" },
    "f-price": { id: "f-price", name: "Price", type: "number" },
    "f-tag": { id: "f-tag", name: "Board Category", type: "select" },
    "f-note": { id: "f-note", name: "Notes", type: "text" },
  };
  const mods = {
    "m-milk":  { id: "m-milk",  fieldBindings: [{ fieldId: "f-cal" }, { fieldId: "f-price" }, { fieldId: "f-tag", hidden: true }] },
    "m-eggs":  { id: "m-eggs",  fieldBindings: [{ fieldId: "f-cal" }] },
    "m-new":   { id: "m-new",   fieldBindings: [] },
  };
  const occs = {
    "occ-milk": { id: "occ-milk", moduleId: "m-milk" },
    "occ-eggs": { id: "occ-eggs", moduleId: "m-eggs" },
    "occ-new":  { id: "occ-new",  moduleId: "m-new", fields: {} },
  };
  const parent = { id: "occ-parent", occurrences: ["occ-milk", "occ-eggs", "occ-new"] };

  it("offers what the SIBLINGS carry, commonest first", () => {
    const got = candidateFieldsForOption({
      parentOcc: parent, occurrenceId: "occ-new",
      occurrencesById: occs, modulesById: mods, fieldsById: F,
    });
    // Calories is on both siblings, Price on one — so Calories leads.
    expect(got.map((c) => c.label)).toEqual(["Calories", "Price"]);
  });

  it("never offers a HIDDEN binding — those are the dropdown's own identity tags", () => {
    const got = candidateFieldsForOption({
      parentOcc: parent, occurrenceId: "occ-new",
      occurrencesById: occs, modulesById: mods, fieldsById: F,
    });
    // `Board Category` is what buildStampFields writes to make the option
    // appear in the dropdown at all. Offering it invites breaking that.
    expect(got.map((c) => c.value)).not.toContain("f-tag");
  });

  it("never offers a field the option already has", () => {
    const withCal = { ...occs, "occ-new": { id: "occ-new", moduleId: "m-new", fields: { "f-cal": { value: 100 } } } };
    const got = candidateFieldsForOption({
      parentOcc: parent, occurrenceId: "occ-new",
      occurrencesById: withCal, modulesById: mods, fieldsById: F,
    });
    expect(got.map((c) => c.value)).toEqual(["f-price"]);
  });

  it("falls back to every input-capable field when the siblings carry nothing", () => {
    // CONTROL for the rule above: without a fallback the picker would appear
    // and offer nothing, which is worse than not appearing.
    const got = candidateFieldsForOption({
      parentOcc: { id: "p", occurrences: [] }, occurrenceId: "occ-new",
      occurrencesById: occs, modulesById: mods, fieldsById: F,
    });
    expect(got.length).toBe(4);
    expect(got[0].label).toBe("Board Category"); // alphabetical
  });
});

describe("promptEntryFields — adding a field by hand", () => {
  let origRequest;
  beforeEach(() => { origRequest = operationsBridge.requestUserInput; });
  afterEach(() => { operationsBridge.requestUserInput = origRequest; });

  const F = { "f-price": { id: "f-price", name: "Price", type: "number", meta: {} } };
  const mods = { "m-sib": { id: "m-sib", fieldBindings: [{ fieldId: "f-price" }] }, "m-new": { id: "m-new", fieldBindings: [] } };
  const occs = { "occ-sib": { id: "occ-sib", moduleId: "m-sib" }, "occ-new": { id: "occ-new", moduleId: "m-new", fields: {} } };
  const parent = { id: "occ-parent", occurrences: ["occ-sib", "occ-new"] };
  const run = (answers, dispatched = []) => {
    let i = 0;
    operationsBridge.requestUserInput = () => Promise.resolve(answers[i++]);
    return promptEntryFields({
      entryFieldIds: [], occurrenceId: "occ-new", parentOcc: parent,
      fieldsById: F, ctx: { occurrencesById: occs, modulesById: mods, fieldsById: F },
      dispatch: (a) => dispatched.push(a), socket: null,
    }).then(() => dispatched);
  };

  it("picking a field asks for its value and writes it", async () => {
    const out = await run(["f-price", 4.5, "__done__"]);
    const write = out.map((a) => a?.payload?.occurrence || a?.occurrence || a?.payload)
      .find((o) => o?.id === "occ-new" && o?.fields?.["f-price"]);
    expect(write?.fields?.["f-price"]?.value).toBe(4.5);
  });

  it("BINDS the field it added, not just writes it", async () => {
    // The `0047` half: a value with no binding on the module is stored and
    // renders NOWHERE, which looks exactly like the write having failed.
    // `ensureModuleBindingsForOccurrenceFields` reads the module through the
    // bridge, so the bridge has to be there for the binding to happen at all.
    const origMod = operationsBridge.getLocalMod;
    operationsBridge.getLocalMod = (id) => mods[id] || null;
    try {
      const out = await run(["f-price", 4.5, "__done__"]);
      const modUpdate = out.map((a) => a?.payload?.module || a?.module || a?.payload)
        .find((m) => m?.id === "m-new" && Array.isArray(m?.fieldBindings));
      expect(modUpdate, "no module update — the new field would render nowhere").toBeTruthy();
      expect(modUpdate.fieldBindings.map((b) => b.fieldId)).toContain("f-price");
    } finally { operationsBridge.getLocalMod = origMod; }
  });

  it("choosing '— done —' first writes nothing", async () => {
    // THE CONTROL. Adding is opt-in: the default answer must leave the option
    // exactly as it was, or every add-new grows a field nobody asked for.
    const out = await run(["__done__"]);
    const writes = out.map((a) => a?.payload?.occurrence || a?.occurrence || a?.payload)
      .filter((o) => o?.id === "occ-new" && o?.fields?.["f-price"]);
    expect(writes.length).toBe(0);
  });

  it("cancelling the picker leaves the option alone", async () => {
    operationsBridge.requestUserInput = () => Promise.reject(new Error("cancelled"));
    const dispatched = [];
    await expect(promptEntryFields({
      entryFieldIds: [], occurrenceId: "occ-new", parentOcc: parent,
      fieldsById: F, ctx: { occurrencesById: occs, modulesById: mods, fieldsById: F },
      dispatch: (a) => dispatched.push(a), socket: null,
    })).resolves.toBeUndefined();
    expect(dispatched.length).toBe(0);
  });

  it("asks nothing at all when there is nothing to declare and nothing to offer", async () => {
    let asked = 0;
    operationsBridge.requestUserInput = () => { asked++; return Promise.resolve("__done__"); };
    await promptEntryFields({
      entryFieldIds: [], occurrenceId: "occ-new", parentOcc: { id: "p", occurrences: [] },
      fieldsById: {}, ctx: { occurrencesById: occs, modulesById: mods, fieldsById: {} },
      dispatch: () => {}, socket: null,
    });
    expect(asked).toBe(0);
  });

  it("allowAddFields:false restores the old behaviour exactly", async () => {
    let asked = 0;
    operationsBridge.requestUserInput = () => { asked++; return Promise.resolve("__done__"); };
    await promptEntryFields({
      entryFieldIds: [], occurrenceId: "occ-new", parentOcc: parent, allowAddFields: false,
      fieldsById: F, ctx: { occurrencesById: occs, modulesById: mods, fieldsById: F },
      dispatch: () => {}, socket: null,
    });
    expect(asked).toBe(0);
  });
});
