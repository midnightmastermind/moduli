// helpers/feedSync.js
//
// The FEED engine (2026-07-07). A feed (`occurrence.feed = { enabled,
// conditions, roles, scope, sort, limit }`) is a MATERIALIZED FIND: for every
// source occurrence matching the feed's conditions (+ the owner's effective
// filter — the date cascade), the engine mints a COPY-LINKED child of the
// feed owner; copies whose source stops matching are swept. This is the
// declarative, generic replacement for the hand-authored mirror ops
// (Table: Build / Canvas: Build): same diff semantics (mint missing, sweep
// stale, never touch surviving copies — manual canvas positions persist),
// one engine instead of per-page pipelines.
//
// Invariants:
// - Copies carry `meta.feedSourceId = <source occ id>` — the ONLY marker the
//   sweep trusts (hand-placed children are never touched).
// - Copies are drag-locked to copy mode (`dragMode: "copy"`): moving one
//   away would just make the next sync mint a replacement, so the fight is
//   removed at the source.
// - Feed copies are never SOURCES (resolveFeedItems skips meta.feedSourceId)
//   — no copy-of-copy cascades between feeds.
// - Sweeps use fireTrigger:false (derived data — tracker re-aggregation over
//   a swept mirror is pure waste; trackers also exclude feed copies by rule).
import * as CommitHelpers from "./CommitHelpers";
import { runDerived } from "./actionScope";
import { isPullOnlyFeed } from "./feedPull";
import * as LayoutHelpers from "./LayoutHelpers";
import {
  resolveFeedItems,
  getEffectiveFilterForOccurrence,
  getLocalFilterConditions,
  isOccurrenceVisible,
} from "../state/selectors";

// One sync pass for ONE feed owner. Returns { minted, swept } counts.
export function syncFeed(feedOcc, { state, occurrencesById, modulesById, dispatch, socket, diag = false }) {
  const feed = feedOcc?.feed;
  if (!feed?.enabled) return { minted: 0, swept: 0, bail: "disabled" };

  // A PULL-ONLY feed reads its matches and owns none of them (helpers/feedPull).
  // It mints nothing — and SWEEPS anything it minted before, so a graph that
  // used to materialise its rows heals itself on the next pass instead of
  // needing a migration to chase the leftovers. Sweeping is safe by the same
  // rule the normal path relies on: a copy carries `meta.feedSourceId`, so only
  // rows THIS feed minted are ever removed, never a hand-placed child.
  if (isPullOnlyFeed(feedOcc)) {
    const owned = Object.values(occurrencesById || {})
      .filter(o => o?.meta?.feedSourceId && o.parentId === feedOcc.id);
    for (const o of owned) {
      CommitHelpers.removeOccurrence({
        dispatch, socket,
        occurrenceId: o.id,
        occurrence: o,
        // The parent ref matters: removeOccurrence unlinks from the owner's
        // occurrences[] as well as deleting the row. Omitting it would leave
        // the owner listing ids that no longer exist — the dangling-child-ref
        // class this repo has repaired five times.
        parentOccurrence: occurrencesById[feedOcc.id] || feedOcc,
        emit: true,
        fireTrigger: false, // derived data — no tracker churn, echo suppressed
      });
    }
    return { minted: 0, swept: owned.length, bail: "pull-only" };
  }
  const gridId = state?.gridId || state?.grid?._id;
  const userId = state?.userId;
  if (!gridId || !userId) return { minted: 0, swept: 0, bail: `no ${!gridId ? "gridId" : "userId"}` };

  // 1. Which sources match RIGHT NOW — feed conditions first, then the
  //    owner's effective filter (the "pulled for the active period" rule:
  //    the same date cascade every rendered child already obeys). Grid
  //    named-filter conditions + the owner's local filters both apply, so a
  //    feed on the Schedule Table page follows the page's date exactly like
  //    the old Table: Build's SAME_DAY predicate did.
  const matches = resolveFeedItems(feedOcc, { occurrencesById, modulesById });
  const effectiveFilters = getEffectiveFilterForOccurrence(feedOcc, {
    grid: state?.grid, occurrencesById,
  });
  const activeNamedFilter = (state?.grid?.namedFilters || []).find(f => f.id === state?.grid?.activeFilterId) || null;
  const conditions = [
    ...(activeNamedFilter?.conditions || []),
    ...getLocalFilterConditions(feedOcc),
  ];
  const visible = matches.filter(m =>
    isOccurrenceVisible(m.occurrence, effectiveFilters, conditions.length ? conditions : null));
  if (diag && matches.length !== visible.length) {
    console.log(`[feedDiag]     "${feedOcc.label || feedOcc.id}" filtered out ${matches.length - visible.length} of ${matches.length} by the effective filter`, effectiveFilters);
  }

  // 2. Diff against the copies this feed already minted — found by SCAN
  //    (meta.feedSourceId + parentId), NOT by the parent's occurrences[]
  //    list: a copy whose parent-link write raced (debounced passes overlap
  //    the server round-trip) would otherwise read as missing and get
  //    re-minted as a duplicate. Scan-diff makes every pass self-healing.
  const existingBySource = new Map();
  const duplicates = [];
  for (const o of Object.values(occurrencesById)) {
    if (!o?.meta?.feedSourceId || o.parentId !== feedOcc.id) continue;
    if (existingBySource.has(o.meta.feedSourceId)) duplicates.push(o);
    else existingBySource.set(o.meta.feedSourceId, o);
  }
  const wantedSourceIds = new Set(visible.map(m => m.occurrence.id));

  // 3. Sweep duplicates + copies whose source no longer matches.
  let swept = 0;
  const sweep = (copy) => {
    CommitHelpers.removeOccurrence({
      dispatch, socket,
      occurrenceId: copy.id,
      occurrence: copy,
      parentOccurrence: occurrencesById[feedOcc.id] || feedOcc,
      emit: true,
      fireTrigger: false, // derived data — no tracker churn, echo suppressed
    });
    swept++;
  };
  for (const dup of duplicates) sweep(dup);
  for (const [srcId, copy] of existingBySource) {
    if (!wantedSourceIds.has(srcId)) sweep(copy);
  }

  // LIVE parent ref accumulated across re-links AND mints — every
  // occurrences[] write derives from the object it's handed, so each step
  // must see the previous step's append (stale reads = last-write-wins
  // clobber; 2026-07-07 headless find).
  let parentOcc = occurrencesById[feedOcc.id] || feedOcc;

  // 3b. Re-link surviving copies the parent list lost (the raced write case)
  //     instead of minting a second copy.
  const parentListed = new Set(parentOcc.occurrences || []);
  for (const [srcId, copy] of existingBySource) {
    if (!wantedSourceIds.has(srcId) || parentListed.has(copy.id)) continue;
    LayoutHelpers.addInstanceToContainer({
      dispatch, socket,
      containerOccurrence: parentOcc,
      occurrenceId: copy.id,
      index: null,
      emit: true,
    });
    parentOcc = { ...parentOcc, occurrences: [...(parentOcc.occurrences || []), copy.id] };
  }

  // 4. Mint copy-links for new matches. Surviving copies are untouched —
  //    their manual state (canvas meta.x/y, field edits via the linked
  //    group) persists across syncs, same as the old Canvas: Build diff.
  let minted = 0;
  for (const m of visible) {
    if (existingBySource.has(m.occurrence.id)) continue;
    const toContainer = { id: feedOcc.moduleId, _occurrence: parentOcc };
    const res = LayoutHelpers.copylinkInstanceToContainer({
      dispatch, socket, gridId, userId,
      sourceInstanceId: m.occurrence.moduleId,
      sourceOccurrenceId: m.occurrence.id,
      sourceOccurrence: m.occurrence,
      toContainer,
      emit: true,
      initialMeta: { feedSourceId: m.occurrence.id },
      dragMode: "copy",   // feed copies are drag-locked to copy mode
      fireTrigger: false, // derived data — no OccurrenceCreateOp, echo suppressed
    });
    if (res?.occurrence?.id) {
      minted++;
      parentOcc = { ...parentOcc, occurrences: [...(parentOcc.occurrences || []), res.occurrence.id] };
    }
  }
  return { minted, swept, matches: matches.length, visible: visible.length, existing: existingBySource.size };
}

