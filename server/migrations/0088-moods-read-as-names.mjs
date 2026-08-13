// server/migrations/0088-moods-read-as-names.mjs
//
// User, 2026-08-12, on the deployed build: "the moods are just showing ids and
// thats using a journal prompt instead of a checkin. journal shouldnt have mood."
// / "also the moods tracker isnt updating".
//
// TWO CAUSES, and the field config is the first. Every other occurrence-typed
// field on this grid declares where the name and the id live:
//
//   Meal / Ingredient / Purchase Item / Beverage   labelPath "label"  valuePath "id"
//   Mood                                           NEITHER
//
// With no `labelPath` the resolver has nothing to read a name from and falls back
// to the id — so the option list came back as `3c5d0c48 = "3c5d0c48-7dc0-…"` and
// every mood rendered as a raw id, in the row AND in the tracker, which share the
// field. Measured through the REAL resolver over live data. Emotion names live on
// the MODULE (`occ.label` is null, `module.label` is "Happy") and `buildCollection`
// already merges that in, so "label" is the correct path — the same one the four
// working fields use.
//
// AND THE LIST WAS TRUNCATED: 129 emotions, no `limit`, so the resolver's default
// cap of 100 applied and 29 of them could not resolve to anything at all. An
// explicit limit above the real count fixes the ids that were missing entirely
// rather than merely mislabelled.
//
// THE JOURNAL LOSES MOOD, which is the user's call and retracts mine. 0085 kept
// the journal write on the grounds that it was a visible record worth keeping;
// the user says the journal should not carry a mood at all, and they are right
// that it was the source of the confusion — two visible rows holding the same
// fact, one of them a journal prompt. The Check In is the record now, which is
// what 0087 already made the truth.
//
// NOTHING GOES DARK IN THE PROCESS. Stripping the journal would unlight every
// mood recorded before Check Ins existed, so each journal mood WITHOUT a Check In
// on its day gets one first. Order matters: backfill, verify, then clear.
import { randomUUID as uuid } from "node:crypto";

export const id = "0088-moods-read-as-names";
export const describe =
  "Moods render as names, every emotion resolves, and the journal stops carrying a Mood.";

