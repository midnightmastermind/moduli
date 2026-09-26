// server/migrations/0365-birthday-one-field.mjs
//
// One Birthday field, not two. 0363 put a birthday with no year into a text
// field, "Birthday (month/day)", because a date field cannot hold a month and
// day alone — so a person's birthday lived in one of two fields and the two
// read the same (user, 2026-09-26: "its confusing … both fields show the same
// thing"). The user's call: store the year-less ones in Birthday with the year
// 1900 and have the date field render 1900 without a year (client
// `ui/Field.jsx shortDate`, NO_YEAR).
//
// Per person holding a month/day value:
//   Birthday empty       → Birthday = 1900-MM-DD (the month/day is parsed:
//                          "June 27"; anything unparseable is reported, kept)
//   Birthday already set → the full date wins; the month/day is only cleared
// Then: every "Birthday (month/day)" binding is removed (a moved person gains a
// visible Birthday binding if it had none), and the field is DELETED when no
// value and no operation still names it. Restart pm2 after --apply.

export const id = "0365-birthday-one-field";
export const describe = "Moves every 'Birthday (month/day)' value into Birthday as 1900-MM-DD (rendered without a year), removes the month/day bindings and deletes that field.";
export const touches = ["modules", "occurrences", "fields"];

const MONTH = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** PURE. "June 27" → "1900-06-27"; null when it is not a month and day. */
export function noYearDate(text) {
  const m = String(text || "").trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/);
  const mo = m && (MONTH[m[1].toLowerCase()] || Object.entries(MONTH).find(([k]) => k.startsWith(m[1].toLowerCase()) && m[1].length >= 3)?.[1]);
  const d = m && +m[2];
  if (!mo || !d || d > 31) return null;
  return `1900-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field, Operation } = models;
  const fields = await Field.find({ gridId }).lean();
  const bday = fields.filter(f => f.name === "Birthday" && f.type === "date");
  const md = fields.filter(f => f.name === "Birthday (month/day)");
  if (bday.length !== 1) { log(`expected one date field "Birthday", found ${bday.length} — refusing`); return; }
  if (md.length !== 1) { log(`no single "Birthday (month/day)" field (${md.length}) — nothing to do`); return; }
  const B = bday[0].id, M = md[0].id;

  const holders = await Occurrence.find({ gridId, [`fields.${M}`]: { $exists: true } }).lean();
  const moves = [], clears = [], bad = [];
  for (const o of holders) {
    const v = o.fields?.[M]?.value;
    if (v == null || v === "") { clears.push(o); continue; }
    if (o.fields?.[B]?.value) { clears.push(o); continue; }
    const iso = noYearDate(v);
    if (!iso) { bad.push({ o, v }); continue; }
    moves.push({ o, iso });
  }
  const opsNaming = (await Operation.find({ gridId }).lean()).filter(op => JSON.stringify(op).includes(M));
  const mods = await Module.find({ gridId, "fieldBindings.fieldId": M }).lean();
  log(`${holders.length} rows hold a month/day value: ${moves.length} move into Birthday, ${clears.length} only cleared (Birthday already set or empty), ${bad.length} unparseable`);
  for (const b of bad.slice(0, 10)) log(`   unparseable, kept: ${JSON.stringify(b.v)}`);
  log(`${mods.length} modules bind it · ${opsNaming.length} operations name it`);
  if (dryRun) { log("DRY RUN — nothing written"); return; }

  const now = new Date().toISOString();
  for (const { o, iso } of moves) {
    await Occurrence.updateOne({ gridId, id: o.id }, {
      $set: { [`fields.${B}`]: { ...(o.fields?.[B] || { flow: "in" }), value: iso, timestamp: now } },
      $unset: { [`fields.${M}`]: "" },
    });
  }
  for (const o of clears) await Occurrence.updateOne({ gridId, id: o.id }, { $unset: { [`fields.${M}`]: "" } });

  const movedModules = new Set(moves.map(x => x.o.moduleId));
  for (const m of mods) {
    let next = (m.fieldBindings || []).filter(b => b.fieldId !== M);
    if (movedModules.has(m.id)) {
      const hasB = next.find(b => b.fieldId === B);
      if (!hasB) next.push({ fieldId: B, role: "input", order: Math.max(0, ...next.map(b => b.order ?? 0)) + 1 });
      else if (hasB.hidden) next = next.map(b => (b.fieldId === B ? { ...b, hidden: false } : b));
    }
    await Module.updateOne({ gridId, id: m.id }, { $set: { fieldBindings: next } });
  }
  const left = await Occurrence.countDocuments({ gridId, [`fields.${M}`]: { $exists: true } });
  if (!left && !opsNaming.length) {
    await Field.deleteOne({ gridId, id: M });
    log(`deleted the "Birthday (month/day)" field`);
  } else {
    log(`kept the field: ${left} value(s) left, ${opsNaming.length} op(s) naming it`);
  }
  log(`moved ${moves.length}. Restart the server (pm2) so the warm cache serves it.`);
}
