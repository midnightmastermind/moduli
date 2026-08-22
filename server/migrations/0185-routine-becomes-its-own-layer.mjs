/**
 * 0185 — the daily routines move to a `Routine` LAYER; `Day` keeps only the timeslots.
 *
 * USER, 2026-08-22: *"why dont you move those routines to Routine template and then keep Day as
 * the timeslots"* — *"only"* — and, framing the whole shape: *"we should have a build schedule
 * that builds the initial schedule and then a fill day which fills it with the meal, workout, and
 * routine template"*.
 *
 * ── THAT SEPARATION ALREADY EXISTS IN THE OPS; ONLY THE DATA WAS FUSED ───────────────────────
 *
 * `Build Schedule` mints the day column and COPY_LINKs `Day`'s 49 slots. `Place Weekday` (renamed
 * `Fill Day` in the same pass) then merges EVERY template whose `Weekday` contains the day —
 * that is `0177`'s work, and it already gives Meals and the four workout sessions a layer each.
 * The routines were the one thing still living inside the structural template.
 *
 * **And it changes when they are placed, which is a real improvement rather than a side effect.**
 * Read from Build Schedule's own pipeline: it places a slot's rows ONLY in the branch where the
 * slot did not already exist —
 *
 *     FIND slot copy (copyLinkSource IS $tplChildId AND parentId IS $dayColId)
 *     IF EMPTY    COPY_LINK the slot, then APPLY_TEMPLATE each of its rows
 *     ELSE        ADD_CHILD (re-link only)
 *
 * so a routine deleted from an existing column never came back. On the Routine layer it is merged
 * every load, exactly as meals and workouts already are, so the column self-heals and a routine
 * ADDED to the template appears on columns that were built before it existed.
 *
 * ── THE ONE THING THAT WOULD HAVE DUPLICATED EVERY ROUTINE, MEASURED BEFORE WRITING ──────────
 *
 * Merge decides "this already exists" by `identitySignature`, falling back to `auto:<sourceId>`
 * for a node nobody hand-signed (`operationActions.js`, and the comment there records the 23
 * duplicate Daily Question wrappers this produced in one day). The clone is stamped with that
 * signature — **but only since 2026-08-07, and today's routines predate it:**
 *
 *     today's column, 7 routine rows        identitySignature = null
 *     each carries meta.appliedFromTemplateId -> the Day-template row it came from
 *     merge will look for                     "auto:<that same id>"
 *     the Meals rows beside them, for contrast  "cycle:Greek Yogurt Bowl"  <- signed, safe
 *
 * So the first `Routine` merge would have found no match and cloned a SECOND Drink, Hygiene, Hot
 * Tub, Take Medication ×2, Walk and Journal onto today's column. This migration therefore stamps
 * each placed row with the signature merge is about to compute — **derived from that row's OWN
 * `meta.appliedFromTemplateId`, never guessed** — so the first merge matches instead of cloning.
 *
 * ── IT MOVES THE ROWS RATHER THAN RE-CREATING THEM, and that is what keeps the ids stable ────
 *
 * The 7 source rows keep their occurrence ids, so `auto:<sourceId>` is the same string before and
 * after. Re-minting them would change every id and strand the stamps this migration just wrote.
 *
 * ── ROUTINE GETS ALL 49 SLOTS, SHARING `Day`'s SLOT MODULES ─────────────────────────────────
 *
 * Only four slots hold anything today, but a template you cannot drag a routine INTO at 3:00pm is
 * a template with four usable rows. Every other layer carries all 49, so this one does too. The
 * slot MODULES are shared rather than copied — a module is a template and two occurrences may
 * share one, which is the app's own model — so this costs 49 occurrences and **zero new modules**.
 * Nothing keys on slot module identity: `Build Schedule` matches `meta.copyLinkSource` (an
 * occurrence id) and `Fill Day` matches the `Time Slot` VALUE.
 *
 * ── REFUSALS ───────────────────────────────────────────────────────────────────────────────
 *
 * Refuses if a `Routine` template already exists (idempotence), if `Day` carries no routine rows
 * (already run), or if any Day slot holding a row has no `Time Slot` value — that last one would
 * silently produce a slot `Fill Day` can never match, and it is the defect `0183` fixed hours ago.
 */