/** PURE — the options config an occurrence field needs to render names. */
export function moodOptionsSource(existing, { limit }) {
  const src = existing || {};
  const inner = src.find ? { ...src.find } : src;
  const next = {
    ...inner,
    // The four working occurrence fields on this grid use exactly these.
    labelPath: "label",
    valuePath: "id",
    // Above the real count — the default cap silently truncated the list.
    limit,
  };
  return src.find ? { ...src, find: next } : next;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));

  const moodField = fields.find((f) => f.name === "Mood");
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  if (!moodField || !dateField) {
    log(`REFUSING: Mood=${!!moodField} Date=${!!dateField} — nothing written.`);
    return;
  }

  // ---- 1. the field renders names -----------------------------------------
  const board = occs.find((o) => (o.label ?? modById.get(o.moduleId)?.label) === "Emotions");
  const emotionCount = (board?.occurrences || []).length;
  const limit = Math.max(500, emotionCount * 2);
  const nextSource = moodOptionsSource(moodField.meta?.optionsSource, { limit });
  const cfg = nextSource.find || nextSource;
  log(`Mood options: labelPath=${JSON.stringify(cfg.labelPath)} valuePath=${JSON.stringify(cfg.valuePath)} ` +
    `limit=${cfg.limit} (was labelPath=${JSON.stringify(
      (moodField.meta?.optionsSource?.find || moodField.meta?.optionsSource || {}).labelPath)}, ` +
    `${emotionCount} emotions on the board)`);

  // ---- 2. the journal stops carrying a mood --------------------------------
  const journalMods = mods.filter(
    (m) => /journal/i.test(m.label || "") &&
      (m.fieldBindings || []).some((b) => b.fieldId === moodField.id));
  const journalOccs = occs.filter((o) => journalMods.some((m) => m.id === o.moduleId));
  const carrying = journalOccs.filter((o) => {
    const v = o.fields?.[moodField.id]?.value;
    return Array.isArray(v) && v.length;
  });
  log(`journal modules binding Mood: ${journalMods.length} · occurrences carrying a value: ${carrying.length}`);

  // ---- 3. nothing goes dark: backfill a Check In per orphaned mood ---------
  const checkInMod = mods.find((m) => /^check ?in$/i.test(m.label || "") && m.role === "instance");
  const checkInSrc = checkInMod && occs.find((o) => o.moduleId === checkInMod.id);
  const checkInOccs = checkInMod ? occs.filter((o) => o.moduleId === checkInMod.id) : [];
  const dayOf = (v) => (typeof v === "string" ? v.slice(0, 10) : null);

  const plan = [];
  for (const j of carrying) {
    const day = dayOf(j.fields?.[dateField.id]?.value);
    if (!day) continue;
    // Which parent should hold it — reuse whatever already hosts that day's
    // Check Ins, so a backfilled row lands where a clicked one would.
    const sibling = checkInOccs.find((c) => dayOf(c.fields?.[dateField.id]?.value) === day);
    const host = sibling
      ? occs.find((p) => (p.occurrences || []).includes(sibling.id))
      : occs.find((p) => dayOf(p.fields?.[dateField.id]?.value) === day &&
          (p.occurrences || []).length > 3);
    for (const moodId of j.fields[moodField.id].value) {
      const covered = checkInOccs.some((c) =>
        dayOf(c.fields?.[dateField.id]?.value) === day &&
        (c.fields?.[moodField.id]?.value || []).includes(moodId));
      if (covered) continue;
      if (!host) {
        log(`  NOTE: ${String(moodId).slice(0, 8)} on ${day} has no Check In and no host to put one in — ` +
          `LEAVING the journal value alone rather than losing it.`);
        continue;
      }
      plan.push({ day, moodId, hostId: host.id, journalId: j.id });
    }
  }
  log(`backfill: ${plan.length} Check In(s) to mint so no recorded mood goes dark`);
  for (const p of plan.slice(0, 12)) {
    log(`   ${p.day}  ${String(modById.get(byId.get(p.moodId)?.moduleId)?.label || p.moodId).slice(0, 18)}` +
      ` -> ${String(byId.get(p.hostId)?.label ?? modById.get(byId.get(p.hostId)?.moduleId)?.label ?? p.hostId).slice(0, 24)}`);
  }

  // A journal is only cleared once every one of its moods is covered.
  const clearable = carrying.filter((j) => {
    const day = dayOf(j.fields?.[dateField.id]?.value);
    if (!day) return false;
    return (j.fields[moodField.id].value || []).every((moodId) =>
      plan.some((p) => p.journalId === j.id && p.moodId === moodId) ||
      checkInOccs.some((c) => dayOf(c.fields?.[dateField.id]?.value) === day &&
        (c.fields?.[moodField.id]?.value || []).includes(moodId)));
  });
  log(`journals safe to clear: ${clearable.length} of ${carrying.length}`);

  if (dryRun) {
    log(`WOULD set the Mood options config, mint ${plan.length} Check In(s), clear ${clearable.length} ` +
      `journal value(s) and unbind Mood from ${journalMods.length} journal module(s).`);
    return;
  }

  await Field.updateOne({ gridId, id: moodField.id },
    { $set: { "meta.optionsSource": nextSource } });

  for (const p of plan) {
    const newId = uuid();
    await Occurrence.create({
      id: newId, gridId, userId: checkInSrc?.userId,
      moduleId: checkInMod.id, parentId: p.hostId,
      fields: {
        [dateField.id]: { value: p.day, flow: "in" },
        [moodField.id]: { value: [p.moodId], flow: "in" },
      },
      occurrences: [],
    });
    await Occurrence.updateOne({ gridId, id: p.hostId },
      { $push: { occurrences: newId } });
  }

  for (const j of clearable) {
    await Occurrence.updateOne({ gridId, id: j.id },
      { $unset: { [`fields.${moodField.id}`]: "" } });
  }
  for (const m of journalMods) {
    await Module.updateOne({ gridId, id: m.id },
      { $set: { fieldBindings: (m.fieldBindings || []).filter((b) => b.fieldId !== moodField.id) } });
  }
  log(`moods read as names; the journal no longer carries one.`);
}
