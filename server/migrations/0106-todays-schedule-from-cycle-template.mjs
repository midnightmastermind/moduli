// server/migrations/0106-todays-schedule-from-cycle-template.mjs
//
// User, 2026-08-13: "change todays to match the new templates" — and, asked
// which day of the 4-day cycle today is, chose **Day 1 (Push)**.
//
// IT PLACES ITEMS INTO THE SLOTS THAT ALREADY EXIST. It does NOT re-apply a
// whole template, and that is the whole design. `Schedule: Build Schedule`
// matches a day's slots by `meta.copyLinkSource IS <the template slot's id>`
// — an identity tied to ONE template's occurrence ids. Today's 49 slots are
// COPY_LINK copies of the ORIGINAL "Day" template, so applying a cycle
// template over them would match nothing and copy in 49 DUPLICATE slots
// beside the real ones. The slots are right already; only their contents are
// missing.
//
// SLOTS ARE MATCHED ON THE `Time Slot` VALUE, not on label or position. Both
// sides carry it, it is what the build op stamps, and it is what a slot
// actually IS — "7:00am" is the same slot whichever template minted it.
//
// SCOPED TO ONE NAMED DATE, deliberately. Resolving "today" at run time would
// mean a re-run tomorrow silently placed Day 1 into tomorrow as well. Every
// future day is the rotation op's job; this migration repairs the one column
// the user was looking at.
//
// WHAT IT WILL NOT TOUCH:
//   - the Todo rows ("Sign up for peer support mentor class", "Talk to Angela
//     about Vivance") — the user's own work, in a slot the template leaves empty
//   - the four "Peer Support Group - Froedtert" appointments at 6:00-7:30pm —
//     real appointments; a slot holds any number of items, so the template's
//     7:00pm meal lands beside the appointment rather than instead of it
//   - anything already in a slot, matched by label, so a re-run adds nothing
//
// THE ONE REMOVAL IS "Exercise" AT 5:00pm, and it is 0104's reason carried
// through to live data: the cycle templates drop the generic Exercise because
// the workout now has REAL movements at 7:00am, and leaving a generic Exercise
// beside them double-counts in every workout tracker. It is removed ONLY when
// it carries nothing the user entered — a ticked Completed is a record of a
// workout that happened, and deleting that is data loss, not tidying.
import { randomUUID } from "node:crypto";

export const id = "0106-todays-schedule-from-cycle-template";
export const describe =
  "Today's schedule column (2026-08-13) gets the Day 1 cycle template's meals and movements.";

export const TARGET_DATE = "2026-08-13";
export const CYCLE_TEMPLATE = "Schedule - Day 1";
// Dropped from a cycle day because real movements replace it — see the header.
export const DROP_AT = [["5:00pm", "exercise"]];

