// server/migrations/0368-people-handles-to-names.mjs
//
// Instagram people whose card name is still their handle ("alissabratz",
// "__lexi__brody__") get the real name the handle spells ("Alissa Bratz").
// User, 2026-09-26: "all the ones with Name like alissabratz, please parse the
// label and name (so it would be Alissa Bratz)". Splitting a run-together
// handle by rule proved unreliable ("Ali Ssabratz"), and many handles are not
// names at all ("switch.babysitter"), so the list was written by hand — only
// handles that clearly read as a person's name — and lives outside git
// (it names people): PEOPLE_HANDLE_NAMES_PATH = { names: { <handle>: "Full Name" } }.
//
// For each People card whose label or Name field IS a listed handle: the
// label (the module's, and the placement's when it has its own) and the Name
// field become the full name. The Instagram field keeps the handle. Restart
// pm2 after --apply.

import fs from "node:fs";

export const id = "0368-people-handles-to-names";
export const describe = "Renames People cards still named by their Instagram handle to the full name the handle spells (PEOPLE_HANDLE_NAMES_PATH).";
export const touches = ["modules", "occurrences"];

/** PURE. What changes for one card, or null. */
export function planRename({ label, name }, names) {
  const to = names[name] || names[label];
  if (!to) return null;
  return { label: names[label] ? to : null, name: to !== name ? to : null };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const file = process.env.PEOPLE_HANDLE_NAMES_PATH;
  if (!file || !fs.existsSync(file)) throw new Error(`PEOPLE_HANDLE_NAMES_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  const names = JSON.parse(fs.readFileSync(file, "utf8"))?.names || {};
  const nameField = (await Field.find({ gridId, name: "Name" }).lean());
  if (nameField.length !== 1) { log(`expected one "Name" field, found ${nameField.length} — refusing`); return; }
  const NAME = nameField[0].id;

  const people = await Occurrence.find({ gridId, "meta.source": "social-import" }).lean();
  const mods = new Map((await Module.find({ gridId, id: { $in: people.map((o) => o.moduleId) } }).lean()).map((m) => [m.id, m]));
  let n = 0;
  const now = new Date().toISOString();
  const seen = new Set();
  for (const o of people) {
    const mod = mods.get(o.moduleId);
    const label = o.label || mod?.label || "";
    const plan = planRename({ label, name: o.fields?.[NAME]?.value || "" }, names);
    if (!plan) continue;
    n++;
    seen.add(names[o.fields?.[NAME]?.value] ? o.fields[NAME].value : label);
    log(`   ${label} → ${plan.label || plan.name}`);
    if (dryRun) continue;
    if (plan.label) {
      await Module.updateOne({ gridId, id: o.moduleId }, { $set: { label: plan.label } });
      if (o.label) await Occurrence.updateOne({ gridId, id: o.id }, { $set: { label: plan.label } });
    }
    if (plan.name) {
      await Occurrence.updateOne({ gridId, id: o.id }, { $set: { [`fields.${NAME}`]: { ...(o.fields?.[NAME] || { flow: "in" }), value: plan.name, timestamp: now } } });
    }
  }
  const unused = Object.keys(names).filter((h) => !seen.has(h));
  log(`${n} card(s)${dryRun ? " to rename" : " renamed"}${unused.length ? ` · not found: ${unused.join(", ")}` : ""}`);
}
