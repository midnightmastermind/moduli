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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeAddNewTargets,
  targetOptionsForAddNew,
  buildStampFields,
  createOptionUnderParent,
  promptEntryFields,
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
    expect(asked.length).toBe(1);
    expect(asked[0].inputType).toBe("select"); // occurrence field → select of resolved options
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
