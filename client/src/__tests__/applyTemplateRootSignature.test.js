// APPLY_TEMPLATE can be handed the identity of THIS application.
//
// A non-merge ROOT is deliberately left unsigned (the derived
// `auto:<templateId>` would give every day column built from one template the
// SAME signature), which left it the one node nothing could recognise
// structurally. `rootSignature` closes that with a caller-supplied, per-
// application identity — and it is what the server's duplicate guard keys on.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const tplMod = { id: "tplMod", label: "Day", role: "container", kind: "doc" };
const kidMod = { id: "kidMod", label: "Journal", role: "container", kind: "doc" };

function world() {
  return {
    occurrencesById: {
      board: { id: "board", moduleId: "boardMod", occurrences: [] },
      tpl:   { id: "tpl", moduleId: "tplMod", occurrences: ["tplKid"], fields: {} },
      tplKid:{ id: "tplKid", moduleId: "kidMod", parentId: "tpl", occurrences: [], fields: {},
               identitySignature: "daypage:Journal" },
    },
    modulesById: { tplMod, kidMod, boardMod: { id: "boardMod", role: "container" } },
  };
}

const run = (cfg, vars = {}) => {
  const ctx = world();
  const $vars = { $allItems: Object.values(ctx.occurrencesById), $allOccurrences: [], ...vars };
  const updates = executeActionItem(cfg.type, cfg, $vars, ctx, {}) || [];
  return updates.filter((u) => u._effect === "CREATE_ITEM");
};

const cfgBase = {
  type: "APPLY_TEMPLATE",
  templateRef: "tpl",
  rootParent: "board",
  rootIdVar: "$colId",
};

describe("APPLY_TEMPLATE rootSignature", () => {
  it("leaves the root UNSIGNED when no rootSignature is given (unchanged behaviour)", () => {
    const creates = run(cfgBase);
    const root = creates.find((c) => c.instance?.parentId === "board");
    expect(root).toBeTruthy();
    expect(root.instance.identitySignature).toBeNull();
  });

  it("stamps the resolved rootSignature on the ROOT", () => {
    const creates = run({ ...cfgBase, rootSignature: "daypage:col:${$day}" }, { $day: "2026-09-03" });
    const root = creates.find((c) => c.instance?.parentId === "board");
    expect(root.instance.identitySignature).toBe("daypage:col:2026-09-03");
  });

  // It names THIS application, so two applications differ — which is the whole
  // point: one column per day is legal, two are not.
  it("differs per application, so a second date gets its own identity", () => {
    const a = run({ ...cfgBase, rootSignature: "daypage:col:${$day}" }, { $day: "2026-09-03" });
    const b = run({ ...cfgBase, rootSignature: "daypage:col:${$day}" }, { $day: "2026-09-04" });
    const sig = (cs) => cs.find((c) => c.instance?.parentId === "board").instance.identitySignature;
    expect(sig(a)).not.toBe(sig(b));
  });

  // CHILDREN keep their own signatures — the override names the root only.
  it("does not touch the children's signatures", () => {
    const creates = run({ ...cfgBase, rootSignature: "daypage:col:${$day}" }, { $day: "2026-09-03" });
    const kid = creates.find((c) => c.instance?.identitySignature === "daypage:Journal");
    expect(kid).toBeTruthy();
  });
});
