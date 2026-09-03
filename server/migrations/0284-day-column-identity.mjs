// The day column had no IDENTITY, so nothing could tell a rebuild from a duplicate.
//
// ── WHAT AND WHY ───────────────────────────────────────────────────────────
//
// `Day Page: Build` guards its create with a FIND over the client's own
// payload — "is there already a column for this date under this board?" That
// FIND is correct and the op converges (measured 2026-09-03: with the column
// present it creates nothing, and a second sweep over the applied world creates
// nothing). Yet nine columns accumulated on 2026-09-02, exactly 35 seconds
// apart — the device's own load-sweep duration. The create of one sweep had not
// reached the payload the next was built from, and **a pipeline cannot defend
// against that, because its input IS the payload.**
//
// The server can, but only if the column carries something to recognise it by.
// Every node APPLY_TEMPLATE clones gets an `identitySignature` EXCEPT a
// non-merge root — deliberately, because the derived `auto:<templateId>` would
// give every column built from one template the SAME signature. So this hands
// the op a DATED one instead: `daypage:col:<YYYY-MM-DD>`. One per day is legal,
// two are not, and `utils/duplicateSignature.js` refuses the second.
//
// ── TWO HALVES, AND BOTH ARE REQUIRED ──────────────────────────────────────
//
//  1. the STORED pipeline learns `rootSignature`, so tomorrow's column is born
//     with an identity (the seed builder carries the same string, so a reseeded
//     grid and a migrated one cannot drift);
//  2. the columns that ALREADY exist are stamped with the signature they would
//     have been born with — without this the guard has nothing to compare a new
//     create against and today's columns stay unprotected forever.
//
// ── IT WRITES A SIGNATURE AND NOTHING ELSE ─────────────────────────────────
//
// No occurrence is moved, deleted or re-parented, and a column that already
// carries a signature is LEFT ALONE — so there is no selector here that can
// match the wrong thing, which is the class `0035` cost a real page for. The
// date comes from the column's own stored date field, never from parsing its
// label ("Friday, July 31st, 2026" is one rename from wrong).
import mongoose from "mongoose";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0284-day-column-identity";
export const describe =
  "Give the Day Page column a DATED identitySignature — via rootSignature on the " +
  "stored op for future columns, and a backfill for the ones that exist — so the " +
  "server can refuse a duplicate the client's payload could not see.";
export const touches = ["occurrences", "operations"];

/** The signature a column for `date` should carry. ONE definition, shared by
 *  the backfill and the assertion below, so the two cannot disagree. */
export const signatureForDate = (date) => `daypage:col:${date}`;

/** Walk a pipeline for the APPLY_TEMPLATE that CREATES the day column: the one
 *  carrying `rootParent` + `rootIdVar`. Identified by SHAPE, not by position —
 *  the op has a second APPLY_TEMPLATE (the merge branch) and steps move. */
export function findColumnCreateStep(steps, out = []) {
  for (const s of steps || []) {
    const c = s?.config || {};
    if (String(c.type) === "APPLY_TEMPLATE" && c.rootParent && c.rootIdVar) out.push(c);
    for (const k of ["steps", "then", "else", "body", "thenSteps", "elseSteps"]) {
      if (Array.isArray(s[k])) findColumnCreateStep(s[k], out);
      if (Array.isArray(c[k])) findColumnCreateStep(c[k], out);
    }
  }
  return out;
}

