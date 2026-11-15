// A container's BUTTON fields sit beside its header label; its other fields stay under it (user, 2026-11-15:
// "have the buttons go right next to the header labels"). OccurrenceFields filters by field type for that split.
import { describe, it, expect } from "vitest";
import { fieldsOfTypes } from "../ui/OccurrenceFields.jsx";

const items = [
  { field: { id: "b", type: "button" } },
  { field: { id: "t", type: "text" } },
  { field: { id: "d", type: "date" } },
];

describe("fieldsOfTypes", () => {
  it("only keeps the named types", () => {
    expect(fieldsOfTypes(items, { only: ["button"] }).map((i) => i.field.id)).toEqual(["b"]);
  });
  it("except drops them", () => {
    expect(fieldsOfTypes(items, { except: ["button"] }).map((i) => i.field.id)).toEqual(["t", "d"]);
  });
  it("no filter keeps everything", () => {
    expect(fieldsOfTypes(items, null)).toBe(items);
  });
});
