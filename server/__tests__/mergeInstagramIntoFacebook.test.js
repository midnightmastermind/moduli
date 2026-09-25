import { describe, it, expect } from "vitest";
import { mergeFields } from "../migrations/0357-merge-instagram-into-facebook-people.mjs";

const f = { foundVia: "via", relationship: "rel", notes: "notes", instagram: "ig" };
const fb = { fields: { name: { value: "Autum Zinda" }, via: { value: ["facebook"], flow: "in" }, rel: { value: "friend", flow: "in" }, fbSince: { value: "2020-01-01" } } };
const ig = { fields: { name: { value: "autumzinda" }, ig: { value: "autumzinda", flow: "in" }, igSince: { value: "2024-02-02", flow: "in" },
  via: { value: ["instagram", "mutual", "unconfirmed"] }, rel: { value: "close friend" }, notes: { value: "Possibly the same person as Facebook friend Autum Zinda." } } };

describe("0357 mergeFields", () => {
  const set = mergeFields(fb, ig, f);
  it("brings the handle and Instagram date onto the Facebook person, never overwriting its name", () => {
    expect(set["fields.ig"].value).toBe("autumzinda");
    expect(set["fields.igSince"].value).toBe("2024-02-02");
    expect(set["fields.name"]).toBeUndefined();
  });
  it("unions Found Via without 'unconfirmed' and upgrades to close friend", () => {
    expect(set["fields.via"].value).toEqual(["facebook", "instagram", "mutual"]);
    expect(set["fields.rel"].value).toBe("close friend");
  });
  it("does not carry the 'possibly the same person' note", () => {
    expect(set["fields.notes"]).toBeUndefined();
  });
  it("is a no-op when already merged (control)", () => {
    const merged = { fields: { ...fb.fields, ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k.slice(7), v])) } };
    expect(mergeFields(merged, ig, f)).toEqual({});
  });
});
