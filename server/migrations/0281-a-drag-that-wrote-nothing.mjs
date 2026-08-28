/**
 * 0281 — dragging a kanban card between columns wrote NOTHING.
 *
 * The last open item of 2026-08-28 (5) — *"nobody has dragged a card between
 * columns with a mouse"* — measured rather than assumed:
 *
 *     ops that mention Status    2   Status Router · Sync To Todo List
 *     their trigger              onChange · field · Status   (BOTH)
 *     ops triggering on a MOVE   1   Schedule: Clear Date on Move-Out
 *
 * A drag emits `OccurrenceMoveOp` and **no op listened for one on a kanban
 * card**. So the card moved on screen, `Status` stayed stale, the board and the
 * field disagreed, and `Project: Status Router` yanked the card back to the
 * column its Status named the first time anything touched it — which is what
 * 2026-08-28 (4)'s *"0 status/column mismatches"* control was quietly
 * protecting. On a kanban, dragging IS the gesture. User, asked directly:
 * *"drag sets Status, and + does too."*
 *
 * ── WHAT THIS MINTS, AND WHY THE MARKER IS ITS OWN FIELD ───────────────────
 *   1. a `Kanban Column` select — the discriminator
 *   2. that field bound on every kanban column module, valued with the status
 *      that column represents
 *   3. `Project: Stamp Status From Column`, which reads it
 *
 * The destination has to be RECOGNISED as a kanban column. Matching its LABEL
 * against the status options is one rename from wrong — the trap this file
 * records repeatedly. And the tempting shortcut, putting the STATUS value on the
 * column itself, is actively dangerous: `Project: Sync To Todo List` fires on
 * ANY Status change and would try to COPY_LINK the column onto the Tasks page as
 * though it were a task.
 *
 * So a column carries its own marker, exactly as a schedule slot carries
 * `Time Slot` and a day column carries `Schedule Format`. The op then knows
 * nothing about kanbans or projects: **a container carrying a status marker
 * defines the status of whatever is dropped into it.**
 *
 * ── IT JOINS THE GRID'S HIDE LIST, and that is not cosmetic ────────────────
 * A CONTAINER renders its fields in its HEADER (2026-08-11 (3)). Left visible,
 * the marker would print "Kanban Column: Docket" across all 18 column headers —
 * beside a label the user is already telling us is too cramped. It goes into
 * `grid.meta.fieldVisibility`, the same mechanism `Date` and `Tags` use.
 *
 * ── THE OPTIONS ARE THE STATUS FIELD'S OWN ─────────────────────────────────
 * Read off that field rather than restated, so the two cannot drift and a
 * seventh column added later needs no edit here.
 *
 * Idempotent — an existing field, binding, value or op is left alone. Creates
 * nothing on a grid with no kanban.
 */

import { planProjectPages } from "./0279-a-kanban-that-stacked-its-columns.mjs";
import { makeProjectStampStatusFromColumnOp } from "../utils/liveSystemBuilders.js";

export const id = "0281-a-drag-that-wrote-nothing";
export const describe =
  "Mint a Kanban Column marker on every kanban column and the op that reads it, so dropping a card into a column " +
  "(or creating one with +) sets its Status. The inverse of Status Router, which never existed.";
