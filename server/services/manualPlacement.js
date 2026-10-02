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
import Field from "../models/Field.js";

// The window's mapping boxes are TEXT, so a year arrives as "2006" while the
// rows beside it hold 2006 (poms' Movies: 864 numbers, 0 strings before this).
// Coerced here because this is the one place that knows the field's type.
// A value that does not parse is written as typed, never dropped.
export function coerceToFieldType(value, type) {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (type === "number" && t !== "" && Number.isFinite(Number(t))) return Number(t);
  if (type === "boolean" && (t === "true" || t === "false")) return t === "true";
  return value;
}

// Every mapped value is a LITERAL. The window already resolved it and showed
// it to the user; a page title containing "$today" must be written verbatim
// rather than re-resolved by the executor's expression layer.
const lit = (v) => `literal:${v == null ? "" : String(v)}`;
// A value that is not a string (an auto-filled select's ["movie"], a number)
// keeps its type: `json:` is parsed, never resolved, on the server.
const valueExpr = (v) => (typeof v === "string" ? lit(v) : `json:${JSON.stringify(v)}`);

// A textblock's BODY, as the textmap a textblock renders: one paragraph per
// blank-line-separated block, a single newline kept as a hard break. Plain
// text only — the window sends what the user saw in the box.
export function bodyToTextmap(body) {
  const text = String(body || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  const paragraphs = text.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    const content = [];
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
    return content.length ? { type: "paragraph", content } : { type: "paragraph" };
  });
  return { type: "doc", content: paragraphs };
}

export async function placeManually({ share, placement, userId, gridId, io = null, mirror = null }) {
  const p = placement || {};
  if (!p.parentId) throw new Error("manual placement requires a parentId");

  const ids = Object.keys(p.fields || {});
  const types = new Map();
  if (ids.length) {
    const defs = await Field.find({ userId, gridId, id: { $in: ids } }, { id: 1, type: 1 }).lean();
    for (const f of defs) types.set(f.id, f.type);
  }
  const fields = {};
  for (const [fieldId, value] of Object.entries(p.fields || {})) {
    if (value !== "" && value != null) fields[fieldId] = valueExpr(coerceToFieldType(value, types.get(fieldId)));
  }

  // A SHARED FILE is already a row — stored into Files before placement runs
  // (prepareShare → storeSharedFile). Placing it by hand MOVES that row to the
  // chosen parent; creating another would leave the file in two places.
  if (share?.props?.occurrenceId) {
    const moveOp = {
      id: "manual-placement", name: "Placed by hand", enabled: true,
      pipeline: { sources: [], steps: [{ id: "place", type: "action", config: {
        type: "MOVE_OCCURRENCE", occurrenceIdExpr: lit(share.props.occurrenceId), toContainerId: lit(p.parentId),
      } }] },
    };
    const res = await runOperationServerSide(moveOp, { vars: { $share: share }, userId, gridId, io, mirror });
    return {
      ran: [{
        ruleId: "manual", ruleName: "Placed by hand",
        ok: res.ok !== false,
        error: res.error || null,
        created: (res.effects || []).filter((e) => e._effect === "MOVE_OCCURRENCE")
          .map((e) => ({ _effect: "MOVE_OCCURRENCE", occurrenceId: e.occurrenceId, parentId: e.to })),
        unsupported: res.unsupported || [],
      }],
      halted: true,
    };
  }

  const op = {
    id: "manual-placement", name: "Placed by hand", enabled: true,
    pipeline: { sources: [], steps: [{
      id: "place",
      type: "action",
      config: {
        type: "CREATE",
        parentId: p.parentId,
        // A textblock has no label (it IS its text), so the share's own label
        // is not borrowed for one.
        label: lit(p.role === "textblock" ? (p.label || "") : (p.label || share?.label || "")),
        ...(bodyToTextmap(p.body) ? { textmap: `json:${JSON.stringify(bodyToTextmap(p.body))}` } : {}),
        role: p.role || "instance",
        kind: p.kind || null,
        // A literal too: an externalId is built from a URL, and a URL holding
        // "${" would otherwise be interpolated by the executor.
        externalId: share?.externalId ? lit(share.externalId) : null,
        // A bookmark or image IS its URL: the executor keys the module on it,
        // so re-clipping the same link reuses one module (/ingest's rule).
        ...(p.fileRef ? { moduleFileRef: lit(p.fileRef) } : {}),
        ...(p.bindingsLike ? { bindingsLike: p.bindingsLike } : {}),
        ...(p.bindFields?.length ? { bindFields: p.bindFields } : {}),
        // The instance's picture. A media row draws `occurrence.meta.cover`
        // (its module is shared by every row of the kind), so the cover the
        // window chose goes on the placement. A literal, like every value here.
        ...(typeof p.cover === "string" && p.cover.trim() ? { meta: { cover: lit(p.cover.trim()) } } : {}),
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
