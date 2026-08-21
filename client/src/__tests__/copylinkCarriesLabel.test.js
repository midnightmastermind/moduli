// A copy-link carries the SOURCE'S OCCURRENCE LABEL.
//
// FOUND ON LIVE DATA, in the Completed feed. A row is named
// `occurrence.label ?? module.label`, and `copylinkInstanceToContainer` copied
// `fields` but never `label` — so a row whose name lives on the OCCURRENCE was
// silently renamed to its module's generic name in every copy.
//
// On poms grid that is not cosmetic: every appointment shares the module
// "Appointment" and carries its real name on the occurrence, so the Completed
// container listed
//
//     copy.label = null   module.label = "Appointment"
//     SOURCE      = "Psych appointment with Angela"
//
// i.e. a Completed list where two different appointments both read "Appointment".
// The other two completed rows looked fine BY ACCIDENT — their names happen to
// live on the module, which is why this survived: it is invisible on every row
// that has no occurrence-level name.
import { describe, it, expect, vi, beforeEach } from "vitest";

const created = [];
// LayoutHelpers does `import * as CommitHelpers`, so the mock has to expose
// NAMED exports — a `default` object is invisible to a namespace import.
vi.mock("../helpers/CommitHelpers", () => ({
  createOccurrence: (args) => { created.push(args.occurrence); },
  createModule: () => {},
  updateOccurrence: () => {},
  removeOccurrence: () => {},
  updateModule: () => {},
}));

const LayoutHelpers = await import("../helpers/LayoutHelpers");

const baseArgs = (sourceOccurrence) => ({
  dispatch: () => {},
  socket: null,
  gridId: "g1",
  userId: "u1",
  sourceInstanceId: "mod-appointment",
  sourceOccurrenceId: sourceOccurrence.id,
  sourceOccurrence,
  toContainer: { id: "mod-completed", _occurrence: { id: "occ-completed", occurrences: [] } },
  emit: false,
  initialMeta: { feedSourceId: sourceOccurrence.id },
  dragMode: "copy",
  fireTrigger: false,
});

describe("copylinkInstanceToContainer carries the occurrence label", () => {
  beforeEach(() => { created.length = 0; });

  it("copies a source's occurrence-level label onto the new copy", () => {
    LayoutHelpers.copylinkInstanceToContainer(baseArgs({
      id: "src-1",
      label: "Psych appointment with Angela",
      moduleId: "mod-appointment",
      fields: { f1: { value: true } },
    }));
    expect(created).toHaveLength(1);
    // Without the fix this is `undefined` and the row renders as the module's
    // name ("Appointment") — the live defect.
    expect(created[0].label).toBe("Psych appointment with Angela");
  });

  it("leaves label UNSET when the source has none, so the module name still wins", () => {
    // The discriminating half: writing `label: null` would be just as wrong in
    // the other direction if any renderer ever preferred an explicit null, and
    // an empty string would blank the row outright.
    LayoutHelpers.copylinkInstanceToContainer(baseArgs({
      id: "src-2", label: null, moduleId: "mod-appointment", fields: {},
    }));
    expect(created).toHaveLength(1);
    expect("label" in created[0]).toBe(false);
  });

  it("treats an empty-string label as no label", () => {
    LayoutHelpers.copylinkInstanceToContainer(baseArgs({
      id: "src-3", label: "", moduleId: "mod-appointment", fields: {},
    }));
    expect("label" in created[0]).toBe(false);
  });

  it("still copies the source's field values", () => {
    // A control: if the mock or the call shape were wrong, the label assertions
    // above would pass vacuously against an occurrence that carries nothing.
    LayoutHelpers.copylinkInstanceToContainer(baseArgs({
      id: "src-4", label: "Named", moduleId: "mod-appointment",
      fields: { done: { value: true, flow: "in" } },
    }));
    expect(created[0].fields).toEqual({ done: { value: true, flow: "in" } });
    expect(created[0].meta).toEqual({ feedSourceId: "src-4" });
  });
});
