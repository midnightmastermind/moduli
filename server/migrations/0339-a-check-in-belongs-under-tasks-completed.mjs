// 0339 — a mood check-in is filed under Tasks Completed, not Todo.
//
// User, 2026-09-18: *"those checkins are showing up in todo but it should be in
// tasks completed."*
//
// ── WHERE THE OP PUTS THEM, AND WHY IT IS TODO ─────────────────────────────
//
// `Mood: Record Selection` mints the Check In with `parent: $col.id` (the day
// column) and then LISTS it under a section it looks up by walking the column's
// children:
//
//     loop  over $col.occurrences
//       if  $todoKid.fields.<Time Slot>.value IS "Todo"   ->  $todo = $todoKid
//     …
//     ADD_CHILD  parentId=$todo.id  childId=$newCheckIn
//
// The day column's textmap embeds six sections and the check-ins are in none of
// them, so a check-in is on screen exactly where it is LISTED — which is why
// re-pointing that one lookup is the whole fix.
//
// ── THE LOOKUP WAS ALSO WRONG 39 DAYS OUT OF 47 ────────────────────────────
//
// Measured across every day column on poms grid before writing:
//
//     columns                        47
//     with a "Todo" container         8   <- what the op looks for
//     with a Tasks Completed        47   <- what it should look for
//
// A Todo is a SHARED container listed into a handful of columns; Tasks
// Completed is cloned into every one by the Day Page template. So on 39 of 47
// days `$todo` came back empty, the `ADD_CHILD` was skipped entirely, and the
// check-in was left listed by nothing but the column. The user's report and the
// more reliable anchor are the same change.
//
// ── MATCHED ON THE SYSTEM'S OWN IDENTITY MARKER ────────────────────────────
//
// Every one of the 50 placed Completed boards carries
// `identitySignature: "daypage:Tasks Completed"`, and NOTHING else on the grid
// does — measured before choosing it. That is what the day-page merge writes to
// recognise a section across rebuilds, so it is the fact the app already keeps
// true rather than a marker invented for this op.
//
// The two alternatives were measured and rejected. A LABEL is one rename away
// from wrong. `meta.clonedFromModuleId` names the merge's template link, which
// is honest but INCOMPLETE: 24 of the 50 boards predate it (July and August
// columns, built from two older modules), so a click on one of those days would
// have filed nothing. The signature covers all 50.
//
// The value is RESOLVED from the boards themselves, never typed in.
//
// The vars are renamed with it (`$todoKid` -> `$colKid`, `$todo` ->
// `$doneBoard`): a variable called `$todo` holding the Completed board is the
// kind of lie the next person reads as a bug.
//
// ── AND THE CHECK-INS ALREADY FILED UNDER A TODO MOVE WITH IT ──────────────
//
// Only the LISTING moves. `parentId` still names the day column exactly as the
// op writes it, no occurrence is created or deleted, and a check-in whose
// column has no Tasks Completed is LEFT where it is and reported.

export const id = "0339-a-check-in-belongs-under-tasks-completed";
export const describe =
  "Mood check-ins are listed under each day's Tasks Completed instead of Todo — the operation's "
  + "lookup and the check-ins already filed under a Todo. Creates and deletes nothing.";

const OP_NAME = "Mood: Record Selection";
const DONE_LABEL = "Tasks Completed";

/**
 * PURE — re-point the op's section lookup at the Tasks Completed clone.
 *
 * Two edits, each asserted to land: the loop's IF reads the merge's identity
 * link instead of a Time Slot value, and the three `$todo*` vars are renamed.
 *
 * THROWS when either edit matches nothing — a pipeline patcher that quietly
 * finds nothing leaves an operation that looks repaired and is not.
 */