export const id = "0185-routine-becomes-its-own-layer";
export const describe =
  "Move the 7 daily routines off the `Day` template onto a new `Routine` layer claiming all seven weekdays; Day keeps its 49 slots, now empty. Deletes nothing.";

const TS = "nSccAtADyUGW";  // Time Slot
const SF = "vQ0ELZP_zxnx";  // Schedule Format
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const uid = () => Math.random().toString(36).slice(2, 14);

/** The signature `mergeSubtreeInto` will compute for a clone of `sourceId`. */
export function mergeSignatureFor(sourceOcc) {
  return sourceOcc?.identitySignature || (sourceOcc?.id ? `auto:${sourceOcc.id}` : null);
}

/**
 * Every occurrence reachable by walking DOWN from the grid's roots.
 *
 * The stamp must not be sprayed over dead rows. Checking the first dry run against a NAMED
 * expectation is what caught it: I predicted 7 — today's column — and it reported **25**. The
 * other 18 sit under parents that no longer resolve (deleted day columns, and the debris the
 * `0181` dedupe left). Stamping them is harmless, since nothing merges into a dead parent, but
 * "harmless" is not a reason to write to 18 rows nobody can see, and a count I could not explain
 * is exactly the 2026-08-03 `0035` trap — a selector that matches the wrong thing CONFIDENTLY.
 */