// The runner passes `dryRun`, NOT `apply`. Taking the wrong name here is a
// silent no-op that reads as success — the first version of this file did
// exactly that: it printed "DRY RUN" while the runner printed "✅ applied" and
// recorded it in the ledger, having written nothing.
export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const occs = await Occurrence.find({ gridId }).lean();
  const ops = await Operation.find({ gridId }).lean();

  const dpOp = ops.find((o) => /^Day Page: Build$/i.test(String(o.name)));
  if (!dpOp) { log("  no `Day Page: Build` on this grid — nothing to do"); return; }

  const creates = findColumnCreateStep(dpOp.pipeline?.steps);
  if (creates.length !== 1) {
    // FAIL CLOSED. Zero means the pipeline moved and a blind patch would land
    // nowhere; more than one means the shape is ambiguous and picking is a guess.
    throw new Error(`0284: expected exactly ONE column-create APPLY_TEMPLATE, found ${creates.length}`);
  }
  const create = creates[0];
  const boardId = create.rootParent;
  const dateFieldId = Object.keys(create.defaultFields || {})[0] || null;
  if (!boardId || !dateFieldId) throw new Error("0284: could not resolve the board or the date field from the op");

  const wantExpr = "daypage:col:${$day}";
  const opNeedsPatch = create.rootSignature !== wantExpr;

  const cols = occs.filter((o) => o.parentId === boardId);
  const toStamp = [];
  const skipped = [];
  for (const c of cols) {
    const date = c.fields?.[dateFieldId]?.value;
    if (!date) { skipped.push([c.id, "no date value"]); continue; }
    const want = signatureForDate(String(date));
    // The signature alone is not enough: the server's guard is OPT-IN
    // (`meta.signatureUnique`), because a signature is ALSO used as a shared
    // marker — eight weekday templates share `day-container` under one real
    // page, and refusing a ninth would be a legitimate write silently dropped.
    // So a column already signed but not yet FLAGGED still needs the write.
    if (c.identitySignature === want && c.meta?.signatureUnique) continue;
    // A signature that is already SOMETHING ELSE is somebody's deliberate
    // marker. Overwriting it is exactly the damage `0035` did. But a column
    // already carrying the signature we would write is OURS — it just predates
    // the opt-in flag, so it needs the flag rather than a skip. Testing
    // `!== want` instead of "has any signature" is the difference between
    // finishing the job and stamping 1 of 33.
    if (c.identitySignature && c.identitySignature !== want) {
      skipped.push([c.id, `already signed "${c.identitySignature}"`]); continue;
    }
    toStamp.push({ id: c.id, want, date });
  }

  // A migration must never CREATE the state the guard exists to prevent. Two
  // columns sharing a date would be stamped with the same signature, which is
  // precisely the duplicate this work is about — so refuse and name them rather
  // than writing it and letting `gridIntegrity` find it afterwards.
  const byWant = new Map();
  for (const s of toStamp) byWant.set(s.want, [...(byWant.get(s.want) || []), s.id]);
  const collisions = [...byWant].filter(([, ids]) => ids.length > 1);
  if (collisions.length) {
    throw new Error(
      `0284: ${collisions.length} date(s) carry more than one column — stamping would mint the very ` +
      `duplicate signature this guards against. Repair first: ` +
      collisions.map(([sig, ids]) => `${sig} x${ids.length}`).join(", "),
    );
  }

  log(`  board ${boardId} · date field ${dateFieldId}`);
  log(`  op rootSignature: ${opNeedsPatch ? `MISSING -> "${wantExpr}"` : "already set"}`);
  log(`  day columns: ${cols.length} · to stamp: ${toStamp.length} · skipped: ${skipped.length}`);
  for (const s of toStamp.slice(0, 8)) log(`     ${s.id.slice(0, 10)}  ${s.date} -> ${s.want}`);
  for (const [sid, why] of skipped) log(`     SKIP ${sid.slice(0, 10)} — ${why}`);

  if (!apply) { log("  DRY RUN — pass --apply to write."); return; }

  if (opNeedsPatch) {
    // Patch the stored step IN PLACE inside a deep clone, so every other key of
    // the pipeline is carried through untouched.
    const pipeline = JSON.parse(JSON.stringify(dpOp.pipeline));
    const target = findColumnCreateStep(pipeline.steps);
    if (target.length !== 1) throw new Error("0284: the clone lost the create step");
    target[0].rootSignature = wantExpr;
    await Operation.updateOne({ id: dpOp.id, gridId }, { $set: { pipeline } });
    log("  patched `Day Page: Build`");
  }
  for (const s of toStamp) {
    // `signatureUnique` rides in META (Mixed) — an undeclared top-level key is
    // stripped by Mongoose strict mode, which is how `Operation.priority` sat
    // inert for months.
    await Occurrence.updateOne({ id: s.id, gridId },
      { $set: { identitySignature: s.want, "meta.signatureUnique": true } });
  }
  log(`  stamped ${toStamp.length} column(s)`);
}
