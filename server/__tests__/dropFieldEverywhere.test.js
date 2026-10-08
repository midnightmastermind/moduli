// Deleting a field drops its bindings and values (Mongo + warm cache).
import { describe, it, expect, vi } from "vitest";
import { dropFieldEverywhere } from "../utils/dropFieldEverywhere.js";

describe("dropFieldEverywhere", () => {
  it("pulls the binding and unsets the value in Mongo, scoped to the user", async () => {
    const Module = { updateMany: vi.fn(async () => ({ modifiedCount: 2 })) };
    const Occurrence = { updateMany: vi.fn(async () => ({ modifiedCount: 3 })) };
    const r = await dropFieldEverywhere({ uc: {}, userId: "u", fieldId: "f1", Module, Occurrence });
    expect(Module.updateMany).toHaveBeenCalledWith({ userId: "u", "fieldBindings.fieldId": "f1" }, { $pull: { fieldBindings: { fieldId: "f1" } } });
    expect(Occurrence.updateMany).toHaveBeenCalledWith({ userId: "u", "fields.f1": { $exists: true } }, { $unset: { "fields.f1": "" } });
    expect(r).toEqual({ modules: 2, occurrences: 3 });
  });
  it("clears the warm cache too, and leaves other fields alone", async () => {
    const uc = {
      modulesById: { m: { fieldBindings: [{ fieldId: "f1" }, { fieldId: "f2" }] } },
      occurrencesById: { o: { fields: { f1: { value: 1 }, f2: { value: 2 } } }, p: { fields: { f2: { value: 3 } } } },
    };
    const noop = { updateMany: async () => ({}) };
    await dropFieldEverywhere({ uc, userId: "u", fieldId: "f1", Module: noop, Occurrence: noop });
    expect(uc.modulesById.m.fieldBindings).toEqual([{ fieldId: "f2" }]);
    expect(uc.occurrencesById.o.fields).toEqual({ f2: { value: 2 } });
    expect(uc.occurrencesById.p.fields).toEqual({ f2: { value: 3 } });
  });
  it("the delete_field handler calls it", async () => {
    const src = (await import("fs")).readFileSync(new URL("../socketHandlers/crud.js", import.meta.url), "utf8");
    const i = src.indexOf('socket.on("delete_field"'); expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 900)).toMatch(/dropFieldEverywhere\(/);
  });
});
