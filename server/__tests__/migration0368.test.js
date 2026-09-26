import { describe, it, expect } from "vitest";
import { planRename } from "../migrations/0368-people-handles-to-names.mjs";
const names = { alissabratz: "Alissa Bratz" };
describe("0368 planRename", () => {
  it("renames a card whose label and Name are the handle", () => {
    expect(planRename({ label: "alissabratz", name: "alissabratz" }, names)).toEqual({ label: "Alissa Bratz", name: "Alissa Bratz" });
  });
  it("a real label is kept; only the handle-valued Name changes", () => {
    expect(planRename({ label: "Alissa B.", name: "alissabratz" }, names)).toEqual({ label: null, name: "Alissa Bratz" });
  });
  it("an unlisted handle is left alone", () => {
    expect(planRename({ label: "switch.babysitter", name: "" }, names)).toBeNull();
  });
});
