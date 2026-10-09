import { describe, it, expect } from "vitest";
import { findMarker } from "../migrations/0393-trackers-grid-state-and-media-board.mjs";
const page = { id: "p", occurrences: ["stats"] };
const modulesById = { mm: { fieldBindings: [{ fieldId: "lo" }] }, ms: { fieldBindings: [] } };
describe("0393 findMarker", () => {
  it("picks the page's unlisted occurrence that binds Last Opened Date", () => {
    const occs = [page, { id: "stats", parentId: "p", moduleId: "ms" }, { id: "mk", parentId: "p", moduleId: "mm" }];
    expect(findMarker({ page, occurrences: occs, modulesById, lastOpenedFieldId: "lo" }).map((o) => o.id)).toEqual(["mk"]);
  });
  it("ignores a marker something already lists (control)", () => {
    const occs = [{ ...page, occurrences: ["mk"] }, { id: "mk", parentId: "p", moduleId: "mm" }];
    expect(findMarker({ page: occs[0], occurrences: occs, modulesById, lastOpenedFieldId: "lo" })).toEqual([]);
  });
});
