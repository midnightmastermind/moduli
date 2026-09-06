// The Schedule day column had no identity, so nothing could refuse a second one.
//
// Last night this session restarted pm2 three times in a few minutes (one per
// migration, to clear the warm cache). Each restart drops the client; each
// reconnect asks for `full_state` and runs the load sweep. Three sweeps landed
// 05:50:07 / :09 / :11 and built three columns for the same day, on top of one
// from 05:13 that already held 49 slots TWICE:
//
//     72c5326a  05:13:22   98 children
//     8693a42d  05:50:07   49 children
//     7578cb30  05:50:09   49 children
//     9c07d753  05:50:11   49 children
//
// `0300` repaired that. This is the reason it happened.
//
// ── THE OP'S OWN GUARD CANNOT SEE THE ROW IT JUST MADE ─────────────────────
//
// `Schedule: Build Schedule` guards its create with a FIND over the client's
// payload — "is there a day-col for this date under the Schedule page?" — and
// that FIND is correct. But its INPUT IS THE PAYLOAD: a create from sweep N
// that has not persisted before sweep N+1's payload is built is invisible, so
// N+1 correctly sees nothing and builds another. 2026-09-03 (12) measured this
// same shape on the Day Page column, 35 seconds apart, nine times.
//
// The server is the only layer that knows what exists, and `0284` already
// built the refusal: a create is dropped when it would give one parent two
// children with the same `identitySignature` AND both sides carry
// `meta.signatureUnique`. `0285` gave the Day Page column a dated signature so
// that guard had something to key on.
//
// **The Schedule column never got one.** Measured: its CREATE step carries no
// `identitySignature` at all, and no schedule day column on the grid has one —
// so `refusedDuplicateCreates` has been running past every one of them.
//
// ── DATED, WHICH IS THE WHOLE POINT ────────────────────────────────────────
//
// `schedule:col:${$day}` — one column per DATE is legal and two are not.
// A bare `schedule:col` would refuse tomorrow's column as a duplicate of
// today's, which is the same rule `0285` reasoned through for the Day Page.
//
// ── AND IT REFUSES TO CREATE THE STATE THE GUARD PREVENTS ──────────────────
//
// Two columns already sharing a date would be stamped with the SAME signature
// under the same parent — precisely the duplicate this is about — so the
// migration THROWS and names them rather than writing it and letting
// `gridIntegrity` find it afterwards.
//
// ── HONEST LIMIT ───────────────────────────────────────────────────────────
//
// This is not airtight and does not claim to be. `0287` records two Day Page
// columns duplicating on 2026-09-05 WITH a signature and the flag, because the
// guard is seeded from the warm cache and the create handler rolls its cache
// entry back on any path that does not reach `persisted = true` while the row
// stays in Mongo. What this closes is the common case — a second sweep in a
// process whose cache does hold the first — which is exactly last night's.
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0303-a-schedule-column-can-say-it-is-todays";
export const description = "Stamp the Schedule day column with a dated identitySignature so the server can refuse a duplicate.";
export const touches = ["fields", "occurrences", "operations"];

const SIG = (day) => `schedule:col:${day}`;
const SIG_EXPR = "schedule:col:${$day}";
const OP = "Schedule: Build Schedule";

// The CREATE that mints the day column: identified by SHAPE — it writes the
// Schedule Format field the value "day-col" — never by position or by name.
function findColumnCreates(node, fmtId, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => findColumnCreates(x, fmtId, out)); return out; }
  const c = node.config || node;
  if ((c?.type === "CREATE") && c?.fields && typeof c.fields === "object") {
    const v = c.fields[fmtId];
    const raw = typeof v === "string" ? v.replace(/^literal:/, "") : v;
    if (raw === "day-col") out.push(c);
  }
  Object.values(node).forEach((v) => findColumnCreates(v, fmtId, out));
  return out;
}

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (n) => {
    const hits = fields.filter((f) => f.name === n);
    if (hits.length !== 1) throw new Error(`field "${n}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const fmt = one("Schedule Format");
  const dateIds = fields.filter((f) => f.name === "Date").map((f) => f.id);

  // ---- 1: the stored pipeline --------------------------------------------
  const op = await Operation.findOne({ gridId: gid, name: OP }).lean();
  if (!op) throw new Error(`no "${OP}" - refusing`);
  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  const creates = findColumnCreates(pipeline, fmt.id);
  if (!creates.length) throw new Error(`"${OP}": no CREATE writing Schedule Format = day-col - refusing`);

  const already = creates.filter((c) => c.identitySignature).length;
  for (const c of creates) c.identitySignature = SIG_EXPR;
  log(`  ${OP}: ${creates.length} day-col CREATE(s), ${already} already signed -> identitySignature "${SIG_EXPR}"`);
  if (apply && already !== creates.length) {
    await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  }

  // ---- 2: the columns that already exist ---------------------------------
  // The guard compares a create against EXISTING siblings, and both sides must
  // carry the signature and the flag - so a stamped op with unstamped columns
  // would refuse nothing.
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const cols = occs.filter((o) => o.fields?.[fmt.id]?.value === "day-col");
  const dateOf = (o) => dateIds.map((d) => o.fields?.[d]?.value).find(Boolean) || null;

  const groups = {};
  for (const c of cols) { const d = dateOf(c); if (d) (groups[d] ||= []).push(c); }
  const collisions = Object.entries(groups).filter(([, list]) => list.length > 1);
  if (collisions.length) {
    throw new Error(
      `stamping would give one parent two children with the same signature on: ` +
      collisions.map(([d, l]) => `${d} (${l.length} columns)`).join(", ") +
      ` - repair them first (0300), refusing`);
  }

  let stamped = 0, skipped = 0, undated = 0;
  for (const c of cols) {
    const d = dateOf(c);
    if (!d) { undated++; continue; }
    if (c.identitySignature === SIG(d) && c.meta?.signatureUnique) { skipped++; continue; }
    stamped++;
    if (apply) {
      await Occurrence.updateOne({ id: c.id, gridId: gid }, {
        $set: { identitySignature: SIG(d), "meta.signatureUnique": true },
      });
    }
  }
  log(`  columns: ${cols.length} total, ${stamped} stamped, ${skipped} already, ${undated} undated (left alone - no date, no dated signature)`);

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
