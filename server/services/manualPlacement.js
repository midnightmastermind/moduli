// server/services/manualPlacement.js
//
// A clip the user placed by hand.
//
// IT DOES NOT MINT ANYTHING. It builds a one-step CREATE pipeline and hands it
// to `runOperationServerSide` — the same executor every share RULE runs
// through, which already knows how to resolve a parent, copy a sibling's
// bindings (`bindingsLike`), key a row on its externalId and mirror the write
// into the warm cache. This is the spec's §7 constraint: three surfaces now
// turn a clip into an occurrence, and they must share one writer.
//
// Its return value is deliberately the shape `runShareRules` returns, so
// `/share` logs a hand placement exactly as it logs a rule.
import { runOperationServerSide } from "./serverExecutor.js";

// Every mapped value is a LITERAL. The window already resolved it and showed
// it to the user; a page title containing "$today" must be written verbatim
// rather than re-resolved by the executor's expression layer.
const lit = (v) => `literal:${v == null ? "" : String(v)}`;

export async function placeManually({ share, placement, userId, gridId, io = null, mirror = null }) {
  const p = placement || {};
  if (!p.parentId) throw new Error("manual placement requires a parentId");

  const fields = {};
  for (const [fieldId, value] of Object.entries(p.fields || {})) {
    if (value !== "" && value != null) fields[fieldId] = lit(value);
  }

  const op = {
    id: "manual-placement", name: "Placed by hand", enabled: true,
    pipeline: { sources: [], steps: [{
      id: "place",
      type: "action",
      config: {
        type: "CREATE",
        parentId: p.parentId,
        label: lit(p.label || share?.label || ""),
        role: p.role || "instance",
        kind: p.kind || null,
        // A literal too: an externalId is built from a URL, and a URL holding
        // "${" would otherwise be interpolated by the executor.
        externalId: share?.externalId ? lit(share.externalId) : null,
        ...(p.bindingsLike ? { bindingsLike: p.bindingsLike } : {}),
        ...(p.bindFields?.length ? { bindFields: p.bindFields } : {}),
        fields,
      },
    }] },
  };

  const res = await runOperationServerSide(op, { vars: { $share: share }, userId, gridId, io, mirror });
  return {
    ran: [{
      ruleId: "manual", ruleName: "Placed by hand",
      ok: res.ok !== false,
      error: res.error || null,
      created: (res.effects || []).filter((e) => e._effect === "CREATE"),
      unsupported: res.unsupported || [],
    }],
    halted: true,
  };
}
