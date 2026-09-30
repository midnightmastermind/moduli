// helpers/opResultSummary.js
import { EVENT_TYPES } from "./triggerTypes";
//
// Human summary of what an operation run actually CHANGED, for the toolbar
// notification pills. "Operation X ran" tells the user nothing — the pill
// carries the results themselves (which item, which field, new value; what
// was created/moved/deleted) so a run with zero visible effect is
// distinguishable from one that updated three goals. Long labels are fine:
// the pill marquees and the read-full popout shows the whole text.

// Render a field value for the pill: booleans as check/cross, numbers as-is,
// long strings truncated, structures as counts.
function fmtValue(v) {
  if (v === true) return "✓";
  if (v === false) return "✗";
  if (v == null) return "∅";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  const s = String(v);
  return s.length > 24 ? s.slice(0, 23) + "…" : s;
}

// Cap on rendered segments — everything counts, but a Build op emitting 50
// creates shouldn't produce a 50-segment pill. Overflow collapses to "+N".
const MAX_PARTS = 12;
// The dropdown has room for a column of rows the one-line pill does not.
const DETAIL_MAX_ROWS = 40;

/**
 * What a single op run CHANGED, as ROWS — the dropdown renders one line per
 * row (user, 2026-09-30: "right now its like one after the other and its hard
 * to read. we should have rows inside each notification"). `summarizeOpResults`
 * is these rows joined, so the pill and the dropdown can never disagree.
 *
 * @returns {{ rows: Array<{kind:"field",item:string|null,field:string,value:string}
 *   | {kind:"created"|"deleted"|"moved"|"other",label:string,count:number}>, more: number }}
 */
export function opResultRows(results, { fieldsById = {}, occurrencesById = {}, modulesById = {} } = {}, max = MAX_PARTS) {
  const rows = [];
  if (!Array.isArray(results) || results.length === 0) return { rows, more: 0 };

  const occLabel = (occId) => {
    const o = occId ? occurrencesById[occId] : null;
    return (o && (o.label || modulesById[o.moduleId]?.label)) || null;
  };
  const fieldName = (fid) => fieldsById[fid]?.name || "field";

  // Field writes keyed by target+field — repeated writes keep the LAST value
  // (that's what the user ends up seeing). Key includes the occurrence so
  // writes to two different goals with the same display field both show.
  const fieldWrites = new Map(); // key -> { occId, fieldId, value }
  const created = [];            // labels
  const deleted = [];            // labels
  const moved = [];              // labels
  const other = new Map();       // named action -> count

  const bumpOther = (name) => other.set(name, (other.get(name) || 0) + 1);

  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const eff = r._effect;
    if (!eff) {
      // Display update (computedValues) — tracker tile outputs.
      if (r.fieldId) fieldWrites.set(`${r.occurrenceId || ""}:${r.fieldId}`, { occId: r.occurrenceId, fieldId: r.fieldId, value: r.value });
      continue;
    }
    switch (eff) {
      case "UPDATE_ITEM_FIELD":
        if (r.subKind !== "flow" && r.fieldId) fieldWrites.set(`${r.itemId || ""}:${r.fieldId}`, { occId: r.itemId, fieldId: r.fieldId, value: r.value });
        break;
      case "UPDATE_DISPLAY_VALUE":
      case "SHOW_VALUE":
        if (r.fieldId) fieldWrites.set(`${r.itemId || ""}:${r.fieldId}`, { occId: r.itemId, fieldId: r.fieldId, value: r.value ?? r.name });
        break;
      case "CREATE_ITEM":
        created.push(r.instance?.label || modulesById[r.instance?.templateId]?.label || r.template?.label || "item");
        break;
      case "CREATE_OCCURRENCE":
      case "CREATE_OCCURRENCE_AT":
        created.push(occLabel(r.instanceId) || modulesById[r.instanceId]?.label || "item");
        break;
      case "DELETE_ITEM":
        deleted.push(occLabel(r.itemId) || "item");
        break;
      case "REMOVE_OCCURRENCE":
        deleted.push(occLabel(r.occurrenceId) || "item");
        break;
      case "MOVE_OCCURRENCE":
        moved.push(occLabel(r.occurrenceId) || "item");
        break;
      case "UPDATE_OCCURRENCE":
        bumpOther(occLabel(r.occurrence?.id) ? `updated ${occLabel(r.occurrence.id)}` : "occurrence updated");
        break;
      case "UPDATE_MODULE":     bumpOther("module updated"); break;
      case "DELETE_MODULE":     bumpOther("module deleted"); break;
      case "UPDATE_VIEW":       bumpOther("view updated"); break;
      case "SET_FILTER":        bumpOther("filter set"); break;
      case "SHOW_OCCURRENCE":   bumpOther("shown"); break;
      case "HIDE_OCCURRENCE":   bumpOther("hidden"); break;
      case "ADD_TO_POOL":       bumpOther("added to pool"); break;
      case "REMOVE_FROM_POOL":  bumpOther("removed from pool"); break;
      case "CREATE_FOLDER":     bumpOther("folder created"); break;
      case "DISPLAY_LOCAL_FIELDS": bumpOther("fields displayed"); break;
      default:                  bumpOther(eff.toLowerCase().replace(/_/g, " "));
    }
  }

  for (const { occId, fieldId, value } of fieldWrites.values()) {
    rows.push({ kind: "field", item: occLabel(occId), field: fieldName(fieldId), value: fmtValue(value) });
  }
  // Creates/deletes/moves: name items, collapsing duplicates ("+3 Stretching").
  const grouped = (labels, kind) => {
    const counts = new Map();
    for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    for (const [label, count] of counts) rows.push({ kind, label, count });
  };
  grouped(created, "created");
  grouped(deleted, "deleted");
  grouped(moved, "moved");
  for (const [label, count] of other) rows.push({ kind: "other", label, count });

  let more = 0;
  if (rows.length > max) { more = rows.length - max; rows.length = max; }
  return { rows, more };
}

