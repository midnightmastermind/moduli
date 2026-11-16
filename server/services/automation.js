// services/automation.js — Jonah's automations become real Operations (user, 2026-11-16: "does the automations create
// operations. it should do that"). The model fills a short form; this turns it into the same records the Operations
// builder edits — schedule / triggerObjects / pipeline steps — so the result is listed, editable, and undoable like any
// other operation. Pure: names are resolved through `ctx`, nothing is read or written here.
//
//   { name?, when: { at: "2pm", days?: ["Mon","Wed"] | "weekdays" | "weekends", date?: "2026-11-20" }
//              | { added_to: "Tasks › Todo" }
//              | { changed: "Completed", in?: "Tasks › Todo", to?: true },
//     do: [ { notify: "Drink water" }, { add_item: "Stretch", to: "Routines › Physical", fields?: { Tags: "x" } },
//           { set: "Completed On", value: "today" }, { run: "Schedule: Place Dated Work" } ] }
//
// `set` writes the item that triggered it, so it needs an added_to / changed trigger. Anything that names nothing on
// the grid is a problem, never a guess.
import { findFieldByName, coerceValue } from "./assistantBuildTools.js";

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const uidOf = () => Math.random().toString(36).slice(2, 14);

/** "2pm", "2:30 pm", "14:00", "7 am" → "HH:MM". Pure; null when it is not a time. */
export function parseClock(raw) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(String(raw ?? ""));
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  const ap = (m[3] || "").toLowerCase().replace(/\./g, "");
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && !m[2] && h < 7) return null;            // a bare "3" is too vague to be a time
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** ["Mon","wednesday"] | "weekdays" | "weekends" | "every day" → [0..6] sorted (0 = Sunday), or null = every day. */
export function parseDays(raw) {
  if (raw == null || raw === "") return null;
  const s = Array.isArray(raw) ? raw.join(",") : String(raw);
  if (/\b(every ?day|daily|all)\b/i.test(s)) return null;
  if (/\bweekdays?\b/i.test(s)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/i.test(s)) return [0, 6];
  const days = new Set();
  for (const part of s.split(/[\s,/&]+|\band\b/i).filter(Boolean)) {
    const i = DAY_NAMES.indexOf(part.trim().toLowerCase().slice(0, 3));
    if (i >= 0) days.add(i);
  }
  return days.size && days.size < 7 ? [...days].sort((a, b) => a - b) : (days.size === 7 ? null : undefined);
}

const fmtClock = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const lit = (v) => (typeof v === "string" ? `literal:${v}` : v);
const rule = (left, comparator, right) => ({ id: uidOf(), left, comparator, right });

/**
 * @param spec the form above
 * @param ctx { userId, gridId, fields, findPlace(name) → { occId, label } | null, findOp(name) → { id, name } | null }
 * @returns {{ op: object|null, problems: string[], summary: { when: string, does: string[] } }}
 */
