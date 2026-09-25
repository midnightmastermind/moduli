import { describe, it, expect } from "vitest";
import { planUnhide } from "../migrations/0353-instagram-profile-links.mjs";

const fid = "ig";
const mod = (id, hidden) => [id, { id, fieldBindings: [{ fieldId: "name" }, { fieldId: fid, hidden }] }];

describe("0353 planUnhide", () => {
  it("un-hides Instagram only on people who have a handle", () => {
    const modulesById = new Map([mod("a", true), mod("b", true), mod("c", true)]);
    const occurrences = [
      { moduleId: "a", fields: { [fid]: { value: "oreopandas_cx" } } },
      { moduleId: "b", fields: { [fid]: { value: "  " } } },
      { moduleId: "c", fields: {} },
    ];
    expect(planUnhide({ occurrences, modulesById, fieldId: fid })).toEqual(["a"]);
  });
  it("leaves an already-visible binding alone (idempotent)", () => {
    const modulesById = new Map([mod("a", false)]);
    const occurrences = [{ moduleId: "a", fields: { [fid]: { value: "x" } } }];
    expect(planUnhide({ occurrences, modulesById, fieldId: fid })).toEqual([]);
  });
  it("a bare @ is not a handle", () => {
    const modulesById = new Map([mod("a", true)]);
    expect(planUnhide({ occurrences: [{ moduleId: "a", fields: { [fid]: { value: "@" } } }], modulesById, fieldId: fid })).toEqual([]);
  });
});
