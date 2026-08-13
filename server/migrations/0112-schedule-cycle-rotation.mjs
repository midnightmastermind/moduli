// server/migrations/0112-schedule-cycle-rotation.mjs
//
// User, 2026-08-13: "please continue with hooking up the rotation."
//
// Every day built now picks its own cycle template — Day 1 -> 2 -> 3 -> 4 -> 1 —
// without anyone applying one by hand.
//
// ============================================================================
// IT DOES NOT ROTATE THE TEMPLATE `Schedule: Build Schedule` APPLIES, and that
// is the central decision. That op resolves its template ONCE at step [2],
// outside the per-day loop, and matches a day's slots by
// `meta.copyLinkSource IS <that template's slot id>` — an identity tied to ONE
// template's occurrence ids. Point it at a different template and it matches
// nothing and copies in 49 DUPLICATE slots per day. So Build Schedule keeps
// owning the SLOTS (and the daily routines), and this new op owns the
// CONTENTS: it places the cycle day's items into the slots that already exist.
//
// ============================================================================
// IDEMPOTENCE COMES FROM `identitySignature` + `mode: "merge"`, not from
// dedupe logic written in pipeline JSON. APPLY_TEMPLATE's merge skips a node
// when a sibling under the target already carries the same signature. So this
// migration SIGNS every item in the four cycle templates — and signs today's
// ALREADY-PLACED rows with the same scheme, or the first run would clone a
// second copy of all seventeen beside them.
//
// ============================================================================
// THE CYCLE POSITION IS STORED, NOT COMPUTED, because the pipeline has no
// modulo. A day column carries `Cycle Day` ("Day 1".."Day 4"); when it has
// none, the op advances a marker and stamps it. **The stored value is what
// makes a rebuild stable** — re-running for a day that already has one reuses
// it instead of advancing, so the sequence cannot drift every time the page
// reloads.
//
// The value is TEXT ("Day 1"), not a number: a rule's `right` is a string, and
// comparing it against a stored number is exactly the kind of loose-equality
// guess this file has been burned by. String in, string compared.
//
// The marker is the EXISTING "Last Opened" grid marker occurrence, carrying one
// more field value. It is unbound there deliberately — this is internal
// sequence state, not something to render as a tracker tile.
//
// ============================================================================
// THE TRIGGER SURFACE IS MIRRORED FROM `Schedule: Build Schedule` AT RUN TIME
// rather than restated, so the two cannot drift about when a day gets built vs
// filled — and the op runs at a LOWER priority so it always follows it: there
// is nothing to fill until the slots exist.
//
// NOT VERIFIED, AND IT IS THE HONEST GAP: no day has rolled over with this
// live. Today is stamped "Day 1" and the marker with it, so the next new column
// is Day 2 — but that only proves out at midnight.
import { randomUUID } from "node:crypto";
import { CYCLE } from "./0104-four-day-cycle-templates.mjs";

export const id = "0112-schedule-cycle-rotation";
export const describe =
  "Each new day picks the next cycle template (Day 1→2→3→4→1) and fills its slots.";

export const OP_NAME = "Schedule: Place Cycle Day";
export const CYCLE_FIELD = "Cycle Day";
export const MARKER_LABEL = "Last Opened";
export const TODAY_DATE = "2026-08-13";
export const TODAY_CYCLE = "Day 1";
export const HYGIENE_FROM = "7:00am";
export const HYGIENE_TO = "7:30am";
// Moved together — the user put the Hot Tub in Hygiene's slot.
export const POST_WORKOUT = ["Hygiene", "Hot Tub"];

const sid = () => randomUUID().slice(0, 12);
const act = (config) => ({ id: sid(), type: "action", config });
const iff = (rules, then, els) => ({
  id: sid(), type: "if",
  condition: { operator: "AND", rules: rules.map((r) => ({ id: sid(), ...r })) },
  then, ...(els ? { else: els } : {}),
});
const loop = (overExpr, as, body) => ({ id: sid(), type: "loop", overExpr, as, body });