export function compileAutomation(spec, ctx) {
  const problems = [];
  const when = spec?.when || {};
  const actions = Array.isArray(spec?.do) ? spec.do : (spec?.do ? [spec.do] : []);
  const fields = ctx?.fields || [];
  let schedule = null; let triggerObjects = []; const guard = []; let whenText = "";
  let hasItem = false;

  const kinds = ["at", "added_to", "changed"].filter((k) => when[k] != null && when[k] !== "");
  if (kinds.length !== 1) problems.push(kinds.length ? `say ONE "when" (got ${kinds.join(" and ")})` : `say when: at a time, when something is added to a place, or when a field changes`);

  if (kinds[0] === "at") {
    const time = parseClock(when.at);
    const days = parseDays(when.days);
    if (!time) problems.push(`"${when.at}" is not a time (write it like "2pm" or "14:00")`);
    else if (days === undefined) problems.push(`"${[].concat(when.days).join(", ")}" names no weekday`);
    else if (when.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(when.date))) problems.push(`"${when.date}" is not a date (YYYY-MM-DD)`);
      else { schedule = { kind: "when", when: { mode: "once", dates: [String(when.date)], time } }; whenText = `on ${when.date} at ${fmtClock(time)}`; }
    } else if (days) {
      schedule = { kind: "when", when: { mode: "weekdays", days, time } };
      whenText = `every ${days.map((d) => DAY_LABEL[d]).join(", ")} at ${fmtClock(time)}`;
    } else {
      schedule = { kind: "atTimes", times: [time] };
      whenText = `every day at ${fmtClock(time)}`;
    }
    if (schedule) schedule = { ...schedule, suppressNotifications: false, lastFiredAt: null };
  }
  if (kinds[0] === "added_to") {
    const place = ctx.findPlace(when.added_to);
    if (!place) problems.push(`no page or section named "${when.added_to}"`);
    else {
      triggerObjects = [{ eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", priority: 5, ancestorId: place.occId }];
      whenText = `when an item is added to ${place.label || when.added_to}`;
      hasItem = true;
    }
  }
  if (kinds[0] === "changed") {
    const f = findFieldByName(fields, when.changed);
    if (f.error) problems.push(f.error);
    else {
      triggerObjects = [{ eventType: "onChange", subjectType: "field", targetId: f.field.id, priority: 5 }];
      whenText = `when ${f.field.name} changes`;
      hasItem = true;
      if (when.to !== undefined && when.to !== null && when.to !== "") {
        const v = coerceValue(f.field, when.to);
        if (v.error) problems.push(v.error);
        else { guard.push(rule("$trigger.value", "IS", v.value)); whenText = `when ${f.field.name} becomes ${JSON.stringify(v.value)}`; }
      }
      if (when.in) {
        const place = ctx.findPlace(when.in);
        if (!place) problems.push(`no page or section named "${when.in}"`);
        else { guard.push(rule("$trigger.occurrence._ancestors", "ARRAY_INCLUDES", place.occId)); whenText += ` in ${place.label || when.in}`; }
      }
    }
  }

  const steps = []; const does = [];
  if (!actions.length) problems.push(`say what it does: notify, add_item, set or run`);
  for (const a of actions) {
    if (a?.notify != null) {
      const msg = String(a.notify).trim();
      if (!msg) { problems.push("a notify needs its text"); continue; }
      steps.push({ id: uidOf(), type: "action", config: { type: "NOTIFY", message: lit(msg), sound: !!a.sound, duration: 15000 } });
      does.push(`notify "${msg}"`);
    } else if (a?.add_item != null) {
      const label = String(a.add_item).trim();
      const place = a.to ? ctx.findPlace(a.to) : null;
      if (!label) { problems.push("add_item needs the item's name"); continue; }
      if (!place) { problems.push(a.to ? `no page or section named "${a.to}"` : `add_item "${label}" needs "to" (where it goes)`); continue; }
      const values = {}; const hidden = {};
      for (const [name, raw] of Object.entries(a.fields || {})) {
        const f = findFieldByName(fields, name);
        if (f.error) { problems.push(f.error); continue; }
        const v = String(raw).toLowerCase() === "today" && f.field.type === "date" ? { value: "$today" } : coerceValue(f.field, raw);
        if (v.error) { problems.push(v.error); continue; }
        values[f.field.id] = v.value === "$today" ? "$today" : lit(v.value);
      }
      steps.push({ id: uidOf(), type: "action", config: { type: "CREATE", role: "instance", name: lit(label), parent: place.occId,
        ...(Object.keys(values).length ? { fields: values } : {}), ...(Object.keys(hidden).length ? { fieldHidden: hidden } : {}) } });
      does.push(`add "${label}" to ${place.label || a.to}`);
    } else if (a?.set != null) {
      if (!hasItem) { problems.push(`"set ${a.set}" needs an item to set it on — use it with added_to or changed`); continue; }
      const f = findFieldByName(fields, a.set);
      if (f.error) { problems.push(f.error); continue; }
      const isToday = String(a.value).toLowerCase() === "today" && f.field.type === "date";
      const v = isToday ? { value: "$today" } : coerceValue(f.field, a.value);
      if (v.error) { problems.push(v.error); continue; }
      steps.push({ id: uidOf(), type: "action", config: { type: "SET_FIELD_VALUE", fieldId: f.field.id, value: isToday ? "$today" : lit(v.value) } });
      does.push(`set ${f.field.name} to ${isToday ? "today" : JSON.stringify(v.value)} on that item`);
    } else if (a?.run != null) {
      const op = ctx.findOp(a.run);
      if (!op) { problems.push(`no operation named "${a.run}"`); continue; }
      steps.push({ id: uidOf(), type: "action", config: { type: "RUN_OPERATION", operationId: op.id } });
      does.push(`run "${op.name}"`);
    } else problems.push(`an action must be notify, add_item, set or run (got ${JSON.stringify(a)})`);
  }

  const summary = { when: whenText, does };
  if (problems.length) return { op: null, problems, summary };
  const pipelineSteps = guard.length
    ? [{ id: uidOf(), type: "if", condition: { operator: "AND", rules: guard }, then: steps, else: [] }]
    : steps;
  const name = String(spec?.name || "").trim() || `Automation: ${does[0]} ${whenText}`.slice(0, 90);
  const op = {
    id: uidOf(), userId: ctx.userId, gridId: ctx.gridId, name, priority: 5, enabled: true,
    description: `Made by Jonah: ${whenText}, ${does.join(", then ")}.`,
    triggerType: schedule ? "manual" : triggerObjects[0].eventType,
    triggerTypes: [...new Set(triggerObjects.map((t) => t.eventType))],
    triggerObjects,
    ...(schedule ? { schedule } : {}),
    pipeline: { sources: [], steps: pipelineSteps },
    meta: { madeBy: "jonah", automation: spec },
  };
  return { op, problems, summary };
}
