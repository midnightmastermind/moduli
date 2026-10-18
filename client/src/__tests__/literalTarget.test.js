import { describe, it, expect } from "vitest";
import { literalTarget } from "../helpers/literalTarget.js";

const maps = {
  occurrencesById: { "3fda27ed-07bc": { id: "3fda27ed-07bc", moduleId: "m1" } },
  modulesById: { m1: { id: "m1", label: "Appointments" }, "mod-abc123": { id: "mod-abc123", label: "Pay Bill" } },
  fieldsById: { "fld-xyz789": { id: "fld-xyz789", name: "Due" } },
  foldersById: { "fold-12345": { id: "fold-12345", name: "Documents" } },
};

describe("literalTarget names the thing an id points at", () => {
  it("reads a literal: occurrence id as its row name", () => {
    expect(literalTarget("literal:3fda27ed-07bc", maps)).toEqual({ kind: "occurrence", label: "Appointments" });
  });
  it("reads a bare module, field and folder id", () => {
    expect(literalTarget("mod-abc123", maps)?.label).toBe("Pay Bill");
    expect(literalTarget("fld-xyz789", maps)?.label).toBe("Due");
    expect(literalTarget("fold-12345", maps)?.label).toBe("Documents");
  });
  it("says nothing for ordinary values and expressions", () => {
    expect(literalTarget("literal:Appointment", maps)).toBeNull();
    expect(literalTarget("$share.props.url", maps)).toBeNull();
    expect(literalTarget("true", maps)).toBeNull();
    expect(literalTarget(42, maps)).toBeNull();
  });
});
