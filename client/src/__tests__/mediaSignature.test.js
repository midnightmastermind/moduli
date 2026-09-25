import { describe, it, expect } from "vitest";
import { mediaSignature } from "../helpers/occurrenceMedia";

const person = { id: "p", moduleId: "pm", fields: { pic: { value: "a", flow: "in" } } };
const modulesById = { pm: { id: "pm", fieldBindings: [{ fieldId: "pic", role: "media" }] } };
const artMod = { am: { id: "am", role: "artifact", kind: "image", fileRef: "user/2026-09/x.jpg" } };

describe("mediaSignature", () => {
  it("CHANGES when a deferred artifact arrives after the row rendered", () => {
    const before = mediaSignature(person, { occurrencesById: { p: person }, modulesById });
    const after = mediaSignature(person, {
      occurrencesById: { p: person, a: { id: "a", moduleId: "am" } },
      modulesById: { ...modulesById, ...artMod },
    });
    expect(before).toBe("");
    expect(after).toBe("image|/uploads/user/2026-09/x.jpg");
  });
  it("is null for a row binding no media or files (it never subscribes to anything)", () => {
    expect(mediaSignature({ id: "r", moduleId: "rm" }, { occurrencesById: {}, modulesById: { rm: { id: "rm", fieldBindings: [] } } })).toBeNull();
  });
  it("is stable when unrelated rows change (primitive, same value)", () => {
    const ctx = { occurrencesById: { p: person, a: { id: "a", moduleId: "am" } }, modulesById: { ...modulesById, ...artMod } };
    expect(mediaSignature(person, ctx)).toBe(mediaSignature(person, { ...ctx, occurrencesById: { ...ctx.occurrencesById, z: { id: "z" } } }));
  });
});
