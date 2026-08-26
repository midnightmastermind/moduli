// Guards 0262, which repairs 0261's own defect. The target set MUST be derived
// the same way gridIntegrity derives it, or the migration "passes" while the
// error stays.
import { describe, it, expect } from "vitest";
import { planSignatures } from "../migrations/0262-sign-sunday-template.mjs";

const MODS = [
  { id: "m-c", role: "container", label: "slot" },
  { id: "m-page", role: "page", label: "Schedule Template" },
  { id: "m-inst", role: "instance", label: "Eat" },
];
const FOLDERS = [{ id: "tpl", name: "Templates", meta: { protected: true } },
                 { id: "plain", name: "Templates" }];              // not protected
const c = (id, label, sig) => ({ id, moduleId: "m-c", label, identitySignature: sig ?? null, occurrences: [] });
const plan = (occ, folders = FOLDERS) => planSignatures({ occurrences: occ, modules: MODS, folders });

function world({ folder = "tpl", extra = [] } = {}) {
  const signed = c("s1", "12:00am", "slot:12:00am");
  const unsigned = c("s2", "12:00am");
  const page = { id: "pg", moduleId: "m-page", parentId: folder, occurrences: ["t1", "t2"] };
  const t1 = { id: "t1", moduleId: "m-c", label: "Monday", identitySignature: "day-container", occurrences: ["s1"] };
  const t2 = { id: "t2", moduleId: "m-c", label: "Sunday", identitySignature: "day-container", occurrences: ["s2"] };
  return [page, t1, t2, signed, unsigned, ...extra];
}

describe("0262 — signing unsigned template containers", () => {
  it("finds the unsigned container and copies a same-named sibling's signature", () => {
    const p = plan(world());
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].id).toBe("s2");
    expect(p.targets[0].sig).toBe("slot:12:00am");
    expect(p.targets[0].copied).toBe(true);
  });

  it("only walks templates under the PROTECTED Templates folder", () => {
    // gridIntegrity keys on `meta.protected`; an ordinary folder of the same
    // name is not a template location.
    const p = plan(world({ folder: "plain" }));
    expect(p.refusals.join(" ")).toMatch(/no template root/);
  });

  it("ignores INSTANCES — only structure duplicates on a merge", () => {
    const inst = { id: "i1", moduleId: "m-inst", occurrences: [], identitySignature: null };
    const w = world();
    w.find((o) => o.id === "t2").occurrences.push("i1");
    const p = plan([...w, inst]);
    expect(p.targets.map((t) => t.id)).toEqual(["s2"]);   // the instance is not a target
  });

  it("exempts the direct children of a PAGE root — matched by target, not signature", () => {
    // The page's own children are the apply roots; gridIntegrity exempts them.
    const page = { id: "pg", moduleId: "m-page", parentId: "tpl", occurrences: ["u1"] };
    const u1 = c("u1", "Sunday");                        // unsigned, but a direct child of the page
    const p = plan([page, u1]);
    expect(p.targets ?? []).toEqual([]);
  });

  it("is a clean no-op when everything is already signed", () => {
    const page = { id: "pg", moduleId: "m-page", parentId: "tpl", occurrences: ["t1"] };
    const t1 = { id: "t1", moduleId: "m-c", identitySignature: "day-container", occurrences: ["s1"] };
    const p = plan([page, t1, c("s1", "12:00am", "slot:12:00am")]);
    expect(p.targets).toEqual([]);
  });
});
