// transactionScope.test.js — readable gesture lines + the dropdown's page scope.
import { describe, it, expect } from "vitest";
import { touchesScope, openPageScopes } from "../helpers/transactionScope";

describe("touchesScope — the notification dropdown's page filter", () => {
  const occurrencesById = {
    page: { id: "page", occurrences: ["cont"] },
    cont: { id: "cont", occurrences: ["row"] },
    row: { id: "row", parentId: "cont" },
    other: { id: "other" },
  };
  it("a gesture that touched a row under the page belongs to it", () => {
    expect(touchesScope(["row"], "page", occurrencesById)).toBe(true);
  });
  it("a gesture elsewhere does not", () => {
    expect(touchesScope(["other"], "page", occurrencesById)).toBe(false);
  });
  it("no scope keeps everything; no touched ids under a scope keeps nothing", () => {
    expect(touchesScope([], null, occurrencesById)).toBe(true);
    expect(touchesScope([], "page", occurrencesById)).toBe(false);
  });
  it("openPageScopes lists each page a panel shows, once", () => {
    const pages = openPageScopes({
      views: [{ activeOccurrenceId: "page" }, { activeOccurrenceId: "page" }, { activeOccurrenceId: "gone" }],
      occurrencesById: { page: { id: "page", label: "Tasks" } },
    });
    expect(pages).toEqual([{ id: "page", label: "Tasks" }]);
  });
});

// AND THE ROWS THAT DID APPEAR ALL READ "Unknown operation".
//
// `getDescription` bails on a missing `operations[0]`, which is EVERY
// SnapshotOp — 200 of 242 on the rebuild grid, 200 of 1200 on poms. Each one
// carries the label its gesture opened with ("Created item", "Broke link",
// "Deactivated filter") and the docs it wrote, so there is nothing to guess.
import { describeSnapshotTransaction } from "../helpers/transactionScope";

const maps = {
  occurrencesById: { "occ-a": { id: "occ-a", moduleId: "m1" }, "occ-b": { id: "occ-b", moduleId: "m2" } },
  modulesById: { m1: { id: "m1", label: "Morning Walk" }, m2: { id: "m2", label: "Mind" } },
};

describe("describing a snapshot transaction", () => {
  it("uses the gesture's own label and names what it touched", () => {
    const tx = { description: "Created item", docs: [{ model: "occurrence", id: "occ-a" }] };
    expect(describeSnapshotTransaction(tx, maps)).toBe("Created item — Morning Walk");
  });

  it("names several, then counts the rest", () => {
    const tx = { description: "Pasted 3 items", docs: [
      { model: "occurrence", id: "occ-a" }, { model: "occurrence", id: "occ-b" }, { model: "occurrence", id: "occ-z" }] };
    expect(describeSnapshotTransaction(tx, maps)).toBe("Pasted 3 items — Morning Walk, Mind +1");
  });

  it("falls back to the label alone when nothing resolves", () => {
    const tx = { description: "Broke link", docs: [{ model: "occurrence", id: "gone" }] };
    expect(describeSnapshotTransaction(tx, maps)).toBe("Broke link");
  });

  it("counts the changes when there is no label at all", () => {
    expect(describeSnapshotTransaction({ docs: [{ id: "x" }, { id: "y" }] }, maps)).toBe("2 changes");
    expect(describeSnapshotTransaction({ docs: [{ id: "x" }] }, maps)).toBe("1 change");
  });

  // The control: with neither a label nor docs there is genuinely nothing to
  // say, and inventing something would be worse than admitting it.
  it("says unknown only when there is nothing to describe", () => {
    expect(describeSnapshotTransaction({}, maps)).toBe("Unknown operation");
  });
});
