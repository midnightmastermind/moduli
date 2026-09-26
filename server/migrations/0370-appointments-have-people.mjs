// server/migrations/0370-appointments-have-people.mjs
//
// Appointments get a People field (user, 2026-09-26: "my appointments should
// have a person field as well btw so i can set my physical therapist or
// therapist etc").
//
// An appointment is an item binding Schedule Type whose type is not
// Employment (a work shift binds the same field and already names its employer
// with Job). Each such module gains a visible People binding — the same People
// field the birthday cards and tasks use, which picks from the People board.
// The calendar share rule's CREATE attaches People too, so an appointment
// arriving from an invite has the field ready. Nothing is filled in.

export const id = "0370-appointments-have-people";
export const describe = "Binds the People field on every appointment (items with a Schedule Type other than Employment) and has the calendar share rule attach it.";
export const touches = ["modules", "operations"];

/** PURE. Bindings with People added (visible), or null when already there. */
export function withPeopleBinding(bindings, peopleFieldId) {
  const list = bindings || [];
  const at = list.findIndex((b) => b.fieldId === peopleFieldId);
  if (at !== -1) return list[at].hidden ? list.map((b, i) => (i === at ? { ...b, hidden: false } : b)) : null;
  const order = Math.max(-1, ...list.map((b) => b.order ?? 0)) + 1;
  return [...list, { fieldId: peopleFieldId, role: "input", order }];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field, Operation } = models;
  const fields = await Field.find({ gridId }).lean();
  const typeField = fields.find((f) => f.name === "Schedule Type");
  const people = fields.filter((f) => f.name === "People" && f.type === "occurrence");
  if (!typeField || people.length !== 1) { log("missing Schedule Type or a single People field — refusing"); return; }
  const P = people[0].id;

  const empMods = await Module.find({ gridId, label: "Employment" }).lean();
  const empIds = new Set((await Occurrence.find({ gridId, moduleId: { $in: empMods.map((m) => m.id) } }).lean()).map((o) => o.id));

  const mods = await Module.find({ gridId, "fieldBindings.fieldId": typeField.id }).lean();
  let n = 0;
  for (const m of mods) {
    const occs = await Occurrence.find({ gridId, moduleId: m.id }).lean();
    const types = occs.map((o) => o.fields?.[typeField.id]?.value).filter(Boolean);
    if (types.length && types.every((t) => empIds.has(t))) { log(`   skip ${m.label} (Employment)`); continue; }
    const next = withPeopleBinding(m.fieldBindings, P);
    if (!next) continue;
    n++;
    log(`   ${m.label}: bind People`);
    if (!dryRun) await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next } });
  }

  // The calendar share rule: attach People on the appointments it creates.
  const rule = (await Operation.find({ gridId, "triggerObjects.eventType": "onShare" }).lean())
    .find((o) => JSON.stringify(o.pipeline).includes(`"${typeField.id}"`) && /calendar/i.test(o.name));
  let ruleChanged = false;
  if (rule) {
    const pipeline = JSON.parse(JSON.stringify(rule.pipeline));
    const walk = (steps) => { for (const s of steps || []) {
      const c = s?.config;
      if (c?.type === "CREATE" && c.fields && typeTypeIn(c) && !(c.attachFields || []).includes(P)) {
        c.attachFields = [...(c.attachFields || []), P]; ruleChanged = true;
      }
      for (const k of ["then", "else", "body"]) walk(s?.[k]);
    } };
    const typeTypeIn = (c) => Object.prototype.hasOwnProperty.call(c.fields, typeField.id);
    walk(pipeline.steps);
    log(`"${rule.name}": ${ruleChanged ? "attach People" : "already attaches People"}`);
    if (ruleChanged && !dryRun) await Operation.updateOne({ gridId, id: rule.id }, { $set: { pipeline } });
  }
  log(`${n} appointment module(s)${dryRun ? " to bind" : " bound"}. Restart the server (pm2).`);
}
