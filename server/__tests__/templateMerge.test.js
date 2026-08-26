// Guards 0263. It DELETES folders and a manifest, so each test answers "could
// this remove the folder templates actually live in?"
import { describe, it, expect } from "vitest";
import { planTemplateMerge } from "../migrations/0263-merge-templates-folders.mjs";

const F = (id, name, extra = {}) => ({ id, name, parentId: null, ...extra });
const real = F("keep", "Templates", { meta: { protected: true } });
const stray = F("stray", "Templates");
const inner = F("inner", "Templates", { parentId: "library" });
const plan = (folders, occurrences = [], manifests = []) => planTemplateMerge({ folders, occurrences, manifests });

describe("0263 — one Templates folder", () => {
  it("keeps the PROTECTED one and removes the empty strays", () => {
    const p = plan([real, stray, inner]);
    expect(p.keep.id).toBe("keep");
    expect(p.remove.map((r) => r.id).sort()).toEqual(["inner", "stray"]);
    expect(p.refusals).toEqual([]);
  });

  it("REFUSES to delete a folder that holds an occurrence", () => {
    const p = plan([real, stray], [{ id: "o1", parentId: "stray" }]);
    expect(p.remove).toEqual([]);
    expect(p.refusals.join(" ")).toMatch(/holds 1 occurrence/);
  });

  it("REFUSES to delete a folder that holds a sub-folder", () => {
    const p = plan([real, stray, F("kid", "Sub", { parentId: "stray" })]);
    expect(p.remove.map((r) => r.id)).toEqual([]);
    expect(p.refusals.join(" ")).toMatch(/holds 1 sub-folder/);
  });

  it("REFUSES to delete the USER manifest's root, whatever it is called", () => {
    const p = plan([real, stray], [], [{ id: "m", manifestType: "user", rootFolderId: "stray" }]);
    expect(p.remove).toEqual([]);
    expect(p.refusals.join(" ")).toMatch(/user manifest's root/);
  });

  it("REFUSES entirely when the protected one is ambiguous — never guesses which to keep", () => {
    const p = plan([real, { ...stray, meta: { protected: true } }]);
    expect(p.refusals.join(" ")).toMatch(/exactly one PROTECTED/);
    expect(p.remove).toEqual([]);
  });

  it("takes the retired templates manifest with its root folder, and no other manifest", () => {
    const p = plan([real, stray], [], [
      { id: "t", manifestType: "templates", rootFolderId: "stray" },
      { id: "u", manifestType: "user", rootFolderId: "other" },
      { id: "t2", manifestType: "templates", rootFolderId: "keep" },   // points at the KEEPER
    ]);
    expect(p.manifestIds).toEqual(["t"]);
  });

  it("is a clean no-op when there is only one Templates folder", () => {
    const p = plan([real]);
    expect(p.remove).toEqual([]);
    expect(p.refusals).toEqual([]);
  });
});
