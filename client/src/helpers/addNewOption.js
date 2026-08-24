// helpers/addNewOption.js
//
// The "+ Add new" flow for occurrence dropdowns (2026-07-25, nine-dimensions
// rebuild). An occurrence field's `meta.optionsSource.addNew` can be:
//   { parentOccurrenceId }            — legacy single destination
//   { targets: [occId, occId, ...] }  — MULTIPLE candidate destinations; the
//                                       picker asks the user to SELECT AN
//                                       OCCURRENCE (first entry = default)
// plus optional:
//   stampFields — legacy config stamps ({ [fieldId]: { value, flow } })
//   fieldIds    — input fields to bind on the new option's module AND offer
//                 for value entry at add time (via the existing
//                 GET_USER_INPUT modal, operationsBridge.requestUserInput)
//
// The mechanism is deliberately NOT board-aware (per user: "don't make it
// specifically a board, select an occurrence"): targets are plain occurrence
// ids rendered by their live labels, and the tag stamping is generic — the
// fields the dropdown's find predicate matches on are copied FROM THE CHOSEN
// PARENT at run time (a board container carries its own boardCategory value,
// so a new option inherits exactly the tag of wherever it was created).
import { createLeafInstanceInParent, setOccurrenceFieldValue } from "./CommitHelpers";
import { operationsBridge } from "../state/bindSocketToStore";
import { resolveOptions } from "./optionsResolver";

// → ordered list of candidate parent occurrence ids ([] when unconfigured).
export function normalizeAddNewTargets(addNew) {
  if (!addNew) return [];
  if (Array.isArray(addNew.targets) && addNew.targets.length) return addNew.targets.filter(Boolean);
  if (addNew.parentOccurrenceId) return [addNew.parentOccurrenceId];
  return [];
}

// → [{ id, label }] for the select-an-occurrence chooser. Labels resolve from
// the LIVE occurrence (occurrence label override → module label) — never from
// stored config strings.
export function targetOptionsForAddNew(addNew, { occurrencesById = {}, modulesById = {} } = {}) {
  return normalizeAddNewTargets(addNew).map((id) => {
    const occ = occurrencesById[id] || null;
    const mod = occ ? modulesById[occ.moduleId] : null;
    return { id, label: occ?.label ?? mod?.label ?? mod?.name ?? id };
  });
}

// Field ids the dropdown's find predicate matches on (`fields.<fid>.value`
// lefts, nested OR groups included). These are the identity fields a new
// option must carry to appear in the dropdown at all.
export function collectPredicateFieldIds(optionsSource) {
  const cfg = optionsSource?.find || optionsSource;
  const out = new Set();
  const walk = (group) => {
    for (const rule of group?.rules || []) {
      if (Array.isArray(rule?.rules)) { walk(rule); continue; }
      const m = /^fields\.(.+)\.value$/.exec(String(rule?.left || ""));
      if (m) out.add(m[1]);
    }
  };
  walk(cfg?.predicate);
  return Array.from(out);
}

// Stamp fields for a new option created under `parentOcc`: legacy config
// stamps first, then — the run-time mechanism — the chosen parent's OWN
// values for every predicate field it carries. No baked tag strings: the
// parent occurrence is the source of truth for what the new option becomes.
export function buildStampFields(field, parentOcc) {
  const addNew = field?.meta?.optionsSource?.addNew || {};
  const stamp = { ...(addNew.stampFields || {}) };
  for (const fid of collectPredicateFieldIds(field?.meta?.optionsSource)) {
    const pv = parentOcc?.fields?.[fid];
    if (pv?.value !== undefined && pv?.value !== null && pv?.value !== "") {
      stamp[fid] = { value: pv.value, flow: pv.flow || "in" };
    }
  }
  return stamp;
}

// Mint the new option occurrence under the chosen parent. Binds the stamp
// fields HIDDEN (identity tags never render inline) and any addNew.fieldIds
// as visible inputs. Returns { moduleId, occurrenceId, entryFieldIds }.
export function createOptionUnderParent({ field, parentOcc, label, dispatch, socket, gridId, userId, occMeta = null }) {
  if (!field || !parentOcc || !label?.trim()) return null;
  const addNew = field.meta?.optionsSource?.addNew || {};
  const stamp = buildStampFields(field, parentOcc);
  const entryFieldIds = Array.isArray(addNew.fieldIds) ? addNew.fieldIds.filter(Boolean) : [];
  const fieldBindings = [
    ...Object.keys(stamp).map((fid, i) => ({ fieldId: fid, role: "input", order: i, hidden: true })),
    ...entryFieldIds.map((fid, i) => ({ fieldId: fid, role: "input", order: 100 + i })),
  ];
  const res = createLeafInstanceInParent({
    dispatch, socket, gridId, userId,
    parentOccurrence: parentOcc,
    label: label.trim(),
    initialFields: stamp,
    fieldBindings,
    occMeta,
  });
  if (!res) return null;
  return { ...res, entryFieldIds };
}

// ── Entry-field prompting (the "enter data in the fields too" half) ─────────
function modalRequestForField(f, ctx) {
  const base = { title: "New option", question: f.name || "Value" };
  const t = f.type;
  if (t === "number") return { ...base, inputType: "number" };
  if (t === "boolean") return { ...base, inputType: "boolean" };
  if (t === "date") return { ...base, inputType: "date" };
  if (t === "select") {
    const resolved = resolveOptions(f, ctx);
    const options = resolved.options.length
      ? resolved.options
      : (f.meta?.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    return { ...base, inputType: "select", options };
  }
  if (t === "occurrence") {
    const { options } = resolveOptions(f, ctx);
    return { ...base, inputType: "select", options };
  }
  return { ...base, inputType: "text" };
}

function coerceModalValue(f, raw) {
  if (raw === "" || raw === undefined || raw === null) return null;
  let v = raw;
  if (f.type === "number") v = Number(raw);
  if (f.meta?.multiSelect) v = Array.isArray(raw) ? raw : [raw];
  return v;
}

// Ask for each entry field's value through the EXISTING GET_USER_INPUT modal
// (operationsBridge.requestUserInput — one question per field, chained the
// same way chained GET_USER_INPUTs already work) and write the answers onto
// the created occurrence via the normal field-write path (triggers fire).
// Cancel at any point stops the remaining questions; the occurrence survives.
export async function promptEntryFields({ entryFieldIds, occurrenceId, fieldsById, ctx, dispatch, socket }) {
  const ask = operationsBridge.requestUserInput;
  if (typeof ask !== "function" || !entryFieldIds?.length) return;
  for (const fid of entryFieldIds) {
    const f = fieldsById?.[fid];
    if (!f) continue;
    let raw;
    try {
      raw = await ask(modalRequestForField(f, ctx));
    } catch {
      return; // cancelled — keep the occurrence, skip remaining questions
    }
    const value = coerceModalValue(f, raw);
    if (value === null) continue;
    setOccurrenceFieldValue({
      dispatch, socket,
      occurrencesById: ctx?.occurrencesById || {},
      occurrenceId, fieldId: fid, value,
    });
  }
}
