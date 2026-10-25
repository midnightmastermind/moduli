// helpers/formButton.js — "Add a form button" on a container (2026-10-25).
//
// One gesture makes "New <noun>": a button field bound on the container, and an operation that
//   1. asks with a form (Name + the input fields the container's instances use),
//   2. creates an occurrence in the container the button was pressed on — a new placement of the board's
//      shared module when its instances share one, else an occurrence of their role/kind — writing each form
//      answer and every value all the instances agree on,
//   3. scrolls to the new occurrence.
// Everything is read off the container's own instances; nothing here knows what a movie or a board is.
import * as CommitHelpers from "./CommitHelpers";
import { withAction } from "./actionScope";
import { uid } from "../uid";
import { itemKey } from "./formItems";
import { makeButtonOperation } from "./buttonOperation";
import { uniqueFieldName } from "./fieldCategories";

const LEAF_ROLES = new Set(["instance", "artifact", "textblock"]);
const NO_INPUT_TYPES = new Set(["media", "files", "button"]);

/** The container's leaf children (instances, files, textblocks), in list order. */
function leafRows(container, occurrencesById, modulesById) {
  return (container?.occurrences || [])
    .map((id) => occurrencesById?.[id])
    .filter((o) => o && LEAF_ROLES.has(modulesById?.[o.moduleId]?.role || "instance"));
}

const valueOf = (occ, fid) => occ?.fields?.[fid]?.value;
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** { fieldId: value } for the fields every row holds with the same non-empty value. */
export function agreedValues(rows, fieldIds) {
  const out = {};
  if (!rows?.length) return out;
  for (const fid of fieldIds) {
    const first = valueOf(rows[0], fid);
    if (isEmpty(first)) continue;
    const key = JSON.stringify(first);
    if (rows.every((r) => JSON.stringify(valueOf(r, fid)) === key)) out[fid] = first;
  }
  return out;
}

/** The most common value of `pick(row)` among rows, with its count. */
function mostCommon(rows, pick) {
  const counts = new Map();
  for (const r of rows) {
    const k = pick(r);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return { value: best, count: n };
}

/**
 * Plan the field, operation and container binding for "New <noun>". Pure.
 * @returns {{ field, operation, containerModule }}  containerModule = the module with the button bound
 */
export function planFormButton({ container, containerModule, noun, occurrencesById, modulesById, fieldsById, gridId, folderId = null }) {
  const label = `New ${String(noun || "item").trim() || "item"}`;
  const rows = leafRows(container, occurrencesById, modulesById);

  // Every field the rows bind, first-seen order, with the binding that first named it.
  const bindings = new Map();
  for (const r of rows) {
    for (const b of modulesById?.[r.moduleId]?.fieldBindings || []) {
      if (b?.fieldId && !bindings.has(b.fieldId)) bindings.set(b.fieldId, b);
    }
  }
  const usable = [...bindings.values()].filter((b) => {
    const f = fieldsById?.[b.fieldId];
    return f && !f.trashed && f.displayEnabled !== true && f.type !== "button" && (b.role || "input") !== "display";
  });

  // One row agrees with nobody: its values belong to that row, not to every new one.
  const agreed = rows.length >= 2 ? agreedValues(rows, usable.map((b) => b.fieldId)) : {};

  const items = [{ key: "name", label: "Name", type: "text", required: true }];
  // Every field the instances bind goes in the Create (a null value binds it empty), with their hidden flag, so the
  // new occurrence has the same shape: a hidden Board Category stays hidden, a Poster slot is there to fill.
  const fields = {};
  const fieldHidden = {};
  for (const b of usable) {
    const f = fieldsById[b.fieldId];
    if (b.hidden === true) fieldHidden[b.fieldId] = true;
    if (b.fieldId in agreed) {
      const v = agreed[b.fieldId];
      fields[b.fieldId] = typeof v === "string" ? `literal:${v}` : v;
      continue;
    }
    if (b.hidden === true || NO_INPUT_TYPES.has(f.type) || f.inputEnabled === false || (b.role && b.role !== "input")) {
      fields[b.fieldId] = null;
      continue;
    }
    items.push({ key: itemKey(f.name, items.map((i) => i.key)), label: f.name, fieldId: f.id });
    fields[f.id] = `$form.fields.${f.id}`;
  }

  const shared = rows.length >= 2 ? mostCommon(rows, (r) => r.moduleId) : { value: null, count: 0 };
  const placeShared = shared.value && shared.count >= 2 && shared.count * 2 >= rows.length && modulesById?.[shared.value];
  const create = { type: "CREATE", parent: "$trigger.occurrenceId", itemIdVar: "$newId", fields, ...(Object.keys(fieldHidden).length ? { fieldHidden } : {}) };
  if (placeShared) {
    Object.assign(create, { module: shared.value, occurrenceLabel: "$form.values.name" });
  } else {
    const role = mostCommon(rows, (r) => modulesById?.[r.moduleId]?.role).value || "instance";
    const kind = mostCommon(rows.filter((r) => modulesById?.[r.moduleId]?.role === role), (r) => modulesById?.[r.moduleId]?.kind).value;
    Object.assign(create, { role, ...(kind ? { kind } : {}), name: "$form.values.name", newModule: true });
  }

  const field = {
    id: uid(), gridId, name: uniqueFieldName(fieldsById, label), type: "button",
    meta: { buttonLabel: label },
  };
  const operation = makeButtonOperation(field, { gridId, folderId });
  operation.name = label;
  operation.pipeline = { sources: [], steps: [
    { id: uid(), type: "action", config: { type: "ASK_FORM", title: label, submitLabel: "Add", items } },
    { id: uid(), type: "action", config: create },
    { id: uid(), type: "action", config: { type: "SCROLL_TO", itemIdExpr: "$newId" } },
  ] };
  field.meta.operationId = operation.id;

  const nextModule = {
    ...containerModule,
    fieldBindings: [...(containerModule?.fieldBindings || []), { fieldId: field.id, role: "input" }],
  };
  return { field, operation, containerModule: nextModule };
}

/** Write the plan — one undo step. Returns the plan. */
export function addFormButton({ dispatch, socket, ...args }) {
  const plan = planFormButton(args);
  withAction("Added form button", () => {
    CommitHelpers.createField({ dispatch, socket, field: plan.field });
    CommitHelpers.createOperation({ dispatch, socket, operation: plan.operation });
    CommitHelpers.updateModule({ dispatch, socket, module: plan.containerModule, emit: true });
  });
  return plan;
}
