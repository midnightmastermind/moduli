// __tests__/tableColumnProjection.test.js
//
// A table whose rows are child occurrences shows the SAME record in every
// column — each column is a projection. An unconfigured column projects
// nothing, so it renders the whole record, and two of them look identical:
// the table reads as if it duplicated the row (claude-grid, 2026-08-18).
import { describe, it, expect } from "vitest";
import { nextProjectionFieldId } from "../helpers/tableCells";

const rowModule = (fieldBindings) => ({ id: "m-row", fieldBindings });
const rows = [{ id: "o1", moduleId: "m-row" }];

describe("nextProjectionFieldId", () => {
  it("picks the first bound field when nothing is projected yet", () => {
    const modulesById = { "m-row": rowModule([{ fieldId: "f-date" }, { fieldId: "f-minutes" }]) };
    expect(nextProjectionFieldId({ columns: [{ id: "c1" }], rows, modulesById })).toBe("f-date");
  });

  it("skips a field another column already shows", () => {
    const modulesById = { "m-row": rowModule([{ fieldId: "f-date" }, { fieldId: "f-minutes" }]) };
    const columns = [
      { id: "c1" },
      { id: "c2", fieldVisibility: { mode: "show", fieldIds: ["f-date"] } },
    ];
    expect(nextProjectionFieldId({ columns, rows, modulesById })).toBe("f-minutes");
  });

  it("also treats a column's displayFieldId as taken", () => {
    const modulesById = { "m-row": rowModule([{ fieldId: "f-date" }, { fieldId: "f-minutes" }]) };
    const columns = [{ id: "c1", displayFieldId: "f-date" }];
    expect(nextProjectionFieldId({ columns, rows, modulesById })).toBe("f-minutes");
  });

  it("skips a HIDDEN binding — a column showing nothing is worse than one repeating the row", () => {
    const modulesById = { "m-row": rowModule([{ fieldId: "f-secret", hidden: true }, { fieldId: "f-minutes" }]) };
    expect(nextProjectionFieldId({ columns: [], rows, modulesById })).toBe("f-minutes");
  });

  it("returns null with no rows to derive from, so the caller leaves it unprojected", () => {
    expect(nextProjectionFieldId({ columns: [{ id: "c1" }], rows: [], modulesById: {} })).toBeNull();
  });

  it("returns null once every bound field is spoken for", () => {
    const modulesById = { "m-row": rowModule([{ fieldId: "f-date" }]) };
    const columns = [{ id: "c1", fieldVisibility: { mode: "show", fieldIds: ["f-date"] } }];
    expect(nextProjectionFieldId({ columns, rows, modulesById })).toBeNull();
  });

  it("ignores a hide-mode column's list — hiding a field is not showing it", () => {
    const modulesById = { "m-row": rowModule([{ fieldId: "f-date" }]) };
    const columns = [{ id: "c1", fieldVisibility: { mode: "hide", fieldIds: ["f-date"] } }];
    expect(nextProjectionFieldId({ columns, rows, modulesById })).toBe("f-date");
  });
});
