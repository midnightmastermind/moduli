// server/migrations/0360-add-instagram-people.mjs
//
// Instagram accounts that are real people and not yet on the People board
// (user, 2026-09-25: "we need to make sure we filter out obvious brands and
// celebrities (try to just match to my system but if you find any that are
// people and not in my system, add them. just make sure to use your best to
// filter"). The judgement is made outside the code — from the following +
// followers lists, keeping mutual follows and private-looking individuals and
// leaving out celebrities, politicians, creators/coaches, meme and quote pages,
// businesses and pets — and written to a file outside git (it names people):
//
//   PEOPLE_IG_ADD_PATH = { version: 1,
//     add:    [{ handle, name, followsYou }],        // new people
//     attach: [{ handle, externalIdPrefix }] }       // a handle for an existing person
//
// A new person is minted exactly the way 0352 minted Instagram people: the
// board's exemplar field set, `meta.source: "social-import"`,
// `meta.externalId: "ig:<handle>"`, and 0352's own `personFieldValues` (Found Via
// "instagram" + "mutual" / "you follow", Relationship). Their photo comes from
// 0359, run after this with the same CSV — this migration fetches nothing.
// An `attach` fills the Instagram field of the ONE person whose externalId starts
// with the prefix (never guesses between two), only when it is empty.
// Idempotent: a handle already imported is skipped. Restart pm2 after --apply.

import crypto from "node:crypto";
import fs from "node:fs";
import { personFieldValues } from "./0352-people-from-social-exports.mjs";

export const id = "0360-add-instagram-people";
export const describe = "Adds the Instagram people listed in PEOPLE_IG_ADD_PATH (real people not yet on the People board; brands and celebrities left out) as new people with the board's fields, and fills the Instagram handle of listed existing people.";
export const touches = ["modules", "occurrences"];

/** PURE: which listed people are new, and which attaches resolve to exactly one person. */
export function planAdd({ list, people, igFieldId }) {
  const have = new Set(people.map(o => String(o.meta?.externalId || "").toLowerCase()));
  for (const o of people) {
    const v = o.fields?.[igFieldId]?.value;
    if (typeof v === "string" && v) have.add(`ig:${v.replace(/^@/, "").toLowerCase()}`);
  }
  const add = [], seen = new Set();
  for (const p of list.add || []) {
    const key = `ig:${String(p.handle || "").toLowerCase()}`;
    if (!p.handle || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    add.push(p);
  }
  const attach = [], refused = [];
  for (const a of list.attach || []) {
    const hits = people.filter(o => String(o.meta?.externalId || "").startsWith(a.externalIdPrefix));
    if (hits.length !== 1) { refused.push(`${a.handle}: ${hits.length} people match "${a.externalIdPrefix}"`); continue; }
    if (hits[0].fields?.[igFieldId]?.value) continue;
    attach.push({ occ: hits[0], handle: a.handle });
  }
  return { add, attach, refused };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const file = process.env.PEOPLE_IG_ADD_PATH;
  if (!file || !fs.existsSync(file)) throw new Error(`PEOPLE_IG_ADD_PATH is not set or the file is missing (${file || "unset"}) — nothing done`);
  const list = JSON.parse(fs.readFileSync(file, "utf8"));

  const fields = await Field.find({ gridId }).lean();
  const byName = (name, type) => { const h = fields.filter(x => (x.name || "").toLowerCase() === name.toLowerCase() && (!type || x.type === type)); return h.length === 1 ? h[0].id : null; };
  const igFieldId = byName("Instagram", "text");
  if (!igFieldId) { log("no Instagram text field — refusing"); return; }

  const people = await Occurrence.find({ gridId, "meta.source": "social-import" }).lean();
  const ig = people.find(o => String(o.meta?.externalId || "").startsWith("ig:"));
  const exMod = ig && await Module.findOne({ gridId, id: ig.moduleId }).lean();
  if (!exMod?.fieldBindings?.length) { log("no imported Instagram person to copy the field set from — refusing"); return; }
  const board = await Occurrence.findOne({ gridId, occurrences: ig.id }).lean();
  if (!board) { log("the People board could not be found — refusing"); return; }

  // Field roles, found from the exemplar's own values — 0352's rule.
  const ex = ig.fields || {};
  const f = {
    name: Object.keys(ex).find(fid => ex[fid]?.value === exMod.label) || byName("Name"),
    library: Object.keys(ex).find(fid => ex[fid]?.value === "person") || null,
    category: Object.keys(ex).find(fid => Array.isArray(ex[fid]?.value) && ex[fid].value.includes("person")) || null,
    instagram: igFieldId,
    relationship: byName("Relationship", "select"),
    howMet: byName("How We Met", "text"),
    notes: null, fbSince: null, igSince: null,
    foundVia: byName("Found Via", "select"),
  };
  if (!f.name) { log("could not identify the Name field — refusing"); return; }

  const plan = planAdd({ list, people, igFieldId });
  log(`${(list.add || []).length} listed · ${plan.add.length} to add (${plan.add.filter(p => p.followsYou).length} mutual) · ${plan.attach.length} handle(s) to attach · ${plan.refused.length} refused`);
  for (const p of plan.add) log(`   add ${p.handle} (${p.name})${p.followsYou ? "  mutual" : ""}`);
  for (const a of plan.attach) log(`   attach ${a.handle} -> ${a.occ.meta.externalId}`);
  for (const r of plan.refused) log(`   refused ${r}`);
  if (dryRun) { log("DRY RUN — nothing written"); return; }

  const now = new Date().toISOString();
  const cell = (value) => ({ value, flow: "in", timestamp: now });
  const newMods = [], newOccs = [];
  for (const p of plan.add) {
    const modId = crypto.randomUUID(), occId = crypto.randomUUID();
    const vals = personFieldValues({ name: p.name, instagram: p.handle, followsYou: !!p.followsYou, youFollow: true }, f);
    newMods.push({ id: modId, userId: board.userId, gridId, role: "instance", label: p.name, defaultDragMode: "copy",
      fieldBindings: exMod.fieldBindings, meta: { mediaInline: true } });
    newOccs.push({ id: occId, userId: board.userId, gridId, moduleId: modId, targetId: modId, targetType: "module", parentId: board.id,
      fields: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, cell(v)])),
      occurrences: [], meta: { source: "social-import", externalId: `ig:${p.handle}` } });
  }
  if (newMods.length) {
    await Module.insertMany(newMods, { ordered: false });
    await Occurrence.insertMany(newOccs, { ordered: false });
    await Occurrence.updateOne({ gridId, id: board.id }, { $push: { occurrences: { $each: newOccs.map(o => o.id) } } });
  }
  for (const a of plan.attach) {
    await Occurrence.updateOne({ gridId, id: a.occ.id }, { $set: { [`fields.${igFieldId}`]: cell(a.handle) } });
    await Module.updateOne({ gridId, id: a.occ.moduleId, "fieldBindings.fieldId": igFieldId }, { $set: { "fieldBindings.$.hidden": false } });
  }
  log(`added ${newOccs.length} people · attached ${plan.attach.length} handle(s). Run 0359 with the CSV for their photos, then restart pm2.`);
}
