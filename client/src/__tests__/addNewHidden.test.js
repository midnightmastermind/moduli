// An option added from a picker is born hidden ONLY where the picker says so.
//
// User, 2026-09-06: *"i dont want these empty rows"* — and 0313 took the four
// account rows off the Financial group. "+ Add new" on the account pickers still
// minted a VISIBLE row, so creating an account put back exactly what was
// removed. `addNew.hidden` is the declaration; this asserts it REACHES the
// create call, and — the half that matters — that no other picker inherits it.
//
// It asserts on what LEAVES the helper rather than on the grid afterwards,
// because a flag that is read but never forwarded looks identical to a flag
// that works until you go looking for the row.
import { describe, it, expect, vi, beforeEach } from "vitest";

const created = [];
vi.mock("../helpers/CommitHelpers", () => ({
  setOccurrenceFieldValue: () => {},
  updateOccurrence: () => {},
  createLeafInstanceInParent: (args) => { created.push(args); return { moduleId: "m", occurrenceId: "o" }; },
  ensureModuleBindingsForOccurrenceFields: () => {},
}));

const { createOptionUnderParent } = await import("../helpers/addNewOption");

const parent = { id: "parent1", moduleId: "pm", fields: {} };
const picker = (addNew) => ({
  id: "f_acct", name: "Account", type: "occurrence",
  meta: { optionsSource: { mode: "find", over: "$allInstances",
    predicate: { operator: "AND", rules: [] }, addNew } },
});
const add = (field) => createOptionUnderParent({
  field, parentOcc: parent, label: "Credit Card",
  dispatch: () => {}, socket: {}, gridId: "g", userId: "u",
});

beforeEach(() => { created.length = 0; });

describe("addNew.hidden", () => {
  it("mints a hidden option when the picker declares it", () => {
    add(picker({ parentOccurrenceId: "parent1", hidden: true }));
    expect(created, "nothing was created").toHaveLength(1);
    expect(created[0].hidden, "the new account was born visible").toBe(true);
  });

  // THE CONTROL. Without it, "accounts are born hidden" is also satisfied by a
  // helper that hides EVERY option — which would silently make new ingredients,
  // movements and meals invisible on the boards they were added to.
  it("mints a visible option when the picker does not", () => {
    add(picker({ parentOccurrenceId: "parent1" }));
    expect(created).toHaveLength(1);
    expect(created[0].hidden, "an ordinary option was hidden").toBeFalsy();
  });

  it("treats anything but true as visible", () => {
    for (const v of ["true", 1, {}]) {
      created.length = 0;
      add(picker({ parentOccurrenceId: "parent1", hidden: v }));
      expect(created[0].hidden, `hidden: ${JSON.stringify(v)} hid the option`).toBe(false);
    }
  });
});

describe("the live account pickers declare it", () => {
  it("both account pickers mint identities, and no other picker does", async () => {
    const { readFileSync } = await import("node:fs");
    const { brotliDecompressSync } = await import("node:zlib");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fx = JSON.parse(brotliDecompressSync(
      readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());

    const withAddNew = fx.fields.filter((f) => f.meta?.optionsSource?.addNew);
    const hidden = withAddNew.filter((f) => f.meta.optionsSource.addNew.hidden === true).map((f) => f.name);
    expect(hidden.sort()).toEqual(["Account", "To Account"]);
    // The control: there ARE other add-new pickers, so "only these two" is a
    // measurement rather than a statement about an empty set.
    expect(withAddNew.length).toBeGreaterThan(10);
  });
});
