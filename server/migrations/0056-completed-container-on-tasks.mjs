// server/migrations/0056-completed-container-on-tasks.mjs
//
// A **Completed** container at the bottom of the Tasks page, collecting
// anything on that page you have ticked off.
//
// User, 2026-08-07: "make sure for the tasks op too that if i finish a todo, it
// gets put in a completed container at the bottom of the tasks page. include
// appointments there too after the date passes for it."
//
// ── THIS SHIPS THE FIRST HALF ONLY, AND THAT SPLIT WAS MEASURED ─────────────
//
// The two halves have different predicates, and only one of them is expressible
// today:
//
//   a todo        -> lands here when Completed goes true          ✅ THIS FILE
//   an appointment-> lands here when its DATE HAS PASSED          ❌ blocked
//
// Feed conditions ARE evaluated by `evalRule` (`selectors.js:568`) and
// `DATE_BEFORE` exists — but **`$vars` is passed EMPTY (`{}`)**, so `$today`
// cannot resolve, and a literal date in the condition goes stale tomorrow.
//
// The one apparent escape hatch is real but useless here: an empty `cond.value`
// falls back to the owner's effective filter (`selectors.js:546-548`). **The
// Tasks page carries `filterOverride: {}`** — the documented opt-out-of-date-
// filtering marker — so the cascade deletes the date key, `rightVal` lands
// `undefined`, and `if (rightVal == null) continue` SKIPS the condition
// entirely. A DATE_BEFORE feed there would match EVERY appointment regardless
// of date: silently wrong, which is worse than not shipping it.
//
// The date half therefore waits on teaching the feed evaluator to resolve
// `$today` — a small change, but `isOccurrenceVisible` is on the hot render
// path with 37 live feeds going through it, so it gets its own pass.
//
// ── WHY A FEED AND NOT AN OP THAT MOVES ROWS ────────────────────────────────
//
// A feed is a materialized FIND: it self-heals every sync and cannot lose the
// user's row. An op that MOVED completed rows would be a destructive write on
// live data, and un-ticking something would have to move it back — two
// operations that can disagree. **Consequence, stated plainly: a completed todo
// appears in BOTH its own container and Completed.** The copy is copy-linked,
// so un-ticking in either place clears both and the copy disappears on the next
// sync. If the user wants it gone from the original, that is a separate change
// to the SOURCE container, not to this one.
//
// ── LIMIT IS EXPLICIT ON PURPOSE ────────────────────────────────────────────
//
// `resolveFeedItems` reads `Number(feed.limit) > 0 ? Number(feed.limit) : 50` —
// so `limit: 0` means FIFTY, not unlimited. That silently drew a third of the
// emotions wheel on 2026-08-06. There is no unlimited sentinel; pick a number
// above what the page can plausibly hold.

export const id = "0056-completed-container-on-tasks";

const uid = () => (globalThis.crypto?.randomUUID?.()
  || `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const CONTAINER_LABEL = "Completed";
const FEED_LIMIT = 300;

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;

  // ── The Completed field, by NAME AND TYPE ────────────────────────────────
  const fields = await Field.find({ gridId }).lean();
  const fCompleted = fields.find(
    (f) => (f.name || "").trim().toLowerCase() === "completed" && f.type === "boolean",
  );
  if (!fCompleted) {
    log("REFUSING: no boolean field named Completed");
    return;
  }
  log(`Completed field ${fCompleted.id}`);

  // ── The Tasks page ───────────────────────────────────────────────────────
  const tasksMods = await Module.find({ gridId, role: "page", label: "Tasks" }).lean();
  const tasksOcc = tasksMods.length
    ? await Occurrence.findOne({ gridId, moduleId: { $in: tasksMods.map((m) => m.id) } }).lean()
    : null;
  if (!tasksOcc) { log("REFUSING: no Tasks page on this grid"); return; }

  const kidIds = tasksOcc.occurrences || [];
  const kids = await Occurrence.find({ gridId, id: { $in: kidIds } }).lean();
  const kidMods = await Module.find({ gridId, id: { $in: kids.map((k) => k.moduleId) } }).lean();
  const kidModById = Object.fromEntries(kidMods.map((m) => [m.id, m]));
  log(`Tasks page ${tasksOcc.id} — ${kidIds.length} children`);

  // ── Idempotent, scoped to the page's OWN children ────────────────────────
  // A global label match would let some other "Completed" on the grid decide
  // this already existed (0035's selector class).
  const existing = kids.find(
    (k) => (kidModById[k.moduleId]?.label || "").toLowerCase() === CONTAINER_LABEL.toLowerCase(),
  );

  const feed = {
    enabled: true,
    conditions: [{ fieldId: fCompleted.id, comparator: "IS", value: true }],
    roles: ["instance"],
    // Sources must have the Tasks page as an ANCESTOR — without this the feed
    // pulls every completed instance on the grid (every Routines action, every
    // schedule row), which is hundreds of rows and not what "my tasks" means.
    scope: tasksOcc.id,
    sort: null,
    limit: FEED_LIMIT,
  };

  if (existing) {
    // Find-then-PATCH rather than early-return: a container minted by an
    // earlier partial run should be repaired, not left half-configured.
    const same = JSON.stringify(existing.feed || null) === JSON.stringify(feed);
    if (same) {
      log(`"${CONTAINER_LABEL}" already present and correctly fed — nothing to do`);
    } else {
      log(`PATCH  "${CONTAINER_LABEL}" feed (was ${existing.feed ? "different" : "absent"})`);
      if (!dryRun) {
        await Occurrence.updateOne({ gridId, id: existing.id }, { $set: { feed } });
      }
    }
    // Still make sure it sits LAST.
    await moveLast(existing.id);
    return;
  }

  const modId = uid();
  const occId = uid();
  log(`ADD    container "${CONTAINER_LABEL}" at the BOTTOM of the Tasks page`);
  log(`         feed: Completed IS true · scope=Tasks page · roles=[instance] · limit=${FEED_LIMIT}`);

  if (!dryRun) {
    await new Module({
      id: modId, userId: tasksOcc.userId, gridId,
      role: "container",
      kind: "board",
      label: CONTAINER_LABEL,
      fieldBindings: [],
    }).save();

    await new Occurrence({
      id: occId, userId: tasksOcc.userId, gridId,
      moduleId: modId,
      targetId: modId, targetType: "module",
      parentId: tasksOcc.id,
      fields: {},
      feed,
      occurrences: [],
    }).save();

    // Append — `$push` with a `$ne` guard, never a whole-array write. The array
    // IS the render order, so appending is literally "at the bottom".
    await Occurrence.updateOne(
      { gridId, id: tasksOcc.id, occurrences: { $ne: occId } },
      { $push: { occurrences: occId } },
    );
  }

  /** Ensure `id` is the LAST entry of the Tasks page's child list. */
  async function moveLast(id) {
    const fresh = await Occurrence.findOne({ gridId, id: tasksOcc.id }).lean();
    const arr = fresh?.occurrences || [];
    if (arr[arr.length - 1] === id) return;
    const next = [...arr.filter((x) => x !== id), id];
    log(`MOVE   "${CONTAINER_LABEL}" to the bottom (was index ${arr.indexOf(id)} of ${arr.length})`);
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: tasksOcc.id }, { $set: { occurrences: next } });
    }
  }
}
