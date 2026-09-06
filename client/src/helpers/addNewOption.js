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
// AND, since 2026-09-06, the user may ADD a field the config never declared
// (*"we should be able to add fields and values to those fields to the options
// we add ... just like quick adding occurances"*). `addNew.fieldIds` is a
// PRE-DECLARED list — it can fill fields but never introduce one — so after the
// declared questions the flow offers a field picker, and the pick is BOUND as
// well as written (a value with no binding is stored and renders nowhere, the
// `0047` defect). Which fields it offers is DERIVED, never listed: see
// `candidateFieldsForOption`.
//
// The mechanism is deliberately NOT board-aware (per user: "don't make it
// specifically a board, select an occurrence"): targets are plain occurrence
// ids rendered by their live labels, and the tag stamping is generic — the
// fields the dropdown's find predicate matches on are copied FROM THE CHOSEN
// PARENT at run time (a board container carries its own boardCategory value,
// so a new option inherits exactly the tag of wherever it was created).
import { createLeafInstanceInParent, setOccurrenceFieldValue, ensureModuleBindingsForOccurrenceFields } from "./CommitHelpers";
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
export function createOptionUnderParent({ field, parentOcc, label, dispatch, socket, gridId, userId, occMeta = null, extraFields = null }) {
  if (!field || !parentOcc || !label?.trim()) return null;
  const addNew = field.meta?.optionsSource?.addNew || {};
  const stamp = buildStampFields(field, parentOcc);
  const entryFieldIds = Array.isArray(addNew.fieldIds) ? addNew.fieldIds.filter(Boolean) : [];
  // Values mapped in from a search provider. They are BOUND as well as written:
  // a value with no binding is stored and renders nowhere, which is the
  // stamped-but-invisible half of the `0047` defect ("an ingredient module did
  // not BIND the macro fields at all"). Visible, because unlike the identity
  // stamp these are facts the user wants to see and correct.
  const extra = extraFields && typeof extraFields === "object" ? extraFields : {};
  const extraIds = Object.keys(extra).filter((fid) => !stamp[fid] && !entryFieldIds.includes(fid));
  const fieldBindings = [
    ...Object.keys(stamp).map((fid, i) => ({ fieldId: fid, role: "input", order: i, hidden: true })),
    ...entryFieldIds.map((fid, i) => ({ fieldId: fid, role: "input", order: 100 + i })),
    ...extraIds.map((fid, i) => ({ fieldId: fid, role: "input", order: 200 + i })),
  ];
  const res = createLeafInstanceInParent({
    dispatch, socket, gridId, userId,
    parentOccurrence: parentOcc,
    label: label.trim(),
    initialFields: { ...extra, ...stamp },
    fieldBindings,
    occMeta,
  });
  if (!res) return null;
  return { ...res, entryFieldIds };
}

// Fields worth offering when adding one by hand.
//
// DERIVED FROM THE SIBLINGS, NOT FROM A LIST. The useful answer to "what
// fields does this kind of thing have?" is "the ones the other options under
// this same parent already carry" — so a Grocery item offers what groceries
// carry, and a new board invents nothing. Ordered by how many siblings use
// each one, so the common fields come first.
//
// Excluded: anything already on the new option, and every HIDDEN binding —
// those are the identity tags `buildStampFields` writes, which are the
// dropdown's own plumbing and not a field anybody means to fill in.
//
// The fallback (a parent whose other options carry nothing) is every
// input-capable field, because offering nothing would make the picker appear
// and do nothing — worse than not appearing.
export function candidateFieldsForOption({ parentOcc, occurrenceId, occurrencesById = {}, modulesById = {}, fieldsById = {} }) {
  const self = occurrencesById[occurrenceId];
  const mine = new Set(Object.keys(self?.fields || {}));
  for (const b of modulesById[self?.moduleId]?.fieldBindings || []) if (b?.fieldId) mine.add(b.fieldId);

  const freq = new Map();
  for (const sid of parentOcc?.occurrences || []) {
    if (sid === occurrenceId) continue;
    const sib = occurrencesById[sid];
    for (const b of modulesById[sib?.moduleId]?.fieldBindings || []) {
      if (!b?.fieldId || b.hidden || mine.has(b.fieldId)) continue;
      freq.set(b.fieldId, (freq.get(b.fieldId) || 0) + 1);
    }
  }
  const nameOf = (fid) => fieldsById[fid]?.name || "";
  let ids = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])))
    .map(([fid]) => fid);
  if (!ids.length) {
    ids = Object.keys(fieldsById)
      .filter((fid) => !mine.has(fid) && fieldsById[fid]?.inputEnabled !== false)
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }
  return ids.filter((fid) => fieldsById[fid]).map((fid) => ({ value: fid, label: nameOf(fid) || fid }));
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
// Cap on hand-added fields per option. Not a product limit — a runaway guard:
// the loop is driven by a modal whose answer decides whether it runs again, and
// a bridge that resolved the same value forever would spin the tab.
const MAX_ADDED_FIELDS = 12;
const DONE = "__done__";

