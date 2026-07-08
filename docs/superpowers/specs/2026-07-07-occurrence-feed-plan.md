# Occurrence "Feed" option — plan + AS-BUILT record (2026-07-07, SHIPPED)

> User ask: "a feed option in the occurrence menu for the respected occurrences. so I can pull,
> using the filter menu as the conditions, from all the occurrences, and display them. filters can
> still be applied after the fact but these are pulled in. make it a plan first." + "review if this
> is a sound addition."

## AS BUILT (same day — user pivoted the design during review)

The pure-view model below was superseded by user direction: **feeds MATERIALIZE
copy-links** ("it should be a copy of the occurrence added to the parent…
copylinks"), copies render **alongside** the owner's own children ("don't hide
the container's old children"), are **drag-locked to copy mode** ("lock the
feeded occurrences in copy mode"), feeds work on **pages too**, and the feature
**replaces the Table: Build / Canvas: Build ops**.

Shipped shape (commit `feat(feed)` 2026-07-07):
- `occurrence.feed = { enabled, conditions[], roles[], scope, sort, limit }` (Occurrence schema key).
- `state/selectors.js resolveFeedItems` — the query (skips feed copies, the owner, its ancestors + descendants).
- `helpers/feedSync.js` — the engine: scan-based diff (`meta.feedSourceId` + parentId), mint missing
  via `copylinkInstanceToContainer` (dragMode:"copy", fireTrigger:false), sweep stale/duplicates
  (fireTrigger:false), re-link unreferenced survivors, accumulate the parent ref across writes.
  Debounced scheduler in bindSocketToStore (full_state / filter changes / occurrence CRUD).
- Derived-data hygiene: `createOccurrence`/`removeOccurrence` gained `fireTrigger`;
  `operationsBridge.markDerivedOcc` suppresses server echoes. Trackers exclude
  `meta.feedSourceId` items (makeTrackerOp + inline ancestor-scoped trackers).
- Renderers: ContainerTable renders child occurrences as generated rows (per-column
  fieldVisibility projection); PageCanvas stacks position-less cards near the world center.
- `ui/FeedSection.jsx` in container + page header menus (toggle, conditions, roles, scope, sort,
  limit, live match count).
- Seed: `Table: Build` + `Canvas: Build` deleted; Schedule Table/Canvas pages carry seeded feeds +
  inherit the date cascade; table's Goal column removed.

Known v1 limits: feed sort is lexical on the field value (timeslot labels don't sort numerically);
canvas fallback stack overlaps tall cards until dragged; the table's child rows ignore
table-level sort/filter (they follow feed order after persisted rows).

The original pure-view plan (historical) follows.

## Soundness review (honest)

**Verdict: sound, with one non-negotiable design rule.** The system already has this concept in
two data layers — field `optionsSource` find-mode (collection + predicate → options) and the ops
`FIND` action (collection + predicate → bound records). A feed is the third leg: *a rendered FIND*.
Same grammar, same evaluator (`evalRuleAgainstRecord`), same condition shape the filter menu
already edits. Nothing new is invented; an existing capability gains a display surface. That is
exactly the "identity/config = data the system can introspect" rule.

**The non-negotiable rule: a feed is a VIEW, never a re-parenting.** Pulled items must NOT be
linked into the feed container's `occurrences[]` and must NOT get `parentId` writes. Ancestry is
load-bearing everywhere: the filter cascade, `HAS_ANCESTOR` tracker scopes, `_effectiveFilter`
resolution, move semantics. If pulling an item into a feed changed its ancestry, a task pulled
into a "All overdue" feed would suddenly stop counting under Schedule. Feed resolution therefore
happens at render time, derived not stored — the same philosophy as `computedValues`.

**Overlap check (why this isn't redundant):**
- *Filters* hide/show children you already own. *Feeds* pull items you don't own. Complementary:
  feed = source query, filter cascade = post-hoc narrowing (the user's "filters can still be
  applied after the fact" is exactly the existing cascade running on the pulled set).
- *Table: Build / Canvas: Build / People Table: Build* materialize COPY_LINK mirrors via ops
  today. For pure display cases a feed does the same job with zero materialization — no mirror
  occurrences, no orphan sweeps, no linked-group fan-out. Long-term, some mirror ops could migrate
  to feeds (out of scope here, but it's a sign the primitive pulls its architectural weight).

**Real tensions to design around (not blockers):**
1. **Ordering** — feed items aren't owned, so drag-reorder has nothing to persist to. Feeds get a
   declarative `sort` (field + direction) instead; manual reorder is out (Phase 1–3).
2. **Drops into a feed** — ambiguous (no owned child list). Phase 1 rejects with a toast; a later
   phase MAY interpret a drop as "stamp the fields that would make this item match" (powerful but
   needs its own design pass).
3. **Duplicates** — the same occurrence can render in its real home AND in N feeds. That's the
   multi-view nature of the system already (mirrors do this today); field edits propagate for free
   because feed rows render the REAL occurrence.
4. **Cost** — a grid-wide predicate scan per feed per render. Bounded by memoizing on the
   occurrences-map identity + a per-feed `limit` (default 50). Same order of work the options
   resolver already does per dropdown open.

## Data shape

New first-class key on Occurrence (sibling of `filters` / `fieldVisibility`, NOT `meta.*` — it
drives data selection, not a UI affordance):

```js
occurrence.feed = {
  enabled: true,
  // Same condition rows the filter menu produces — one grammar everywhere.
  conditions: [{ id, fieldId, comparator, value }],       // AND group (v1)
  roles: ["instance"],                                     // which roles are pullable (default instance)
  scope: null | <occId>,                                   // null = whole grid; occId = HAS_ANCESTOR that occ
  sort: { fieldId, dir: "asc" | "desc" } | null,           // declarative order
  limit: 50,
}
```

Server: add `feed` to the Occurrence schema (Mixed, default null). No other server work — feeds
resolve client-side.

## Resolution (client)

`state/selectors.js` → `resolveFeedItems(feedOcc, { occurrencesById, modulesById, fieldsById })`:
1. Candidate set: all occurrences of the configured roles (skip the feed occ itself + its own
   ancestors; cycle-guard feeds-rendering-feeds by depth 1 — a feed never renders another feed's
   pulled rows, only its chip).
2. Enrich `_ancestors` (shared `buildParentMap`) and evaluate `conditions` via
   `evalRuleAgainstRecord` — identical semantics to optionsResolver find-mode.
3. Apply `scope` (HAS_ANCESTOR), `sort`, `limit`.
4. Memoize on the occurrences-map identity (same pattern as `makeEffectiveFilterResolver`).

## Render

`ModuleContainer` (list/board kinds first): when `occ.feed?.enabled`, the child list renders
`resolveFeedItems(...)` instead of `occurrences[]`. Each row is the REAL occurrence via the normal
`ModuleInstance` path — field pills live, toggles fire MeasureOps, trackers unaffected. The
container shows a small feed badge (antenna icon) so pulled content is distinguishable from owned
content. The existing filter cascade then runs `isOccurrenceVisible` over the pulled rows with the
FEED container's effective filters — "filters applied after the fact" falls out of the current
code path untouched.

Drag: rows are drag-SOURCES as normal (move = moves the real occurrence out of its REAL parent —
surfaced in the drag pill; copy/copy-link normal). The feed container itself is not a drop target
(Phase 1).

## Occurrence-menu entry (the ask)

`HeaderDropdown` gains a **Feed** section (container-role occurrences, list/board kinds v1):
- toggle (off by default),
- condition rows — reuse the FiltersSection row editor verbatim (field picker + comparator +
  value; same components, same shapes),
- scope picker (grid-wide / under an occurrence via DrilldownPicker),
- sort field + direction, limit.

## Phases

1. **Schema + resolver + render** — hand-authored `feed` object works end-to-end (read-only list,
   badge, cascade-after). Tests: resolver unit tests + a liveOpsBehavioral case (feed pulls
   completed schedule items; toggling one updates the real tracker AND the feed row).
2. **Menu editor** — the HeaderDropdown Feed section.
3. **Sort / limit / scope polish** + feed badge/count in header.
4. **Interactions** — decide drop-into-feed semantics (field-stamping proposal), board-kind
   columns, page-level feeds.
5. **(Optional, later)** migrate display-only mirror ops (Canvas: Build class) onto feeds.

## Open questions for the user
- When a feed is ON, should the container's OWN children hide entirely (proposed: yes — one
  container, one source of truth per mode), or render above the pulled rows?
- Should feeds be allowed on pages (a whole "feed page") in v1, or containers only?
- Default roles: instances only, or also textblocks/artifacts?
