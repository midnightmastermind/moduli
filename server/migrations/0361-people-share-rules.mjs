// server/migrations/0361-people-share-rules.mjs
//
// Share a person to Moduli and they land on the People board (user,
// 2026-09-25: "id like to be able to share profile to moduli and it add it to
// the people board" · "only do vcf files. unless you can follow profile links
// to grab the info" · "if its in the custom rule, do a merge if the name is
// like one in my system, from the vcard … make that a part of the rule").
//
// Two ordinary share rules (the Imports tab shows and edits them):
//
//   Share: add contact   (.vcf)  FIND a person on the board whose name is the
//                                 SAME_TEXT as the card's (case/accents/
//                                 punctuation ignored); CREATE with
//                                 `mergeInto` that match — so a known person is
//                                 FILLED (empty fields, photo added beside the
//                                 existing one) and a new name is added.
//   Share: add profile   (Instagram / Facebook / TikTok link) — always a new
//                                 person: name + photo read off the page, the
//                                 handle in Instagram (for Instagram), the
//                                 profile in Website.
//
// Each new person gets the board's own field set (`bindingsLike` an existing
// imported person), the photo as their cover, `mediaInline` like 0358. Fields
// are found by NAME on this grid and the migration refuses if a required one is
// missing or ambiguous. Idempotent: an existing rule of the same name is
// rewritten only if nobody edited it (`meta.userEdited`).

import crypto from "node:crypto";

export const id = "0361-people-share-rules";
export const describe = "Adds two share rules: a shared contact card (.vcf) merges into the person with the same name or adds a new person; a shared Instagram/Facebook/TikTok profile link adds a new person with their name and photo.";
export const touches = ["operations"];

const step = (config) => ({ id: crypto.randomUUID(), type: "action", config });
const halt = () => step({ type: "SET_VAR", name: "$share.handled", value: "true" });

/** PURE: the two rules' pipelines. `f` maps role → field id. */
export function buildPeopleShareRules({ boardId, likeModuleId, f }) {
  const base = {
    type: "CREATE", role: "instance", name: "$share.person.name",
    parent: `literal:${boardId}`, bindingsLike: `literal:${likeModuleId}`,
    moduleMeta: { mediaInline: true },
  };
  const photo = { [f.media]: "$share.person.photoOccurrenceId", [f.files]: "$share.person.photoIds" };
  const tag = f.library ? { [f.library]: "literal:person" } : {};

  const contact = { steps: [
    step({ type: "FIND", over: "$allInstances", itemIdVar: "$matchId", itemVar: "$match",
      predicate: { operator: "AND", rules: [
        { left: "parentId", comparator: "IS", right: `literal:${boardId}` },
        { left: "label", comparator: "SAME_TEXT", right: "$share.person.name" },
      ] } }),
    step({ ...base, mergeInto: "$matchId", itemIdVar: "$personId", fields: {
      [f.name]: "$share.person.name", [f.phone]: "$share.person.phone", [f.email]: "$share.person.email",
      ...(f.birthday ? { [f.birthday]: "$share.person.birthday" } : {}),
      ...(f.company ? { [f.company]: "$share.person.company" } : {}),
      ...(f.jobTitle ? { [f.jobTitle]: "$share.person.jobTitle" } : {}),
      ...photo, ...tag,
    } }),
    halt(),
  ] };

  const common = { [f.name]: "$share.person.name", [f.website]: "$share.person.profileUrl",
    ...(f.foundVia ? { [f.foundVia]: "$share.person.foundVia" } : {}), ...photo, ...tag };
  const profile = { steps: [
    { id: crypto.randomUUID(), type: "if",
      condition: { operator: "AND", rules: [{ left: "$share.person.network", comparator: "IS", right: "literal:instagram" }] },
      then: [step({ ...base, itemIdVar: "$personId", fields: { ...common, [f.instagram]: "$share.person.handle" } })],
      else: [step({ ...base, itemIdVar: "$personId", fields: common })] },
    halt(),
  ] };

  return [
    { name: "Share: add contact", shareType: "contact", pipeline: contact },
    { name: "Share: add profile", shareType: "profile", pipeline: profile },
  ];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field, Operation } = models;
  const fields = await Field.find({ gridId }).lean();
  const byName = (name) => { const h = fields.filter(x => (x.name || "").toLowerCase() === name.toLowerCase()); return h.length === 1 ? h[0].id : null; };

  const person = await Occurrence.findOne({ gridId, "meta.source": "social-import", "meta.externalId": /^ig:/ }).lean();
  if (!person) { log("no imported person to model new people on — refusing"); return; }
  const like = await Module.findOne({ gridId, id: person.moduleId }).lean();
  const board = await Occurrence.findOne({ gridId, occurrences: person.id }).lean();
  if (!like || !board) { log("could not find the People board — refusing"); return; }
  const role = (r) => (like.fieldBindings || []).find(b => b.role === r)?.fieldId || null;

  const f = {
    name: byName("Name"), phone: byName("Phone"), email: byName("Email"), birthday: byName("Birthday"),
    company: byName("Company"), jobTitle: byName("Job Title"), website: byName("Website"),
    instagram: fields.find(x => x.name === "Instagram" && x.type === "text")?.id || null,
    foundVia: byName("Found Via"), library: byName("Library"),
    media: role("media"), files: role("files"),
  };
  const required = ["name", "phone", "email", "website", "instagram", "media", "files"];
  const missing = required.filter(k => !f[k]);
  if (missing.length) { log(`missing or ambiguous fields: ${missing.join(", ")} — refusing`); return; }

  const rules = buildPeopleShareRules({ boardId: board.id, likeModuleId: like.id, f });
  log(`People board ${board.id} · new people modelled on "${like.label}" (${like.fieldBindings.length} fields)`);
  for (const r of rules) {
    const existing = await Operation.findOne({ gridId, name: r.name }).lean();
    if (existing?.meta?.userEdited) { log(`   ${r.name}: edited by you — left alone`); continue; }
    log(`   ${existing ? "UPDATE" : "CREATE"} ${r.name} (shares of type "${r.shareType}")`);
    if (dryRun) continue;
    const doc = {
      name: r.name, enabled: true, priority: 10, triggerType: "onShare",
      triggerObjects: [{ eventType: "onShare", shareType: r.shareType }],
      pipeline: r.pipeline, meta: { ...(existing?.meta || {}), seededBy: id },
    };
    if (existing) await Operation.updateOne({ gridId, id: existing.id }, { $set: doc });
    else await Operation.create({ id: crypto.randomUUID(), userId: board.userId, gridId, ...doc });
  }
  if (dryRun) log("DRY RUN — nothing written");
  else log("done. Restart the server (pm2) so the warm cache serves it.");
}