/**
 * Write the fields a user ticked in the shared picker onto the created option.
 *
 * The picker's counterpart to `promptEntryFields`'s modal chain. It is the
 * WRITE half only — the panel already asked — so it does one thing per ticked
 * field: store the value and BIND it. A value with no binding is stored and
 * renders nowhere, which is the half of `0047` that looks like the write
 * silently failed.
 *
 * A ticked field with no value is still BOUND. That is the point of ticking it
 * without typing: the row gains somewhere to put the number later.
 */
export function applyPickedFields({
  picked, values, occurrenceId, fieldsById, ctx, dispatch, socket,
}) {
  const ids = (picked || []).filter((fid) => fieldsById?.[fid]);
  if (!ids.length) return 0;

  const occ = ctx?.occurrencesById?.[occurrenceId];
  const written = {};
  for (const fid of ids) {
    const value = coerceModalValue(fieldsById[fid], values?.[fid]);
    if (value === null) continue;
    written[fid] = { value };
    setOccurrenceFieldValue({
      dispatch, socket,
      occurrencesById: ctx?.occurrencesById || {},
      occurrenceId, fieldId: fid, value,
    });
  }

  // Bind EVERY ticked field, not only the ones that got a value.
  ensureModuleBindingsForOccurrenceFields({
    dispatch, socket,
    occurrence: {
      id: occurrenceId,
      moduleId: occ?.moduleId,
      fields: Object.fromEntries(ids.map((fid) => [fid, written[fid] || { value: null }])),
    },
  });
  return ids.length;
}

export async function promptEntryFields({
  entryFieldIds, occurrenceId, fieldsById, ctx, dispatch, socket,
  parentOcc = null, allowAddFields = true,
}) {
  const ask = operationsBridge.requestUserInput;
  if (typeof ask !== "function") return;
  if (!entryFieldIds?.length && !allowAddFields) return;
  for (const fid of entryFieldIds || []) {
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

  if (!allowAddFields) return;

  // ── "add a field too" ────────────────────────────────────────────────────
  // DONE is offered FIRST so it is the default: adding is opt-in, and someone
  // who just wanted an option named "Tortillas" presses through unchanged.
  const added = [];
  for (let i = 0; i < MAX_ADDED_FIELDS; i++) {
    const candidates = candidateFieldsForOption({
      parentOcc, occurrenceId,
      occurrencesById: ctx?.occurrencesById || {},
      modulesById: ctx?.modulesById || {},
      fieldsById: fieldsById || {},
    }).filter((c) => !added.includes(c.value));
    if (!candidates.length) return;

    let pick;
    try {
      pick = await ask({
        title: "New option",
        question: added.length ? "Add another field?" : "Add a field?",
        inputType: "select",
        options: [{ value: DONE, label: "— done —" }, ...candidates],
      });
    } catch { return; }                      // cancelled — the option survives
    if (!pick || pick === DONE) return;

    const f = fieldsById?.[pick];
    if (!f) return;

    let raw;
    try { raw = await ask(modalRequestForField(f, ctx)); } catch { return; }
    const value = coerceModalValue(f, raw);
    added.push(pick);
    if (value === null) continue;            // skipped the value, keep going

    setOccurrenceFieldValue({
      dispatch, socket,
      occurrencesById: ctx?.occurrencesById || {},
      occurrenceId, fieldId: pick, value,
    });
    // BIND it as well as write it. A value with no binding is stored and
    // renders nowhere — the half of `0047` that looks like the write failed.
    ensureModuleBindingsForOccurrenceFields({
      dispatch, socket,
      occurrence: {
        id: occurrenceId,
        moduleId: ctx?.occurrencesById?.[occurrenceId]?.moduleId,
        fields: { [pick]: { value } },
      },
    });
  }
}