const ROW_PREFIX = { created: "+", deleted: "−", moved: "→" };

/** One row as the pill's inline text. */
export function opRowText(row) {
  if (row.kind === "field") {
    const write = `${row.field}→${row.value}`;
    return row.item ? `${row.item}: ${write}` : write;
  }
  if (row.kind === "other") return row.count > 1 ? `${row.label} ×${row.count}` : row.label;
  const p = ROW_PREFIX[row.kind] || "";
  return row.count > 1 ? `${p}${row.count} ${row.label}` : `${p}${row.label}`;
}

/**
 * Summarize a single op run's results (the array returned by executePipeline
 * for ONE op). Every effect type is named; nothing is silently dropped.
 *
 * @param {Array} results
 * @param {Object} ctx — { fieldsById, occurrencesById, modulesById }
 * @returns {string} e.g. `Completed: Tasks Completed→2 · +Stretching · 1 moved`
 *   or "" when nothing summarizable changed (caller falls back to "ran").
 */
export function summarizeOpResults(results, ctx = {}) {
  const { rows, more } = opResultRows(results, ctx);
  const parts = rows.map(opRowText);
  if (more > 0) parts.push(`+${more} more`);
  return parts.join(" · ");
}

// Event → the words the dropdown shows. Derived from the editor's own list so
// a new event type needs no second edit here.
const EVENT_LABEL = new Map(EVENT_TYPES.map((e) => [e.value, e.label]));

/**
 * WHAT SET THE OPERATION OFF (user, 2026-09-30: "if its a operation, include
 * what the trigger was (onLoad, onDrag of this element, etc)"). The event the
 * executor matched, plus the element / field it was about when the transaction
 * names one.
 *
 * @param {{ eventType?: string, transactionType?: string|null, transaction?: Object }} trig
 * @returns {string} e.g. `On Change · Completed on "Drink"`, `On Move · "Drink" → 3:30pm`, `On Load`
 */
export function describeOpTrigger(trig, { fieldsById = {}, occurrencesById = {}, modulesById = {} } = {}) {
  if (!trig) return "";
  const { eventType, transactionType, transaction: tx } = trig;
  const base = EVENT_LABEL.get(eventType) || (transactionType == null ? "On Load" : String(eventType || transactionType));
  if (!tx) return base;
  const label = (id) => {
    if (!id) return null;
    const o = occurrencesById[id];
    return (o && (o.label || modulesById[o.moduleId]?.label)) || modulesById[id]?.label || null;
  };
  const q = (s) => (s ? `"${s}"` : null);
  const item = q(label(tx.occurrenceId) || label(tx.instanceId));
  switch (transactionType) {
    case "MeasureOp": {
      const fids = tx.fieldId ? [tx.fieldId] : Object.keys(tx.fields || {});
      const names = fids.map((f) => fieldsById[f]?.name).filter(Boolean);
      const what = names.length ? names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "") : null;
      if (what && item) return `${base} · ${what} on ${item}`;
      return [base, what || item].filter(Boolean).join(" · ");
    }
    case "OccurrenceMoveOp":
    case "OccurrenceListOp": {
      const to = label(tx.toContainerId);
      return [base, item && (to ? `${item} → ${to}` : item)].filter(Boolean).join(" · ");
    }
    case "OccurrenceCreateOp": {
      const into = tx.containerLabel || label(tx.containerId);
      return [base, item && (into ? `${item} in ${into}` : item)].filter(Boolean).join(" · ");
    }
    case "NavigationOp":
      return tx.date ? `${base} · ${tx.date}` : base;
    default:
      return item ? `${base} · ${item}` : base;
  }
}

/**
 * Standard onSuccess/onError pill callbacks for runMatchingOperations —
 * every fire site (full_state onLoad, generic fire path, drop moves) shares
 * this so op-run pills read identically everywhere.
 *
 * @param {Function} pushTxNotification
 * @param {Function} getCtx — returns { fieldsById, occurrencesById, modulesById }
 */
export function makeOpNotificationCallbacks(pushTxNotification, getCtx) {
  return {
    onError: (name, err) => pushTxNotification({
      kind: "error",
      label: err?.message ? `"${name}" failed — ${err.message}` : `"${name}" failed`,
    }),
    onSuccess: (name, results, trig) => {
      const ctx = getCtx() || {};
      const summary = summarizeOpResults(results, ctx);
      const { rows, more } = opResultRows(results, ctx, DETAIL_MAX_ROWS);
      pushTxNotification({
        kind: "success",
        label: summary ? `"${name}" — ${summary}` : `"${name}" ran`,
        // The dropdown's structured view of the same run: the op, what set it
        // off, and one row per change.
        detail: { title: name, trigger: describeOpTrigger(trig, ctx), rows, more },
      });
    },
  };
}