// Sync EVERY enabled feed on the grid. Called after full_state settles and
// (debounced) after filter changes / occurrence CRUD — the same moments the
// old Build ops' trigger objects covered, minus the per-op wiring.
export function syncAllFeeds(args) {
  // Feed sync materialises a query — it is the app keeping a view in step, not
  // something the user did, so its mints and sweeps must never be undo steps.
  // Each write helper opens its own action (`derived = !actionId`), so without
  // this a sync that mints 20 copies puts 20 steps on the stack.
  return runDerived(() => _syncAllFeeds(args));
}

function _syncAllFeeds({ state, occurrencesById, modulesById, dispatch, socket }) {
  let minted = 0, swept = 0, feeds = 0;
  // `window.__feedDiag = true` prints a per-feed breakdown. A feed that mints
  // nothing is indistinguishable from a feed that never ran, which is exactly
  // the ambiguity that made the 2026-07-29 under-population hard to pin down.
  const diag = typeof window !== "undefined" && window.__feedDiag === true;
  const rows = [];
  for (const occ of Object.values(occurrencesById || {})) {
    if (!occ?.feed?.enabled) continue;
    feeds++;
    const r = syncFeed(occ, { state, occurrencesById, modulesById, dispatch, socket, diag });
    minted += r.minted; swept += r.swept;
    if (diag) rows.push({ owner: occ.label || occ.id, ...r });
  }
  if (diag) {
    console.log(`[feedDiag] ${feeds} feed(s) visited; minted ${minted}, swept ${swept}`);
    for (const r of rows) console.log(`[feedDiag]   "${r.owner}" matches=${r.matches} visible=${r.visible} existing=${r.existing} minted=${r.minted} swept=${r.swept}${r.bail ? ` BAIL:${r.bail}` : ""}`);
  }
  if (minted || swept) console.log(`[feedSync] minted ${minted}, swept ${swept}`);
  return { minted, swept, feeds };
}