export function reachableIds(occs, rootIds) {
  // MY FIRST DEFINITION WAS WRONG AND THE DRY RUN SAID SO: I seeded the walk with "every
  // occurrence nothing lists", which makes an ORPHAN its own root — so all 25 came back
  // reachable and the scoping did nothing. Reachability has to start at the grid's real
  // roots (its panels), or the word means nothing.
  const byId = new Map(occs.map((o) => [o.id, o]));
  const seen = new Set();
  const walk = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    for (const k of byId.get(id)?.occurrences || []) walk(k);
  };
  for (const r of rootIds || []) walk(r);
  return seen;
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const WD = fields.find((f) => f.name === "Weekday")?.id;
  if (!WD) { log("  REFUSING: no `Weekday` field on this grid"); return; }

  // The Schedule Template page is the parent every existing layer shares.
  const day = occs.find((o) => nameOf(o) === "Day" && (o.occurrences || []).length > 40);
  if (!day) { log("  REFUSING: no `Day` template with a full slot list"); return; }
  const tplPage = occById.get(day.parentId);
  if (!tplPage) { log("  REFUSING: the Day template has no parent page"); return; }

  const existing = (tplPage.occurrences || []).map((i) => occById.get(i)).find((o) => nameOf(o) === "Routine");
  if (existing) { log(`  a \`Routine\` layer already exists (${existing.id}) — nothing to do`); return; }

  // What moves, and the refusal that protects `Fill Day` from a slot it can never match.
  const moving = [];
  for (const sid of day.occurrences || []) {
    const slot = occById.get(sid);
    if (!slot) continue;
    for (const rid of slot.occurrences || []) {
      const row = occById.get(rid);
      if (row) moving.push({ row, slot });
    }
  }
  if (!moving.length) { log("  the Day template carries no rows — already moved"); return; }
  const unmatched = moving.filter(({ slot }) => !slot.fields?.[TS]?.value);
  if (unmatched.length) {
    log(`  REFUSING: ${unmatched.length} slot(s) holding a row carry no Time Slot value — Fill Day could never match them`);
    return;
  }
  log(`  ${moving.length} routine row(s) to move:`);
  for (const { row, slot } of moving)
    log(`    ${String(slot.fields[TS].value).padEnd(9)} ${nameOf(row)}  (${row.id})`);

  // ── the stamps that stop the first merge duplicating everything ──────────────────
  const srcIds = new Set(moving.map(({ row }) => row.id));
  const candidates = occs.filter((o) =>
    !o.identitySignature && srcIds.has(o.meta?.appliedFromTemplateId));
  const reachable = reachableIds(occs, grid?.occurrences || []);
  const toStamp = candidates.filter((o) => reachable.has(o.id));
  const dead = candidates.filter((o) => !reachable.has(o.id));
  log(`  ${toStamp.length} LIVE placed row(s) are UNSIGNED and would be cloned again — stamping:`);
  for (const o of toStamp) {
    const slot = occs.find((p) => (p.occurrences || []).includes(o.id));
    log(`    ${String(slot?.fields?.[TS]?.value ?? "?").padEnd(9)} ${String(nameOf(o)).padEnd(18)} -> "${mergeSignatureFor(occById.get(o.meta.appliedFromTemplateId))}"`);
  }
  if (dead.length)
    log(`  ${dead.length} more carry the same shape but are UNREACHABLE — dead columns and 0181 debris. Left alone, reported: ${dead.map((o) => o.id).join(", ")}`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const o of toStamp) {
    const sig = mergeSignatureFor(occById.get(o.meta.appliedFromTemplateId));
    if (sig) await Occurrence.updateOne({ id: o.id, gridId }, { $set: { identitySignature: sig } });
  }

  // ── the Routine layer, mirroring the shape every other layer already has ─────────
  const dayMod = modById.get(day.moduleId);
  const routineModId = uid();
  await Module.create({
    id: routineModId, userId: day.userId, gridId,
    role: "container", kind: "board", label: "Routine",
    meta: { templateModule: true, allowChildContainers: true },
    iteration: dayMod?.iteration ?? { mode: "inherit", timeFilter: "daily" },
    fieldBindings: [{ fieldId: WD, order: 0, role: "input" }],
  });
  const routineId = uid();
  await Occurrence.create({
    id: routineId, userId: day.userId, gridId, moduleId: routineModId,
    label: "Routine", parentId: tplPage.id, occurrences: [],
    identitySignature: day.identitySignature || "day-container",
    fields: { [WD]: { value: [...DAYS] } }, meta: {},
  });

  // one slot occurrence per Day slot, in the same clock order, SHARING the slot's module
  const slotIdFor = new Map();
  const newSlotIds = [];
  for (const sid of day.occurrences || []) {
    const src = occById.get(sid);
    if (!src) continue;
    const nid = uid();
    await Occurrence.create({
      id: nid, userId: src.userId, gridId, moduleId: src.moduleId,
      label: src.label ?? null, parentId: routineId, occurrences: [],
      identitySignature: src.identitySignature || null,
      fields: {
        ...(src.fields?.[TS] ? { [TS]: { value: src.fields[TS].value, flow: "in" } } : {}),
        ...(src.fields?.[SF] ? { [SF]: { value: src.fields[SF].value, flow: "in" } } : {}),
      },
      meta: src.meta?.slotLabel ? { slotLabel: src.meta.slotLabel } : {},
    });
    slotIdFor.set(sid, nid);
    newSlotIds.push(nid);
  }
  await Occurrence.updateOne({ id: routineId, gridId }, { $set: { occurrences: newSlotIds } });
  await Occurrence.updateOne({ id: tplPage.id, gridId }, { $push: { occurrences: routineId } });

  // ── move the rows: unlist from Day's slot, re-parent, list under Routine's ───────
  for (const { row, slot } of moving) {
    const target = slotIdFor.get(slot.id);
    await Occurrence.updateOne({ id: slot.id, gridId }, { $pull: { occurrences: row.id } });
    await Occurrence.updateOne({ id: row.id, gridId }, { $set: { parentId: target } });
    await Occurrence.updateOne({ id: target, gridId }, { $addToSet: { occurrences: row.id } });
  }

  log(`  Routine layer ${routineId} created with ${newSlotIds.length} slots, Weekday = all seven`);
  log(`  Day now holds ${day.occurrences.length} slots and 0 rows`);
  log("  written — RESTART pm2 and reload.");
}