const norm = (s) => String(s ?? "").trim().toLowerCase();

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";

  // Fields resolve by name AND type — this grid has more than one field called
  // "Date", and picking the display twin would stamp a day's total onto a row.
  const TS = fields.find((f) => f.name === "Time Slot")?.id;
  const DATE = fields.find((f) => f.name === "Date" && !f.displayEnabled)?.id;
  const FMT = fields.find((f) => f.name === "Schedule Format")?.id;
  if (!TS || !DATE || !FMT) { log(`REFUSING: missing Time Slot / Date / Schedule Format field.`); return; }

  const col = occs.find(
    (o) => o.fields?.[FMT]?.value === "day-col" &&
      String(o.fields?.[DATE]?.value ?? "").slice(0, 10) === TARGET_DATE,
  );
  if (!col) { log(`REFUSING: no schedule day column dated ${TARGET_DATE}.`); return; }

  const tplMod = mods.find((m) => m.label === CYCLE_TEMPLATE && m.meta?.templateModule === true);
  const tpl = tplMod ? occs.find((o) => o.moduleId === tplMod.id) : null;
  if (!tpl) { log(`REFUSING: no template module "${CYCLE_TEMPLATE}".`); return; }

  // Index both sides by the slot's Time Slot value.
  const slotsBy = (root) => {
    const m = new Map();
    for (const sid of root.occurrences || []) {
      const s = byId.get(sid);
      if (!s) continue;
      const key = s.fields?.[TS]?.value;
      if (key) m.set(String(key), s);
    }
    return m;
  };
  const daySlots = slotsBy(col);
  const tplSlots = slotsBy(tpl);

  const adds = [];
  for (const [key, tSlot] of tplSlots) {
    const items = (tSlot.occurrences || []).map((i) => byId.get(i)).filter(Boolean);
    if (!items.length) continue;
    const dSlot = daySlots.get(key);
    if (!dSlot) { log(`  REFUSING slot ${key} — today's column has no such slot`); continue; }
    const present = new Set(
      (dSlot.occurrences || []).map((i) => norm(nameOf(byId.get(i)))),
    );
    for (const it of items) {
      if (present.has(norm(nameOf(it)))) continue;
      adds.push({ key, dSlot, src: it, label: nameOf(it) });
      present.add(norm(nameOf(it)));
    }
  }

  // The one removal, guarded: only a row the user has not touched.
  const drops = [];
  for (const [key, label] of DROP_AT) {
    const dSlot = daySlots.get(key);
    if (!dSlot) continue;
    for (const id2 of dSlot.occurrences || []) {
      const kid = byId.get(id2);
      if (!kid || norm(nameOf(kid)) !== norm(label)) continue;
      // Anything beyond the two stamps the builder writes is the user's.
      const own = Object.entries(kid.fields || {})
        .filter(([fid, v]) => fid !== TS && fid !== DATE &&
          v?.value !== null && v?.value !== undefined && v?.value !== "" &&
          !(Array.isArray(v.value) && v.value.length === 0));
      const kids = (kid.occurrences || []).length;
      if (own.length || kids) {
        log(`  KEEPING "${nameOf(kid)}" at ${key} — it carries ${own.length} value(s), ${kids} child(ren)`);
        continue;
      }
      drops.push({ key, occ: kid });
    }
  }

  log(`column "${nameOf(col)}"  ${daySlots.size} slots · template "${CYCLE_TEMPLATE}" ${tplSlots.size} slots`);
  const bySlot = new Map();
  for (const a of adds) bySlot.set(a.key, [...(bySlot.get(a.key) || []), a.label]);
  for (const [k, v] of bySlot) log(`  + ${String(k).padEnd(9)} ${v.join(", ")}`);
  for (const d of drops) log(`  - ${String(d.key).padEnd(9)} ${nameOf(d.occ)}  (carries nothing entered)`);
  if (!adds.length && !drops.length) { log(`today already matches ${CYCLE_TEMPLATE} — no change.`); return; }
  if (dryRun) { log(`WOULD add ${adds.length} row(s) and remove ${drops.length}.`); return; }

  const userId = col.userId;
  const perSlot = new Map();
  for (const a of adds) {
    const srcMod = modById.get(a.src.moduleId);
    // Clone the module the way APPLY_TEMPLATE does, so a placed row carries its
    // own bindings and behaves like every other row the build op puts here.
    const nMod = randomUUID(), nOcc = randomUUID();
    await Module.create({
      id: nMod, gridId, userId, label: a.label,
      role: srcMod?.role || "instance",
      fieldBindings: srcMod?.fieldBindings || [],
      meta: { ...(srcMod?.meta || {}) },
      ownStyle: srcMod?.ownStyle || null,
      styleMode: srcMod?.styleMode || "inherit",
    });
    await Occurrence.create({
      id: nOcc, gridId, userId, moduleId: nMod, targetId: nMod,
      parentId: a.dSlot.id, occurrences: [],
      // The source's own values are the prescription (muscle group, set counts,
      // macros); the two stamps are what makes the row visible to the date
      // filter and to every timeslot-scoped tracker.
      fields: {
        ...(a.src.fields || {}),
        [TS]: { value: a.key, flow: "in" },
        [DATE]: { value: TARGET_DATE, flow: "in" },
      },
      meta: { appliedFromTemplateId: a.src.id },
    });
    perSlot.set(a.dSlot.id, [...(perSlot.get(a.dSlot.id) || []), nOcc]);
  }
  for (const [slotId, ids] of perSlot) {
    await Occurrence.updateOne({ gridId, id: slotId }, { $push: { occurrences: { $each: ids } } });
  }
  for (const d of drops) {
    await Occurrence.updateOne({ gridId, id: d.occ.parentId }, { $pull: { occurrences: d.occ.id } });
    await Occurrence.deleteOne({ gridId, id: d.occ.id });
  }
  log(`placed ${adds.length} row(s), removed ${drops.length}.`);
}