export function retargetPlacement(pipeline, { doneSignature, timeslotFieldId }) {
  let matched = 0;

  const isTodoTest = (step) => {
    if (step?.type !== "if") return false;
    const rules = step.condition?.rules || [];
    return rules.length === 1
      && rules[0]?.left === `$todoKid.fields.${timeslotFieldId}.value`
      && rules[0]?.right === "Todo";
  };

  const walk = (steps) => (steps || []).map((step) => {
    if (isTodoTest(step)) {
      matched++;
      return {
        ...step,
        condition: {
          ...step.condition,
          rules: [{ left: "$todoKid.identitySignature", comparator: "IS", right: doneSignature }],
        },
      };
    }
    if (step?.type === "if") return { ...step, then: walk(step.then), else: walk(step.else) };
    if (step?.type === "loop") return { ...step, body: walk(step.body) };
    return step;
  });

  const retargeted = { ...pipeline, steps: walk(pipeline?.steps || []) };
  if (matched !== 1) throw new Error(`0339: expected exactly 1 "Todo" section test, found ${matched}`);

  // LONGEST FIRST, or `$todoKidId` would be rewritten by the `$todoKid` pass and
  // the loop would bind a variable nothing reads.
  let json = JSON.stringify(retargeted);
  const renames = [["$todoKidId", "$colKidId"], ["$todoKid", "$colKid"], ["$todo", "$doneBoard"]];
  const renamed = {};
  for (const [from, to] of renames) {
    const hits = json.split(from).length - 1;
    if (!hits) throw new Error(`0339: no ${from} to rename`);
    renamed[from] = hits;
    json = json.split(from).join(to);
  }
  if (json.includes("$todo")) throw new Error("0339: a $todo reference survived the rename");
  return { pipeline: JSON.parse(json), renamed };
}

/** PURE — the occurrence the op copy-links each Check In from. */
export function findCopyLinkSource(pipeline) {
  let found = null;
  const walk = (steps) => (steps || []).forEach((step) => {
    if (step?.actionType === "COPY_LINK" && step?.config?.sourceId) found ||= step.config.sourceId;
    if (step?.type === "if") { walk(step.then); walk(step.else); }
    if (step?.type === "loop") walk(step.body);
  });
  walk(pipeline?.steps || []);
  return found;
}

/**
 * PURE — which check-ins are listed by a Todo, and where each one belongs.
 *
 * `holders` is every occurrence that LISTS the check-in; the move is per
 * holder, because a shared Todo is listed into more than one column and only
 * the check-in's own column decides its destination.
 */
