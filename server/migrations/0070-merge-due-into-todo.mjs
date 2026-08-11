// server/migrations/0070-merge-due-into-todo.mjs
//
// User, 2026-08-11: *"get rid of the Due container and just put all the stuff
// that went in Due, put in the todo container on schedule"*.
//
// Due and Todo were the SAME THING under two markers — same role, same kind,
// same single hidden Time Slot binding, both meaning "work with no time on it".
// The builder no longer creates a Due; this carries that to grids already
// built.
//
// ── THE ORDER MATTERS, AND THE OPS ARE THE DURABLE HALF ────────────────────
//
// Moving the data alone would be undone by tomorrow morning: `Due: Seed` and
// `Schedule: Place Dated Work` both FIND a Due and would re-create and re-fill
// it. So this repoints the STORED PIPELINES too — the builder change alone is
// inert on an already-seeded grid, the "shipped and does nothing" class this
// repo keeps paying for.
//
// ── IT RE-LINKS, IT NEVER DELETES A TASK ───────────────────────────────────
//
// Due's children are multi-parented — the same occurrences are listed by the
// Tasks board (measured 2026-08-11: `Occupational | Due | Due | Due`). Deleting
// one would take the task off the Tasks board as well. So each child is ADDED
// to the day's Todo and the Due link is dropped; the occurrence itself is
// untouched.
//
// ── AND IT DE-DUPLICATES ON THE WAY ────────────────────────────────────────
//
// That same measurement showed `Due` listing one occurrence THREE TIMES. A
// duplicate child link is invisible to `gridIntegrity` (its dangling-child-ref
// rule checks that ids RESOLVE, not that they are DISTINCT), so the merge
// writes a de-duplicated list rather than carrying the duplication across.
//
// ── IDENTITY IS THE MARKER, NEVER THE LABEL ────────────────────────────────
//
// Containers are matched on `fields.<timeslot>.value`, which is what the ops
// themselves match on. Matching the label is what cost three repair passes on
// 2026-07-30, and a label is the user's to rename at any time.

export const id = "0070-merge-due-into-todo";
export const describe =
  "Merges each day's Due container into its Todo: children are re-linked (never "
  + "deleted — they are multi-parented), the emptied Due is unlinked and "
  + "removed, and the two stored ops that target the Due marker are repointed "
  + "at Todo so tomorrow's build does not re-create it.";

export const DUE_MARKER = "Due";
export const TODO_MARKER = "Todo";

/** A stored field value is either the {value,flow} wrapper or the bare value. */
export function readValue(occ, fieldId) {
  const raw = occ?.fields?.[fieldId];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return "value" in raw ? raw.value : undefined;
  return raw;
}

