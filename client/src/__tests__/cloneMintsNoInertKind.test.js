// __tests__/cloneMintsNoInertKind.test.js
// ============================================================
// Drives the REAL CREATE_ITEM applier in bindSocketToStore, because that is
// where the defect lived. The pure `kindForNewModule` rule has its own tests —
// and every one of them passed while the applier ignored the rule entirely and
// kept its own `|| "doc"`. A test that exercises the helper does not test the
// caller that was supposed to use it.
//
// Live evidence (poms grid, 2026-08-11): 232 modules role:"instance"
// kind:"doc", minted 2026-08-02..08-11, every one carrying
// appliedFromTemplateId — clones of templates that are themselves KINDLESS.
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

const store = {};
vi.stubGlobal("localStorage", {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
});

function mintViaEffect(template) {
  const emitted = [];
  const socket = { on() {}, emit: (ev, payload) => emitted.push({ ev, payload }) };
  bindSocketToStore(socket, () => {}, {
    current: {
      gridId: "g1", userId: "u1",
      modules: [], occurrences: [], operations: [], fields: [],
      modulesById: {}, occurrencesById: {},
    },
  });
  operationsBridge.applyEffect({
    _effect: "CREATE_ITEM",
    template,
    instance: { id: "occ-new", templateId: template.id, parentId: "parent-1" },
  });
  return emitted.find(e => e.ev === "create_module")?.payload?.module;
}

describe("CREATE_ITEM mints no inert kind", () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it("a clone of a KINDLESS instance template stays kindless", () => {
    // `kind: srcMod.kind` on a clean template is undefined — exactly what the
    // Schedule's routine clones (Drink / Hygiene / Eat / Walk / Exercise /
    // Journal) sent every single day.
    const mod = mintViaEffect({ id: "m1", role: "instance", kind: undefined, label: "Drink" });
    expect(mod).toBeTruthy();
    expect(mod.role).toBe("instance");
    expect(mod.kind).toBeUndefined();
  });

  it("a container clone still gets the doc default — unchanged behaviour", () => {
    const mod = mintViaEffect({ id: "m2", role: "container", kind: undefined, label: "Journal" });
    expect(mod.kind).toBe("doc");
  });

  it("an explicit kind survives on a kind-bearing role", () => {
    const mod = mintViaEffect({ id: "m3", role: "container", kind: "board", label: "Kanban" });
    expect(mod.kind).toBe("board");
  });

  it("a role-less template keeps the historical container/doc fallback", () => {
    const mod = mintViaEffect({ id: "m4", label: "unnamed" });
    expect(mod.role).toBe("container");
    expect(mod.kind).toBe("doc");
  });
});
