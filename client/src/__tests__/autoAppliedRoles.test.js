import { describe, it, expect } from "vitest";
import { resolveOccurrenceFields } from "../helpers/autoAppliedFields";
import { getAutoAppliedRoles } from "../state/selectors";

const fieldsById = { f1: { id: "f1", name: "Tags" }, f2: { id: "f2", name: "Date" } };
const call = (role, roles) => resolveOccurrenceFields({
  module: { id: "m", role, fieldBindings: [] },
  fieldsById, fieldVisibility: null,
  autoAppliedFieldIds: ["f1", "f2"], autoAppliedRoles: roles,
}).map(x => x.field.name);

describe("auto-applied fields are role-scoped", () => {
  it("an ABSENT list behaves exactly as before — every role gets them", () => {
    // The property that makes this safe to ship on every surface.
    for (const r of ["page", "container", "instance", "textblock"]) {
      expect(call(r, null)).toEqual(["Tags", "Date"]);
    }
  });

  it("a page header renders NONE once roles are scoped to rows", () => {
    expect(call("page", ["instance", "textblock"])).toEqual([]);
    expect(call("container", ["instance", "textblock"])).toEqual([]);
  });

  it("but the ROW still renders them — the whole point of the scope", () => {
    // Hiding on the page must not silence the instances beneath it, which is
    // exactly what writing [] onto the page's cascade would have done.
    expect(call("instance", ["instance", "textblock"])).toEqual(["Tags", "Date"]);
    expect(call("textblock", ["instance", "textblock"])).toEqual(["Tags", "Date"]);
  });

  it("never touches a module's OWN bindings — only the applied list", () => {
    const out = resolveOccurrenceFields({
      module: { id: "m", role: "page", fieldBindings: [{ fieldId: "f2" }] },
      fieldsById, fieldVisibility: null,
      autoAppliedFieldIds: ["f1"], autoAppliedRoles: ["instance"],
    }).map(x => x.field.name);
    expect(out).toEqual(["Date"]);   // its own binding survives; Tags does not
  });

  it("an empty role list means no surface gets them", () => {
    expect(call("instance", [])).toEqual([]);
  });
});

describe("getAutoAppliedRoles", () => {
  it("null when unset, so nothing changes on a grid that never set it", () => {
    expect(getAutoAppliedRoles(undefined)).toBeNull();
    expect(getAutoAppliedRoles({ meta: {} })).toBeNull();
    expect(getAutoAppliedRoles({ meta: { autoAppliedRoles: "nope" } })).toBeNull();
  });
  it("reads and cleans the list", () => {
    expect(getAutoAppliedRoles({ meta: { autoAppliedRoles: ["instance", "", null, "textblock"] } }))
      .toEqual(["instance", "textblock"]);
  });
});