export function resolveFieldByName(fields, name, type) {
  const hits = fields.filter(
    (f) => (f.name || "").toLowerCase() === name.toLowerCase() && (!type || f.type === type),
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Pair each Due with the Todo that shares its parent, and say which children
 * move. PURE — the pairing is the whole risk.
 *
 * A Due with no sibling Todo is REPORTED and skipped: moving its children to
 * some other day's Todo would silently reschedule the user's work.
 *
 * @returns { pairs: [{ due, todo, moving: string[], nextTodo: string[] }], orphans: [] }
 */
export function planMerge({ occurrences, timeslotFieldId }) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  // parent → its direct children, from occurrences[] (what the renderer reads)
  const parentOf = new Map();
  for (const o of occurrences) {
    for (const childId of o.occurrences || []) {
      if (!parentOf.has(childId)) parentOf.set(childId, o.id);
    }
  }
  const markerOf = (o) => readValue(o, timeslotFieldId);

  const pairs = [];
  const orphans = [];
  for (const due of occurrences) {
    if (markerOf(due) !== DUE_MARKER) continue;
    const parentId = parentOf.get(due.id);
    const parent = parentId ? byId.get(parentId) : null;
    // Its sibling Todo — same parent, Todo marker.
    const todo = parent
      ? (parent.occurrences || [])
          .map((id) => byId.get(id))
          .find((o) => o && markerOf(o) === TODO_MARKER)
      : null;
    const kids = [...new Set(due.occurrences || [])];   // de-duplicated on the way
    if (!todo) { orphans.push({ due, parent, kids }); continue; }
    const existing = new Set(todo.occurrences || []);
    const moving = kids.filter((id) => !existing.has(id));
    pairs.push({
      due, todo, parent, moving,
      // de-dupe the Todo's own list too, for the same reason
      nextTodo: [...new Set([...(todo.occurrences || []), ...moving])],
    });
  }
  return { pairs, orphans };
}

/** Repoint a stored pipeline from the Due marker to the Todo marker. */
export function repointPipeline(pipeline, timeslotFieldId) {
  if (!pipeline) return { next: null, hits: 0 };
  let hits = 0;
  const leftKeys = new Set([`fields.${timeslotFieldId}.value`, `$item.fields.${timeslotFieldId}.value`]);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v);
    // a predicate rule matching the Due marker
    if (leftKeys.has(out.left) && out.right === DUE_MARKER) { out.right = TODO_MARKER; hits++; }
    // a CREATE stamping the Due marker
    if (out.type === "CREATE" && out.name === DUE_MARKER) { out.name = TODO_MARKER; hits++; }
    if (typeof out[timeslotFieldId] === "string" && out[timeslotFieldId] === `literal:${DUE_MARKER}`) {
      out[timeslotFieldId] = `literal:${TODO_MARKER}`; hits++;
    }
    // the legacy label match, which should never have been one
    if (out.left === "label" && out.right === DUE_MARKER) { out.right = TODO_MARKER; hits++; }
    return out;
  };
  const next = walk(pipeline);
  return { next: hits ? next : null, hits };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Field, Operation } = models;
  const [fields, occs, ops] = await Promise.all([
    Field.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
    Operation.find({ gridId }).lean(),
  ]);

  const timeslot = resolveFieldByName(fields, "Time Slot", "select")
    || resolveFieldByName(fields, "Time Slot");
  if (!timeslot) { log("  · no unambiguous Time Slot field — REFUSING"); return; }

  const { pairs, orphans } = planMerge({ occurrences: occs, timeslotFieldId: timeslot.id });
  log(`  · Due containers: ${pairs.length + orphans.length}  (paired with a Todo: ${pairs.length})`);
  for (const p of pairs) {
    log(`     Due ${p.due.id} → Todo ${p.todo.id}: moving ${p.moving.length} child(ren)`);
  }
  for (const o of orphans) {
    // Never guess a destination — that would reschedule real work.
    log(`     ⚠ Due ${o.due.id} has NO sibling Todo (${o.kids.length} child(ren)) — LEFT ALONE`);
  }

  // ── the durable half ────────────────────────────────────────────────────
  const opWrites = [];
  for (const op of ops) {
    const { next, hits } = repointPipeline(op.pipeline, timeslot.id);
    if (next) opWrites.push({ op, next, hits });
  }
  log(`  · stored ops targeting the Due marker: ${opWrites.length}`);
  for (const w of opWrites) log(`     "${w.op.name}" — ${w.hits} reference(s)`);

  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  for (const p of pairs) {
    // 1. the Todo gains the children (de-duplicated)
    await Occurrence.updateOne({ gridId, id: p.todo.id }, { $set: { occurrences: p.nextTodo } });
    // 2. the parent stops listing the Due
    if (p.parent) {
      await Occurrence.updateOne(
        { gridId, id: p.parent.id },
        { $set: { occurrences: (p.parent.occurrences || []).filter((id) => id !== p.due.id) } },
      );
    }
    // 3. the Due is emptied FIRST, so removing it can never cascade into a task
    await Occurrence.updateOne({ gridId, id: p.due.id }, { $set: { occurrences: [] } });
    await Occurrence.deleteOne({ gridId, id: p.due.id });
  }
  for (const w of opWrites) {
    await Operation.updateOne({ gridId, id: w.op.id }, { $set: { pipeline: w.next } });
  }
  log(`  ✓ merged ${pairs.length} Due container(s) into Todo; repointed ${opWrites.length} op(s)`);
}