export function planCheckInMoves(occurrences, { todoModuleIds, doneByOcc, checkInSourceId }) {
  // REFUSES A MISSING SOURCE ID rather than defaulting, and that is not
  // defensive noise: without it `child.meta?.copyLinkSource !== undefined`
  // matched every Todo child that is NOT a check-in — a mistyped option key
  // inverted the filter and planned to move the user's real tasks into
  // Completed. Caught on the dry run; a `undefined` that reads as "match
  // everything" is the failure this throw exists for.
  if (!checkInSourceId) throw new Error("0339: planCheckInMoves needs a checkInSourceId");
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const todoSet = new Set(todoModuleIds);
  const moves = [];
  const stranded = [];

  for (const holder of occurrences) {
    if (!todoSet.has(holder.moduleId)) continue;
    for (const childId of holder.occurrences || []) {
      const child = byId.get(childId);
      if (!child || child.meta?.copyLinkSource !== checkInSourceId) continue;
      const column = byId.get(child.parentId);
      const dest = (column?.occurrences || []).find((cid) => doneByOcc.get(cid));
      if (!dest) { stranded.push({ checkIn: childId, from: holder.id, column: column?.id || null }); continue; }
      moves.push({ checkIn: childId, from: holder.id, to: dest });
    }
  }
  return { moves, stranded };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Module, Field, Operation } = models;
  const gid = String(gridId);

  const [occs, mods, fields, op] = await Promise.all([
    Occurrence.find({ gridId: gid }).lean(),
    Module.find({ gridId: gid }).lean(),
    Field.find({ gridId: gid }).lean(),
    Operation.findOne({ gridId: gid, name: OP_NAME }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label || modById.get(o?.moduleId)?.label || o?.id;

  const timeslotField = fields.find((f) => f.name === "Time Slot");

  // THE ANCHOR IS READ OFF THE BOARDS THEMSELVES, then checked to be UNIQUE on
  // the grid — a signature shared with anything else would make the op file
  // check-ins into whatever else carries it.
  //
  // REFUSES on more than one distinct signature rather than picking the popular
  // one: two signatures means two Completed sections, and guessing which is
  // "the" one is how 0035 moved a real page.
  const doneOccs = occs.filter((o) => nameOf(o) === DONE_LABEL
    && modById.get(o.moduleId)?.role === "container");
  const signatures = [...new Set(doneOccs.map((o) => o.identitySignature).filter(Boolean))];
  const doneSignature = signatures.length === 1 ? signatures[0] : null;
  const carriers = doneSignature
    ? occs.filter((o) => o.identitySignature === doneSignature) : [];
  const unique = doneSignature && carriers.length === doneOccs.length;

  // The op names its own Check In source — reading it from there rather than
  // guessing which occurrence is "the" check-in template.
  const checkInSource = findCopyLinkSource(op?.pipeline);

  if (!timeslotField || !unique || !checkInSource || !op) {
    log(`  REFUSING: TimeSlot=${!!timeslotField} "${DONE_LABEL}" placements=${doneOccs.length} `
      + `distinct signatures=${signatures.length} carriers=${carriers.length} `
      + `checkInSource=${checkInSource || "none"} op=${!!op} — nothing written.`);
    return { changed: 0 };
  }

  // The one-off move reads the SAME signature the op will read, so the rows
  // this files and the rows it files from now on cannot end up in different
  // places.
  const doneByOcc = new Map(carriers.map((o) => [o.id, true]));
  const todoModuleIds = mods
    .filter((m) => m.role === "container" && /^todo$/i.test(m.label || "")).map((m) => m.id);

  const opPlan = retargetPlacement(op.pipeline, { doneSignature, timeslotFieldId: timeslotField.id });
  const alreadyRetargeted = JSON.stringify(op.pipeline).includes("$doneBoard");
  const { moves, stranded } = planCheckInMoves(occs, { todoModuleIds, doneByOcc, checkInSourceId: checkInSource });

  log(`  ${DONE_LABEL}: signature "${doneSignature}" on all ${doneOccs.length} placement(s), `
    + `carried by nothing else on the grid`);
  log(`  ${OP_NAME}: ${alreadyRetargeted ? "already re-pointed" : `re-pointing (${JSON.stringify(opPlan.renamed)})`}`);
  log(`  check-ins listed by a Todo: ${moves.length}${stranded.length ? ` · ${stranded.length} with no Tasks Completed in their column — LEFT` : ""}`);
  for (const m of moves.slice(0, 10)) {
    log(`    ${m.checkIn.slice(0, 8)}  ${nameOf(byId.get(m.from))} -> ${nameOf(byId.get(m.to))} [${m.to.slice(0, 8)}]`);
  }
  for (const s of stranded) log(`    STRANDED ${s.checkIn.slice(0, 8)} in ${nameOf(byId.get(s.from))}`);

  if (dryRun) { log("  Dry run — nothing written."); return { changed: 0 }; }
  if (alreadyRetargeted && !moves.length) return { changed: 0 };

  if (!alreadyRetargeted) {
    await Operation.updateOne({ gridId: gid, id: op.id }, { $set: { pipeline: opPlan.pipeline } });
  }
  for (const m of moves) {
    await Occurrence.updateOne({ gridId: gid, id: m.from }, { $pull: { occurrences: m.checkIn } });
    await Occurrence.updateOne({ gridId: gid, id: m.to }, { $addToSet: { occurrences: m.checkIn } });
  }

  // Read the RESULT back out of the database, not off the plan.
  const after = await Occurrence.find({ gridId: gid }).lean();
  const left = planCheckInMoves(after, { todoModuleIds, doneByOcc, checkInSourceId: checkInSource });
  if (left.moves.length) throw new Error(`0339: ${left.moves.length} check-in(s) still listed by a Todo`);
  const afterById = new Map(after.map((o) => [o.id, o]));
  const landed = moves.filter((m) => (afterById.get(m.to)?.occurrences || []).includes(m.checkIn)).length;
  if (landed !== moves.length) throw new Error(`0339: ${moves.length - landed} check-in(s) did not land`);
  const opAfter = await Operation.findOne({ gridId: gid, id: op.id }).lean();
  if (!JSON.stringify(opAfter.pipeline).includes("$doneBoard")) {
    throw new Error("0339: the operation still files check-ins under $todo");
  }
  log(`  ${landed} check-in(s) moved into Tasks Completed; none created or deleted.`);
  return { changed: landed + 1 };
}
