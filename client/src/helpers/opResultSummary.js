// helpers/opResultSummary.js
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

/**
 * Summarize a single op run's results (the array returned by executePipeline
 * for ONE op). Every effect type is named; nothing is silently dropped.
 *
 * @param {Array} results
 * @param {Object} ctx — { fieldsById, occurrencesById, modulesById }
 * @returns {string} e.g. `Completed: Tasks Completed→2 · +Stretching · 1 moved`
 *   or "" when nothing summarizable changed (caller falls back to "ran").
 */
export function summarizeOpResults(results, { fieldsById = {}, occurrencesById = {}, modulesById = {} } = {}) {
  if (!Array.isArray(results) || results.length === 0) return "";

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

  const parts = [];

  for (const { occId, fieldId, value } of fieldWrites.values()) {
    const target = occLabel(occId);
    const write = `${fieldName(fieldId)}→${fmtValue(value)}`;
    parts.push(target ? `${target}: ${write}` : write);
  }

  // Creates/deletes/moves: name items, collapsing duplicates ("+3 Stretching").
  const grouped = (labels, prefix) => {
    const counts = new Map();
    for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    for (const [l, n] of counts) parts.push(n > 1 ? `${prefix}${n} ${l}` : `${prefix}${l}`);
  };
  grouped(created, "+");
  grouped(deleted, "−");
  grouped(moved, "→");

  for (const [name, n] of other) parts.push(n > 1 ? `${name} ×${n}` : name);

  if (parts.length > MAX_PARTS) {
    const extra = parts.length - MAX_PARTS;
    parts.length = MAX_PARTS;
    parts.push(`+${extra} more`);
  }
  return parts.join(" · ");
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
    onSuccess: (name, results) => {
      const summary = summarizeOpResults(results, getCtx() || {});
      pushTxNotification({
        kind: "success",
        label: summary ? `"${name}" — ${summary}` : `"${name}" ran`,
      });
    },
  };
}
