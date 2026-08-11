import { describe, it, expect } from "vitest";
import { containersShowingFields, mergeHiddenFieldIds, resolveFieldByName }
  from "../migrations/0067-hide-container-fields-and-routines-noise.mjs";

describe("0067 containersShowingFields", () => {
  it("hides a visible binding and leaves its other keys intact", () => {
    const mods = [{ id: "m1", role: "container", label: "12:00am",
      fieldBindings: [{ fieldId: "f-ts", role: "input", order: 2 }] }];
    const [t] = containersShowingFields(mods);
    expect(t.nextBindings).toEqual([{ fieldId: "f-ts", role: "input", order: 2, hidden: true }]);
  });

  it("NEVER touches the VALUE — only the binding is returned", () => {
    // A slot's Time Slot value is its identity marker; ops FIND slots by it.
    const mods = [{ id: "m1", role: "container", fieldBindings: [{ fieldId: "f-ts" }] }];
    const [t] = containersShowingFields(mods);
    expect(Object.keys(t)).toEqual(["module", "nextBindings", "revealed"]);
  });

  it("skips a container that is already quiet, so a re-run is a no-op", () => {
    const mods = [{ id: "m1", role: "container", fieldBindings: [{ fieldId: "f-ts", hidden: true }] }];
    expect(containersShowingFields(mods)).toEqual([]);
  });

  it("REFUSES a non-container — an instance must keep showing its fields", () => {
    // The discriminating case: this is the whole point of the role gate.
    const mods = [{ id: "m1", role: "instance", fieldBindings: [{ fieldId: "f-ts" }] }];
    expect(containersShowingFields(mods)).toEqual([]);
  });

  it("hides EVERY visible binding on a container, not just the first", () => {
    const mods = [{ id: "m1", role: "container",
      fieldBindings: [{ fieldId: "a" }, { fieldId: "b" }, { fieldId: "c", hidden: true }] }];
    const [t] = containersShowingFields(mods);
    expect(t.nextBindings.every((b) => b.hidden)).toBe(true);
    expect(t.revealed).toEqual(["a", "b"]);
  });

  it("tolerates a container with no bindings", () => {
    expect(containersShowingFields([{ id: "m1", role: "container" }])).toEqual([]);
  });
});

describe("0067 mergeHiddenFieldIds", () => {
  it("creates a hide rule when there is none", () => {
    expect(mergeHiddenFieldIds(null, ["ts", "ls"])).toEqual({ mode: "hide", fieldIds: ["ts", "ls"] });
  });
  it("MERGES into an existing hide rule instead of replacing it", () => {
    expect(mergeHiddenFieldIds({ mode: "hide", fieldIds: ["date"] }, ["ts"]))
      .toEqual({ mode: "hide", fieldIds: ["date", "ts"] });
  });
  it("returns null when everything is already hidden — the re-run guard", () => {
    expect(mergeHiddenFieldIds({ mode: "hide", fieldIds: ["ts", "ls"] }, ["ts", "ls"])).toBeNull();
  });
  it("REFUSES a show-mode rule rather than mixing two meanings", () => {
    // show is a deliberate whitelist; bolting hide ids onto it means both at once.
    expect(mergeHiddenFieldIds({ mode: "show", fieldIds: ["tags"] }, ["ts"])).toBeNull();
  });
  it("returns null when asked to add nothing", () => {
    expect(mergeHiddenFieldIds(null, [])).toBeNull();
  });
});

describe("0067 resolveFieldByName", () => {
  const fields = [{ id: "a", name: "Time Slot" }, { id: "b", name: "Last Seen" }];
  it("finds by name, case-insensitively", () => {
    expect(resolveFieldByName(fields, "time slot").id).toBe("a");
  });
  it("returns null for an absent name so the caller fails closed", () => {
    expect(resolveFieldByName(fields, "Nope")).toBeNull();
  });
});
