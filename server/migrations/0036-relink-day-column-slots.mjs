// server/migrations/0036-relink-day-column-slots.mjs
//
// A day column rendered from 7:00am because its first 14 slots were CREATED but
// never LISTED in the column's `occurrences[]` — which is what the renderer
// reads. Items the user had already put in those slots were invisible too.
//
// Cause: the documented create/update asymmetry (2026-07-29). create_occurrence
// is queued server-side and survives a disconnect; the parent-list write is a
// separate update_occurrence and does not. `Schedule: Build Schedule` could not
// repair it because its existence check matches by `parentId` — which the
// orphaned slots still carry — so it saw them as present and skipped them
// without ever re-asserting the link.
//
// This migration does both halves:
//   1. DURABLE — patches the stored op so the slot-exists branch ADD_CHILDs the
//      copy back into the day column. ADD_CHILD is idempotent, so it is a no-op
//      on a healthy day and repairs a partial one on the next fire.
//   2. DATA — rebuilds every day column's `occurrences[]` from the occurrences
//      that already point at it, in clock order, and restores the Time Slot
//      identity marker on any slot whose value was lost (ops FIND slots by that
//      value — a null marker makes the slot unfindable).
//
// Nothing is created or deleted. Ordering is [Due, Todo, …slots in clock order,
// …anything else], matching the convention the healthy columns already use.
export const id = "0036-relink-day-column-slots";
export const describe =
  "Re-links day-column children that carry parentId but are missing from occurrences[], restores lost " +
  "Time Slot markers, and patches Schedule: Build Schedule so it self-heals a partially-linked column.";

const HEAD_LABELS = ["Due", "Todo"];

/** "6:30am" → minutes since midnight; null when it isn't a slot label. */
export function slotMinutes(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(label || "").trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2]);
}

/**
 * Order a day column's children: the two head containers first, then every slot
 * in clock order, then anything else in the order it already had.
 */
export function orderDayColumnChildren(children) {
  const head = [], slots = [], rest = [];
  for (const c of children) {
    if (HEAD_LABELS.includes(c.label)) head.push(c);
    else if (slotMinutes(c.label) != null) slots.push(c);
    else rest.push(c);
  }
  head.sort((a, b) => HEAD_LABELS.indexOf(a.label) - HEAD_LABELS.indexOf(b.label));
  slots.sort((a, b) => slotMinutes(a.label) - slotMinutes(b.label));
  return [...head, ...slots, ...rest].map(c => c.id);
}

/**
 * Give the slot-exists branch an ADD_CHILD so the link is re-asserted.
 * Walks the pipeline for the IF that tests `$slotCopyId IS_EMPTY`.
 * Returns the number of branches patched (0 when already done — idempotent).
 */
export function patchRelinkIntoPipeline(pipeline, mkId = () => `relink-${Math.random().toString(36).slice(2)}`) {
  let patched = 0;
  const walk = (steps) => {
    if (!Array.isArray(steps)) return;
    for (const st of steps) {
      if (!st || typeof st !== "object") continue;
      if (st.type === "if") {
        const testsSlotCopy = (st.condition?.rules || [])
          .some(r => r?.left === "$slotCopyId" && r?.comparator === "IS_EMPTY");
        if (testsSlotCopy) {
          const els = Array.isArray(st.else) ? st.else : [];
          const already = els.some(e => e?.config?.type === "ADD_CHILD" && e?.config?.childId === "$slotCopyId");
          if (!already) {
            st.else = [...els, {
              id: mkId(), type: "action",
              config: { type: "ADD_CHILD", parentId: "$dayColId", childId: "$slotCopyId" },
            }];
            patched++;
          }
        }
        walk(st.then); walk(st.else);
      }
      if (st.type === "loop") walk(st.body);
    }
  };
  walk(pipeline?.steps);
  return patched;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation, Grid } = models;

  const grid = await Grid.findById(gridId).lean();
  const sf = grid?.meta?.scheduleFieldIds || {};
  if (!sf.scheduleFormatFieldId) { log("grid has no scheduleFieldIds — nothing to do"); return; }

  const occs = await Occurrence.find({ gridId }).select("-textmap").lean();
  const mods = await Module.find({ gridId }).lean();
  const modById = Object.fromEntries(mods.map(m => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label || "";

  // ── 1. Re-link + restore markers, per day column ─────────────────────────
  const dayCols = occs.filter(o => o.fields?.[sf.scheduleFormatFieldId]?.value === "day-col");
  log(`${dayCols.length} day column(s)`);

  for (const col of dayCols) {
    const date = String(col.fields?.[sf.dateFieldId]?.value || "").slice(0, 10) || "(no date)";
    const children = occs.filter(o => o.parentId === col.id);
    const listed = new Set(col.occurrences || []);
    const missing = children.filter(c => !listed.has(c.id));

    // Restore the Time Slot identity marker where it was lost. Ops FIND a slot
    // by this value ("Alarm", "Pomodoro: Start", "Mark Passed Slots"), so a null
    // marker makes the slot unfindable even once it is linked. The slot's OWN
    // label is the correct value — the 2026-07-30 rule: a value equal to the
    // occurrence's own label is an identity marker.
    let markersFixed = 0;
    if (sf.timeslotFieldId) {
      for (const c of children) {
        const label = labelOf(c);
        if (slotMinutes(label) == null) continue;
        if (c.fields?.[sf.timeslotFieldId]?.value) continue;
        markersFixed++;
        if (!dryRun) {
          await Occurrence.updateOne({ gridId, id: c.id },
            { $set: { [`fields.${sf.timeslotFieldId}`]: { value: label, flow: "in" } } });
        }
      }
    }

    if (!missing.length && !markersFixed) { log(`  ${date}: already complete (${children.length} children)`); continue; }

    const withLabels = children.map(c => ({ id: c.id, label: labelOf(c) }));
    const ordered = orderDayColumnChildren(withLabels);
    log(`  ${date}: ${listed.size} listed → ${ordered.length} (re-linked ${missing.length}` +
        `${markersFixed ? `, restored ${markersFixed} marker(s)` : ""})`);
    if (missing.length) {
      const names = missing.map(c => labelOf(c) || c.id).slice(0, 16);
      log(`     ${names.join(", ")}`);
    }
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: col.id }, { $set: { occurrences: ordered } });
    }
  }

  // ── 2. Patch the op so it self-heals next time ───────────────────────────
  const op = await Operation.findOne({ gridId, name: "Schedule: Build Schedule" }).lean();
  if (!op) { log("no 'Schedule: Build Schedule' op on this grid — skipping the op patch"); return; }
  const pipeline = JSON.parse(JSON.stringify(op.pipeline || {}));
  const patched = patchRelinkIntoPipeline(pipeline);
  if (!patched) { log("op already re-links existing slots — no patch needed"); return; }
  log(`patching the op: ${patched} slot-exists branch(es) now ADD_CHILD back into the day column`);
  if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });

  log(dryRun ? "(dry run — no writes)" : "done");
}