// The grid document itself is always captured by backupGrid, so it is not listed.
export const touches = ["occurrences", "modules", "fields", "operations"];

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
export const MARKER_FIELD_NAME = "Kanban Column";
export const STAMP_OP_NAME = "Project: Stamp Status From Column";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation, Grid } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));
  const occById = Object.fromEntries(occs.map(o => [o.id, o]));
  const userId = occs[0]?.userId;

  const status = fields.find(f => f.name === "Status" && f.type === "select");
  if (!status) { log("  no Status field on this grid — nothing to stamp"); return; }
  const statusOptions = status.meta?.optionsSource?.values || status.meta?.options || [];
  const optionValues = statusOptions.map(v => (typeof v === "string" ? v : v?.value)).filter(Boolean);

  const pages = planProjectPages(occs, modulesById, optionValues);
  log(`  Status options: ${JSON.stringify(optionValues)} · project pages: ${pages.length}`);
  if (!pages.length) { log("  no kanban on this grid — nothing to do"); return; }

  const columns = [];
  for (const p of pages) {
    for (const cid of (occById[p.kanbanId]?.occurrences || [])) {
      const col = occById[cid];
      if (!col) continue;
      const label = col.label ?? modulesById[col.moduleId]?.label ?? "";
      columns.push({ page: p.pageLabel, occ: col, mod: modulesById[col.moduleId], label });
    }
  }
  log(`  kanban columns: ${columns.length}`);

  let marker = fields.find(f => f.name === MARKER_FIELD_NAME);
  const stamp = ops.find(o => o.name === STAMP_OP_NAME);
  const needBind  = columns.filter(c => !(c.mod?.fieldBindings || []).some(b => b.fieldId === marker?.id));
  const needValue = columns.filter(c => !marker || c.occ.fields?.[marker.id]?.value !== c.label);

  log(`      field "${MARKER_FIELD_NAME}"  ${marker ? "exists" : "MISSING → create"}`);
  log(`      bindings needed          ${marker ? needBind.length : columns.length} of ${columns.length}`);
  log(`      values needed            ${needValue.length} of ${columns.length}`);
  log(`      op "${STAMP_OP_NAME}"    ${stamp ? "exists" : "MISSING → create"}`);
  if (marker && !needBind.length && !needValue.length && stamp) {
    log("  a drag already sets Status — already converged");
    return;
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  if (!marker) {
    // Homed in the same folder the other schedule/system discriminators live in,
    // derived rather than hardcoded.
    const scheduleFormat = fields.find(f => f.name === "Schedule Format");
    const markerId = uid();
    await Field.create({
      id: markerId, userId, gridId, name: MARKER_FIELD_NAME, type: "select",
      inputEnabled: true, displayEnabled: false,
      folderId: scheduleFormat?.folderId ?? null,
      meta: { optionsSource: { mode: "manual", values: optionValues } },
    });
    marker = await Field.findOne({ gridId, id: markerId }).lean();
    log(`      created field ${markerId}`);
  }

  let bound = 0, valued = 0;
  for (const c of columns) {
    if (!(c.mod?.fieldBindings || []).some(b => b.fieldId === marker.id)) {
      await Module.updateOne({ gridId, id: c.mod.id }, {
        $push: { fieldBindings: { fieldId: marker.id, order: (c.mod.fieldBindings || []).length, hidden: true, role: "input" } },
      });
      bound++;
    }
    if (c.occ.fields?.[marker.id]?.value !== c.label) {
      await Occurrence.updateOne({ gridId, id: c.occ.id }, {
        $set: { [`fields.${marker.id}`]: { value: c.label, flow: "in" } },
      });
      valued++;
    }
  }

  // A container renders its fields in its HEADER — without this the marker
  // prints across all 18 column headers.
  const vis = grid?.meta?.fieldVisibility;
  if (vis?.mode === "hide" && Array.isArray(vis.fieldIds) && !vis.fieldIds.includes(marker.id)) {
    await Grid.updateOne({ _id: gridId }, {
      $set: { "meta.fieldVisibility.fieldIds": [...vis.fieldIds, marker.id] },
    });
    log("      added to the grid's hide list");
  }

  let madeOp = false;
  if (!stamp) {
    await Operation.create(makeProjectStampStatusFromColumnOp({
      userId, gridId, statusFieldId: status.id, kanbanColumnFieldId: marker.id,
    }));
    madeOp = true;
  }
  log(`  done — ${bound} binding(s), ${valued} value(s)${madeOp ? `, and "${STAMP_OP_NAME}" is live` : ""}`);
}