export function buildPipeline({ schedPageOccId, FMT, DATE, TS, MEAL, MOV, CYCLE_FID, markerOccId, tplByCycle }) {
  const names = Object.keys(tplByCycle);
  // "Day 1" -> "Day 2" -> … -> "Day 1". Expressed as explicit IFs because the
  // pipeline has no modulo; four branches is the whole cycle.
  const advance = names.map((n, i) =>
    iff([{ left: "$prevCycle", comparator: "IS", right: n }],
      [act({ type: "SET_VAR", name: "$cycleName", value: `literal:${names[(i + 1) % names.length]}` })]));
  const pick = names.map((n) =>
    iff([{ left: "$cycleName", comparator: "IS", right: n }],
      [act({ type: "SET_VAR", name: "$cycTplId", value: `literal:${tplByCycle[n]}` })]));

  return {
    sources: [],
    steps: [
      act({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${schedPageOccId}` }),
      act({ type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }),
      // Scoped to this page's own navigation — the 2026-08-09 (3) rule. A nav
      // sourced elsewhere could only rebuild this page for its unchanged dates.
      iff([{ left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY", right: "" }],
        [act({ type: "SET_VAR", name: "$mine", value: "literal:1" })],
        [iff([{ left: "$trigger.sourceOccurrenceId", comparator: "IS", right: "$schedPageId" }],
          [act({ type: "SET_VAR", name: "$mine", value: "literal:1" })])]),
      act({ type: "INIT_VAR", name: "$mine2", expr: "$mine" }),
      iff([{ left: "$mine2", comparator: "IS", right: "1" }], [
        loop("$activePeriodDates", "$day", [
          act({ type: "FIND", over: "$allContainers", predicate: { operator: "AND", rules: [
            { id: sid(), left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
            { id: sid(), left: `fields.${FMT}.value`, comparator: "IS", right: "day-col" },
            { id: sid(), left: `fields.${DATE}.value`, comparator: "SAME_DAY", right: "$day" },
          ] }, itemIdVar: "$dayColId", itemVar: "$dayCol" }),
          iff([{ left: "$dayColId", comparator: "IS_NOT_EMPTY", right: "" }], [
            act({ type: "INIT_VAR", name: "$cycleName", expr: `$dayCol.fields.${CYCLE_FID}.value` }),
            // No stored position yet -> advance the marker and stamp it. The
            // stamp is what stops a later rebuild advancing it again.
            iff([{ left: "$cycleName", comparator: "IS_EMPTY", right: "" }], [
              act({ type: "INIT_VAR", name: "$mk", expr: `$allItemsById.${markerOccId}` }),
              act({ type: "INIT_VAR", name: "$prevCycle", expr: `$mk.fields.${CYCLE_FID}.value` }),
              act({ type: "SET_VAR", name: "$cycleName", value: `literal:${names[0]}` }),
              ...advance,
              act({ type: "UPDATE", path: `$mk.fields.${CYCLE_FID}.value`, value: "$cycleName" }),
              act({ type: "UPDATE", path: `$dayCol.fields.${CYCLE_FID}.value`, value: "$cycleName" }),
            ]),
            act({ type: "INIT_VAR", name: "$cycTplId", value: "literal:" }),
            ...pick,
            iff([{ left: "$cycTplId", comparator: "IS_NOT_EMPTY", right: "" }], [
              act({ type: "INIT_VAR", name: "$cycTpl", expr: "$allItemsById.${$cycTplId}" }),
              loop("$cycTpl.occurrences", "$tSlotId", [
                act({ type: "SET_VAR", name: "$tSlot", value: "$allItemsById.${$tSlotId}" }),
                act({ type: "SET_VAR", name: "$tSlotTime", value: `$tSlot.fields.${TS}.value` }),
                iff([{ left: "$tSlotTime", comparator: "IS_NOT_EMPTY", right: "" }], [
                  // The day's own slot for that time — parentId, not
                  // HAS_ANCESTOR, so it can only be a DIRECT child of this
                  // column and never another day's slot of the same name.
                  act({ type: "FIND", over: "$allContainers", predicate: { operator: "AND", rules: [
                    { id: sid(), left: "parentId", comparator: "IS", right: "$dayColId" },
                    { id: sid(), left: `fields.${TS}.value`, comparator: "IS", right: "$tSlotTime" },
                  ] }, itemIdVar: "$daySlotId" }),
                  iff([{ left: "$daySlotId", comparator: "IS_NOT_EMPTY", right: "" }], [
                    loop("$tSlot.occurrences", "$tItemId", [
                      act({ type: "SET_VAR", name: "$tItem", value: "$allItemsById.${$tItemId}" }),
                      // ONLY rows carrying a pick. The cycle templates also hold
                      // the daily routines (Drink / Hygiene / Walk / Journal /
                      // Hot Tub) so they stay complete if applied BY HAND — but
                      // `Schedule: Build Schedule` already places those from the
                      // "Day" template, so placing them here too would put a
                      // second Drink on every column. The pick is what this op
                      // uniquely supplies.
                      {
                        id: sid(), type: "if",
                        condition: { operator: "OR", rules: [
                          { id: sid(), left: `$tItem.fields.${MEAL}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                          { id: sid(), left: `$tItem.fields.${MOV}.value`, comparator: "IS_NOT_EMPTY", right: "" },
                        ] },
                        then: [
                          // merge + identitySignature is the whole dedupe: a
                          // second run finds the signed sibling and clones nothing.
                          act({ type: "APPLY_TEMPLATE", templateRef: "$tItemId", rootParent: "$daySlotId",
                            mode: "merge", defaultFields: { [DATE]: "$day" } }),
                        ],
                      },
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ],
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TS = fid("Time Slot"), DATE = fid("Date"), FMT = fid("Schedule Format");
  const MOV = fid("Movement"), MEAL = fid("Meal");
  if (!TS || !DATE || !FMT) { log(`REFUSING: missing Time Slot / Date / Schedule Format.`); return; }

  const schedPage = occs.find((o) => o.id === "llpF10Bda5nu") ||
    occs.find((o) => nameOf(o) === "Schedule" && modById.get(o.moduleId)?.role === "page");
  if (!schedPage) { log(`REFUSING: no Schedule page.`); return; }
  const marker = occs.find((o) => nameOf(o) === MARKER_LABEL);
  if (!marker) { log(`REFUSING: no "${MARKER_LABEL}" grid marker.`); return; }
  const buildOp = ops.find((o) => o.name === "Schedule: Build Schedule");
  if (!buildOp) { log(`REFUSING: no "Schedule: Build Schedule" to mirror.`); return; }

  const tplByCycle = {};
  for (const c of CYCLE) {
    const m = mods.find((x) => x.label === `Schedule - Day ${c.n}` && x.meta?.templateModule === true);
    const o = m ? occs.find((x) => x.moduleId === m.id) : null;
    if (!o) { log(`REFUSING: no template "Schedule - Day ${c.n}".`); return; }
    tplByCycle[`Day ${c.n}`] = o.id;
  }

  // --- the signature every placed row is matched on ------------------------
  const pickLabel = (o) => {
    const mv = o.fields?.[MOV]?.value, ml = o.fields?.[MEAL]?.value;
    const ids = Array.isArray(mv) ? mv : mv ? [mv] : [];
    if (ids.length) return nameOf(byId.get(ids[0]));
    if (ml) return nameOf(byId.get(ml));
    return null;
  };
  const sigFor = (o) => `cycle:${pickLabel(o) || nameOf(o)}`;

  const toSign = [];
  const collect = (root, where) => {
    for (const s of (root.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      if (!s.fields?.[TS]?.value) continue;
      for (const k of (s.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
        // Only the rows this op places — the ones carrying a Meal or Movement
        // pick. Signing a routine would claim it for merge and duplicate it.
        if (!pickLabel(k)) continue;
        const sig = sigFor(k);
        if (k.identitySignature === sig) continue;
        // Never re-sign something that already carries a different signature —
        // that would be overwriting an identity another rule matches on.
        if (k.identitySignature) { log(`  KEEPING signature on ${where} "${nameOf(k)}" (${k.identitySignature})`); continue; }
        toSign.push({ occ: k, sig, where });
      }
    }
  };
  for (const [name, tid] of Object.entries(tplByCycle)) collect(byId.get(tid), name);
  const todayCol = occs.find((o) => o.fields?.[FMT]?.value === "day-col" &&
    String(o.fields?.[DATE]?.value ?? "").slice(0, 10) === TODAY_DATE);
  if (todayCol) collect(todayCol, "today");

  // The "Day" template is what builds every column, and the cycle op now puts
  // lifts in 7:00am on all of them — so Day's Hygiene (and the Hot Tub beside
  // it) belong in the post-workout slot too, exactly as on the cycle templates.
  const dayTpl = occs.find((o) => o.id === "9EZL5iXnYhul");
  const moves = [];
  if (dayTpl) {
    const daySlots = new Map();
    for (const s2 of (dayTpl.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      const t = s2.fields?.[TS]?.value; if (t) daySlots.set(String(t), s2);
    }
    const from = daySlots.get(HYGIENE_FROM), to = daySlots.get(HYGIENE_TO);
    if (from && to) {
      for (const k of (from.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
        if (!POST_WORKOUT.includes(nameOf(k))) continue;
        moves.push({ occ: k, from, to, label: nameOf(k) });
      }
    }
  }
  for (const m of moves) log(`  ~ Day template: ${m.label} ${HYGIENE_FROM} -> ${HYGIENE_TO}`);

  const CYCLE_FID = fid(CYCLE_FIELD);
  const existingOp = ops.find((o) => o.name === OP_NAME);
  log(`schedule page ${schedPage.id} · marker "${nameOf(marker)}" ${marker.id}`);
  log(`templates: ${Object.entries(tplByCycle).map(([k, v]) => `${k}=${v.slice(0, 8)}`).join(" ")}`);
  log(`signatures to stamp: ${toSign.length}` +
    ` (${[...new Set(toSign.map((t) => t.where))].join(", ")})`);
  log(`"${CYCLE_FIELD}" field: ${CYCLE_FID ? "exists" : "WILL CREATE"} · op "${OP_NAME}": ${existingOp ? "exists, will replace pipeline" : "WILL CREATE"}`);
  log(`today ${todayCol ? `stamped ${TODAY_CYCLE}` : "no column"} · marker set to ${TODAY_CYCLE}`);
  if (dryRun) { log(`WOULD wire the rotation.`); return; }

  // --- write ---------------------------------------------------------------
  let cycleFid = CYCLE_FID;
  if (!cycleFid) {
    cycleFid = randomUUID();
    await Field.create({
      id: cycleFid, gridId, userId: schedPage.userId, name: CYCLE_FIELD, type: "text",
      inputEnabled: true, displayEnabled: false,
      meta: { note: "Which day of the 4-day schedule cycle this column is." },
    });
  }
  for (const m of moves) {
    await Occurrence.updateOne({ gridId, id: m.from.id }, { $pull: { occurrences: m.occ.id } });
    await Occurrence.updateOne({ gridId, id: m.to.id }, { $push: { occurrences: m.occ.id } });
    await Occurrence.updateOne({ gridId, id: m.occ.id },
      { $set: { parentId: m.to.id, [`fields.${TS}`]: { value: HYGIENE_TO, flow: "in" } } });
  }
  for (const t of toSign) {
    await Occurrence.updateOne({ gridId, id: t.occ.id }, { $set: { identitySignature: t.sig } });
  }
  if (todayCol) {
    await Occurrence.updateOne({ gridId, id: todayCol.id },
      { $set: { [`fields.${cycleFid}`]: { value: TODAY_CYCLE, flow: "in" } } });
  }
  await Occurrence.updateOne({ gridId, id: marker.id },
    { $set: { [`fields.${cycleFid}`]: { value: TODAY_CYCLE, flow: "in" } } });

  const pipeline = buildPipeline({
    schedPageOccId: schedPage.id, FMT, DATE, TS, MEAL, MOV, CYCLE_FID: cycleFid,
    markerOccId: marker.id, tplByCycle,
  });
  const envelope = {
    gridId, userId: schedPage.userId, name: OP_NAME,
    description: "Fills each day column with its cycle template's meals and movements.",
    enabled: true,
    // Mirrored from Build Schedule so the two cannot disagree about WHEN a day
    // is built vs filled; priority is lower so this always follows it.
    triggerTypes: [...(buildOp.triggerTypes || [])],
    triggerObjects: JSON.parse(JSON.stringify(buildOp.triggerObjects || [])),
    targetOccurrenceId: schedPage.id,
    folderId: buildOp.folderId ?? null,
    priority: (buildOp.priority ?? 5) + 1,
    pipeline,
  };
  if (existingOp) await Operation.updateOne({ gridId, id: existingOp.id }, { $set: envelope });
  else await Operation.create({ id: randomUUID(), ...envelope });

  log(`signed ${toSign.length}, field ${cycleFid}, op "${OP_NAME}" priority ${envelope.priority}` +
    ` triggers ${JSON.stringify(envelope.triggerTypes)}.`);
}
