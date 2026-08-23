// utils/gridIntegrity.js
//
// Structural checks a seeded grid must pass. Every problem found in the
// 2026-07-29 audit is representable here, which is the point: these were all
// silent, and each one was found by hand months after it was introduced.
//
// Pure — takes plain arrays, returns findings. The seed runs it after building
// (so a bad seed fails loudly instead of shipping), and it can be run against
// a live grid to check for drift.

/**
 * @param {{grid, occurrences, modules, fields, operations, folders}} world
 * @returns {Array<{level:"error"|"warn", code:string, message:string, ids?:string[]}>}
 */
// Roles where `kind` is a real sub-type. THE list — migration 0076 imports it
// rather than restating it, because a second copy of exactly this is what let
// the 2026-07-29 kind removal come back (the CREATE action was fixed and the
// effect applier, which had its own copy of the default, was not).
import { planOrphanModules, collectReferencedModuleIds } from "./orphanModules.js";

// Above this many orphan modules the finding is an ERROR, not a warning: it has
// stopped being the ordinary residue of a few deletes. Chosen against the live
// number (135) and the count a single day's schedule rebuild can strand (~50),
// so one bad day warns and a month of them fails.
export const ORPHAN_MODULE_ERROR_AT = 100;

export const KIND_BEARING_ROLES = new Set(["container", "page", "artifact", "textblock"]);

export function checkGridIntegrity({ grid = null, occurrences = [], modules = [], fields = [], operations = [], folders = [], textmaps = null } = {}) {
  const findings = [];
  const add = (level, code, message, ids) => findings.push({ level, code, message, ...(ids?.length ? { ids: ids.slice(0, 12) } : {}) });

  const occById = new Map(occurrences.map(o => [o.id, o]));
  const modById = new Map(modules.map(m => [m.id, m]));
  // Every id some occurrence lists as a child. Rule 7c asks the inverse
  // question — which occurrences nobody lists — so the set is built once.
  const listedChildIds = new Set();
  for (const o of occurrences) for (const c of o.occurrences || []) listedChildIds.add(c);

  // 1. Dangling child refs — a parent listing children that do not exist.
  //    Cause: the create/update asymmetry on disconnect (fixed at source
  //    2026-07-29). 60 of these were live when the check was written.
  const dangling = [];
  for (const o of occurrences) {
    for (const c of o.occurrences || []) if (!occById.has(c)) dangling.push(`${o.id}→${c}`);
  }
  if (dangling.length) add("error", "dangling-child-ref",
    `${dangling.length} child id(s) in occurrences[] point at documents that do not exist`, dangling);

  // 2. Occurrences that cannot render because their template is unreachable.
  //
  //    SPLIT INTO TWO CODES 2026-08-07, because they were being reported as one
  //    and the single message was wrong for most of what it matched. Measured on
  //    test grid 2: 22 flagged, and **21 of them carried no `moduleId` at all** —
  //    "references a module that does not exist" describes a pointer, and there
  //    was no pointer. The two have different causes and different remedies:
  //
  //      module-less-occurrence — no moduleId. The occurrence's own create
  //        landed while its MODULE's did not (the documented create/disconnect
  //        asymmetry, one level up). Nothing to repair TO; the row is garbage.
  //
  //      missing-module — moduleId names a module absent from THIS GRID. The
  //        module document may still exist globally (measured: one, carrying
  //        `gridId: undefined`). Grid-scoped is deliberate and matches what the
  //        client is sent: a module outside this grid is not in `full_state`, so
  //        the occurrence renders as nothing either way.
  //
  //    WHY THIS DISAGREES WITH `sweepOrphans`, and why neither is broken (the
  //    2026-08-04 "one predicate is wrong" note, settled): the two answer
  //    DIFFERENT questions. This asks "would it render?" — no, so it is an
  //    error. The sweep asks "is it safe to delete?" and refuses anything
  //    holding content, which those 21 do (children + textmaps). A reported row
  //    the sweep declines is the system working, not a contradiction — the sweep
  //    is a safety predicate, not a completeness one.
  const moduleLess = [];
  const missingModule = [];
  for (const o of occurrences) {
    if (!o.moduleId) moduleLess.push(o.id);
    else if (!modById.has(o.moduleId)) missingModule.push(o.id);
  }
  if (moduleLess.length) add("error", "module-less-occurrence",
    `${moduleLess.length} occurrence(s) carry no moduleId at all — nothing to render, and nothing to repair to`, moduleLess);
  if (missingModule.length) add("error", "missing-module",
    `${missingModule.length} occurrence(s) reference a module that does not exist on this grid`, missingModule);

  // 3. Two ENABLED operations writing the same PRESENTATION target
  //    (`ownStyle.*` or `label`). Scoped deliberately: several ops writing the
  //    same FIELD is normal and usually intentional — the six per-muscle Volume
  //    trackers all feed Total Reps, and Stamp/Clear Date are a set/clear pair.
  //    Presentation targets are different: they carry no aggregation semantics,
  //    so two writers means last-write-wins and one of them is dead weight.
  //    "Mark Passed Timeslots" and "Schedule: Mark Passed Slots" both wrote
  //    $slot.ownStyle.bg at different cadences, so the slower one stomped the
  //    faster one's green current-slot tint every half hour.
  //    A check that cries wolf gets ignored, so this one stays narrow.
  const writesByTarget = new Map();
  for (const op of operations) {
    if (op.enabled === false) continue;
    const json = JSON.stringify(op.pipeline || {});
    for (const m of json.matchAll(/"path":"(\$[A-Za-z0-9_]+\.(ownStyle\.[A-Za-z0-9_.]+|label))"/g)) {
      // Normalise the loop variable away: $slot.ownStyle.bg and $s.ownStyle.bg
      // are the same target expressed by different authors.
      const target = m[1].replace(/^\$[A-Za-z0-9_]+\./, "");
      if (!writesByTarget.has(target)) writesByTarget.set(target, new Set());
      writesByTarget.get(target).add(op.name);
    }
  }
  for (const [target, names] of writesByTarget) {
    if (names.size > 1) add("warn", "contended-write-target",
      `${names.size} enabled operations write "${target}": ${[...names].join(", ")}`);
  }

  // 4. Fields that nothing binds, nothing values, and no operation mentions.
  const bound = new Set();
  for (const m of modules) for (const b of m.fieldBindings || []) if (b?.fieldId) bound.add(b.fieldId);
  const valued = new Set();
  for (const o of occurrences) for (const k of Object.keys(o.fields || {})) valued.add(k);
  const opJson = JSON.stringify(operations);
  const deadFields = fields
    .filter(f => !bound.has(f.id) && !valued.has(f.id) && !opJson.includes(f.id))
    .map(f => f.name);
  if (deadFields.length) add("warn", "unused-field",
    `${deadFields.length} field(s) are never bound, never valued and referenced by no operation`, deadFields);

  // 4b. Modules that no occurrence places. THE INVERSE of rule 1 — that one
  //     catches an occurrence whose module is gone; this one catches a module
  //     nothing renders. There was no rule for it, which is exactly how poms
  //     grid reached **135** of them unnoticed (user, 2026-08-23: "why do we
  //     keep having so many of them").
  //
  //     TWO CAUSES, and the count is the symptom of both. Placing a row CLONES
  //     its module (`cloneSubtree` mints one per node), so the grid carries
  //     ~1 module per occurrence — `Eat` alone had 78 for one concept. And
  //     removing a placement only sweeps the clone on the RUNTIME path
  //     (`delete_occurrence`); a migration writes straight to Mongo and skips
  //     it, so 31 occurrence-deleting migrations mostly leave the modules.
  //
  //     IT REUSES `planOrphanModules` — the predicate the sweeper deletes by —
  //     rather than asking the same question a second way. A preview computed
  //     differently is a preview of something else, and its refusals (a
  //     template root is MEANT to have no placement; an op or textmap
  //     reference makes a module reachable; a module minted seconds ago may
  //     have a placement still in flight) are the whole safety of the number.
  //
  //     IT SKIPS ENTIRELY WITHOUT `textmaps`. A textmap can embed a module, so
  //     a caller that cannot decompress them would make this rule flag live
  //     modules — the cry-wolf guard that gets weakened the first time it
  //     fires. Reporting nothing is better than reporting a number nobody can
  //     stand behind; `scripts/checkGrid.js` supplies them.
  if (Array.isArray(textmaps)) {
    const modIds = new Set(modules.map((m) => m.id));
    const referencedIds = collectReferencedModuleIds(
      [...operations, ...textmaps, ...(grid?.meta ? [{ meta: grid.meta }] : [])], modIds);
    const { drop } = planOrphanModules({ modules, occurrences, referencedIds });
    if (drop.length) {
      // WARN below the threshold: an orphan renders nothing and corrupts
      // nothing — it is waste, not damage. ERROR above it, because at that
      // point it has stopped being incidental and a warning is what let the
      // last 135 accumulate in silence.
      const names = [...new Set(drop.map((m) => m.label || "(unlabelled)"))].slice(0, 12);
      add(drop.length >= ORPHAN_MODULE_ERROR_AT ? "error" : "warn", "orphan-module",
        `${drop.length} module(s) are placed by no occurrence — nothing renders them`, names);
    }
  }

  // 5. Duplicate field names. WARN, not error (user 2026-07-29: "we can have
  //    duplicate field labels but not the actual variable name"). The name is a
  //    LABEL — two fields may legitimately read "Protein" (the per-meal input
  //    and the day's total) or "Due". Identity is the id, which is unique by
  //    construction. Still surfaced, because a duplicate makes `[Field]` label
  //    tokens ambiguous (labelTokens falls back to the field the occurrence
  //    actually carries) and makes pickers harder to read.
  const byName = new Map();
  for (const f of fields) {
    const k = String(f.name || "").trim().toLowerCase();
    if (!k) continue;
    byName.set(k, (byName.get(k) || 0) + 1);
  }
  const dupNames = [...byName].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupNames.length) add("warn", "duplicate-field-name",
    `${dupNames.length} field name(s) are used more than once (ids are still unique)`, dupNames);

  // 6. Duplicate operation names — RUN_OPERATION resolves by NAME, so a
  //    duplicate makes which one runs a coin flip.
  const opNames = new Map();
  for (const op of operations) opNames.set(op.name, (opNames.get(op.name) || 0) + 1);
  const dupOps = [...opNames].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupOps.length) add("error", "duplicate-operation-name",
    `${dupOps.length} operation name(s) are used more than once`, dupOps);

  // 7. `kind` on a role that has no sub-types. It is inert there, but not
  //    harmless: getModuleTypeIcon resolves kind BEFORE role, so an instance
  //    carrying kind:"board" draws the BOARD icon everywhere an icon appears.
  //    539 of them did, for months (2026-07-29).
  const strayKind = modules
    .filter(m => m.kind && m.role && !KIND_BEARING_ROLES.has(m.role))
    .map(m => `${m.role}/${m.kind}`);
  if (strayKind.length) {
    const counts = strayKind.reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {});
    add("warn", "inert-kind",
      `${strayKind.length} module(s) carry a kind on a role that has none — the icon resolver ` +
      `prefers kind over role, so these draw the wrong icon`,
      Object.entries(counts).map(([k, n]) => `${k}×${n}`));
  }

  // 7b. A COPY-LINK SOURCE carrying a value in a field the grid FILTERS on.
  //
  //     COPY_LINK copies a source's fields, so a filter value on the source is
  //     stamped onto EVERY copy it ever mints — and the copies are then hidden
  //     on any other value of that filter. Measured on the live grid
  //     2026-08-19: 21 of 51 copy-link sources carried a date from the previous
  //     day, so 21 of that morning's timeslots were invisible. The user saw a
  //     schedule that "only created 5am and beyond", and nothing anywhere said
  //     why. `0145` is the repair; this is what stops it being silent next time.
  //
  //     THE FILTER FIELDS COME FROM THE GRID, NOT FROM THIS FILE. They are the
  //     keys of `activeFilterValues` plus every `namedFilters[].conditions[]`
  //     fieldId — the grid stating what it filters on. Nothing here learns what
  //     any particular field means.
  const filterFieldIds = new Set(Object.keys(grid?.activeFilterValues || {}));
  for (const nf of grid?.namedFilters || []) {
    for (const c of nf?.conditions || []) if (c?.fieldId) filterFieldIds.add(c.fieldId);
  }
  if (filterFieldIds.size) {
    const copySourceIds = new Set(occurrences.map(o => o.meta?.copyLinkSource).filter(Boolean));
    const stamping = [];
    for (const id of copySourceIds) {
      const src = occById.get(id);
      if (!src) continue;                    // dangling source — rule 1's business
      for (const fid of filterFieldIds) {
        const v = src.fields?.[fid]?.value;
        if (v != null && v !== "") {
          stamping.push(`${src.label || modById.get(src.moduleId)?.label || id}:${fid}`);
          break;
        }
      }
    }
    if (stamping.length) {
      add("error", "dated-copy-link-source",
        `${stamping.length} copy-link source(s) carry a value in a field the grid filters on — ` +
        `every copy inherits it, and is then hidden whenever the filter moves`,
        stamping);
    }
  }

  // 7c. A FEED-BACKED BOARD that nothing lists — data that is perfect and
  //     UNREACHABLE.
  //
  //     A board is a PAIR: a `page/board` homed in a folder whose
  //     `occurrences[]` lists a `container/board` whose own parentId is null.
  //     PageBoard renders that list, so the listing IS the route to the board —
  //     a container nobody lists renders nowhere, however healthy it is.
  //
  //     Measured on the live grid 2026-08-20: `0158` minted a Medications board
  //     by copying the Supplements CONTAINER's parentId, which is null, and
  //     never minted the page half. The board held all four medications, the
  //     dropdown resolved them, and every read-back said it was fine. It could
  //     not be opened. `0163` is the repair; this is what stops the next one
  //     being invisible. Reading it back out of Mongo is exactly what did NOT
  //     catch it — only opening the grid did.
  //
  //     NARROWED TO FEED-BACKED BOARDS, and the number is why. "Any board
  //     container nobody lists and nothing parents" also matches **12** live
  //     rows on poms grid — the `<ingredient> — files` containers, which are
  //     reached through a FIELD VALUE rather than a child list, the third
  //     reachability path 2026-08-13 (4) was paid for missing. A feed-backed
  //     board is a materialized view with a page in front of it by
  //     construction, so for that shape "nobody lists it" has one meaning.
  //     Across all five grids this reports 0 with the repair in place, and
  //     reported exactly 1 before it.
  const strandedBoards = [];
  for (const o of occurrences) {
    if (!o.feed?.enabled || o.parentId) continue;
    const m = modById.get(o.moduleId);
    if (m?.role !== "container" || m?.kind !== "board") continue;
    if (listedChildIds.has(o.id)) continue;
    strandedBoards.push(o.label || m.label || o.id);
  }
  if (strandedBoards.length) add("error", "unreachable-board",
    `${strandedBoards.length} feed-backed board(s) are listed by no page and parented to nothing — ` +
    `their contents cannot be opened`, strandedBoards);

  // 8. An operation that can never fire: no trigger objects, no trigger types,
  //    no schedule. Not an error (manual-run ops are legitimate) but worth
  //    surfacing, because it is usually a half-finished wiring job.
  const inert = operations
    .filter(op => op.enabled !== false && !(op.triggerObjects || []).length
      && !(op.triggerTypes || []).length && !op.schedule)
    .map(op => op.name);
  if (inert.length) add("warn", "unfireable-operation",
    `${inert.length} enabled operation(s) have no trigger and no schedule (manual-run only)`, inert);

  // 9. A node inside a TEMPLATE that carries no identitySignature.
  //    `APPLY_TEMPLATE mode:"merge"` decides "this already exists" by matching
  //    identitySignature, and it RECURSES into whatever it matched — so an
  //    unsigned node is cloned again on every single apply. On 2026-07-31 the
  //    Day Page template's question container was unsigned and today's column
  //    had silently collected 23 empty copies of it, one per app load.
  //    The check lives on the TEMPLATE, not the clones, because that is where
  //    the invariant is crisp: a clone's children include whatever the user
  //    typed, which has no template counterpart and is rightly unsigned.
  //    The ROOT is exempt — it is matched by the apply target, not by signature.
  //    A template is identified by LOCATION — a child of the protected
  //    "Templates" folder. It used to be identified by `module.meta.templateModule`,
  //    but migration 0035 unsets that on template ROOTS while leaving it on the
  //    nested nodes, so the marker now points at exactly the wrong occurrences.
  //    Location is also the rule the app itself uses (helpers/templateHelpers.js
  //    and utils/templatesFolder.js), so the check and the product agree.
  const templateFolderIds = new Set(
    folders.filter(f => f?.meta?.protected && f.name === "Templates").map(f => f.id),
  );
  const templateRoots = new Set();
  for (const o of occurrences) {
    const from = o.meta?.appliedFromTemplateId;
    if (from) templateRoots.add(from);
    if (o.parentId && templateFolderIds.has(o.parentId)) templateRoots.add(o.id);
  }
  // A node can be reachable from several roots (an applied-from id plus its own
  // folder entry), so report per occurrence id rather than per root.
  const unsignedById = new Map();
  for (const rootId of templateRoots) {
    const root = occById.get(rootId);
    if (!root) continue;
    const seen = new Set([rootId]);
    // A template whose root is a PAGE is a wrapper — the thing being templated
    // is what's inside it, and both build ops apply with unwrapRoot:true. So the
    // wrapper's own child is the effective apply root and is matched the same
    // way the root is: by the target, not by a signature.
    const rootIsWrapperPage = modById.get(root.moduleId)?.role === "page";
    const exemptChildren = rootIsWrapperPage ? new Set(root.occurrences || []) : new Set();
    const walk = (id) => {
      const o = occById.get(id);
      if (!o) return;
      // Only STRUCTURE is checked. An unsigned instance is content that is
      // meant to clone fresh on every apply (the Schedule template's routine
      // items land in a NEW day column each day, so they cannot duplicate).
      // The bug this rule exists for was duplicated CONTAINERS — 23 copies of
      // the Daily Question wrapper in one day, 2026-07-31.
      const isStructure = modById.get(o.moduleId)?.role === "container";
      if (isStructure && !exemptChildren.has(o.id) && !o.identitySignature && !unsignedById.has(o.id)) {
        const label = modById.get(o.moduleId)?.label || "(unlabelled)";
        unsignedById.set(o.id, `${label} in ${modById.get(root.moduleId)?.label || rootId}`);
      }
      for (const c of o.occurrences || []) if (!seen.has(c)) { seen.add(c); walk(c); }
    };
    for (const c of root.occurrences || []) if (!seen.has(c)) { seen.add(c); walk(c); }
  }
  const unsigned = [...unsignedById.values()];
  if (unsigned.length) add("error", "unsigned-template-node",
    `${unsigned.length} occurrence(s) inside a template carry no identitySignature — a merge apply ` +
    `clones an unsigned node every time it runs`, unsigned);

  // 10. The damage rule for #9, in case structure is ever added to an already
  //     built page by hand (a migration, an import) rather than to the
  //     template: two children of a template-applied node that are the same
  //     section twice. That is what a merge with a missed signature produces,
  //     and it is what the user reported ("the daypage for yesterday added all
  //     the sections twice") before either signature gap was found.
  const dupSections = [];
  for (const o of occurrences) {
    if (!o.meta?.appliedFromTemplateId) continue;
    const labels = new Map();
    for (const c of o.occurrences || []) {
      const child = occById.get(c);
      // Only the node's OWN children — something multi-parented in from
      // elsewhere (the Schedule's Todo) is not this template's to count.
      if (!child || child.parentId !== o.id) continue;
      const mod = modById.get(child.moduleId);
      if (mod?.role !== "container") continue;
      const key = mod.label || "";
      if (!key) continue;
      labels.set(key, (labels.get(key) || 0) + 1);
    }
    for (const [label, n] of labels) {
      if (n > 1) dupSections.push(`${modById.get(o.moduleId)?.label || o.id} › ${label}×${n}`);
    }
  }
  if (dupSections.length) add("error", "duplicate-template-section",
    `${dupSections.length} template-applied page(s) hold the same section more than once — the merge ` +
    `could not match an existing section and cloned it`, dupSections);


  // 12. A CONTAINER THAT CAN NEVER SHOW ANYTHING — every child filtered out.
  //
  //     Found the hard way, twice in one session (2026-08-23). The Raindrop
  //     import wrote each bookmark's save-date into `Date`, the field the GRID
  //     FILTER uses — so all 1,467 rows matched on one day of the year and the
  //     board drew EMPTY on every other. Nothing else was wrong: the rows
  //     existed, the covers resolved, `checkGrid` was clean. And the field doing
  //     the hiding is itself hidden on that board, so nothing on screen said why.
  //
  //     THE DISCRIMINATOR IS THAT THE CONTAINER IS VISIBLE AND ITS CHILDREN ARE
  //     NOT. A past day column also has every child hidden — but the column is
  //     hidden too, so nobody is looking at an empty box. Checking the container
  //     first is what keeps this quiet on the dozen old day columns every grid
  //     accumulates; without it the rule cries wolf on day one and gets weakened.
  //
  //     A THREE-CHILD FLOOR, deliberately: a container holding one or two dated
  //     rows is an ordinary day's work, and flagging it would bury the case this
  //     exists for. Calibrated against the real defect — it fires on the 1,467
  //     and on a 4-row Tasks container whose rows were all stamped by being
  //     scheduled, and stays silent on a grid with no filter set.
  const blindFilterFids = Object.keys(grid?.activeFilterValues || {});
  if (blindFilterFids.length) {
    // A value present but not matching hides the row. An ABSENT value does NOT
    // — that is the "no date, always shows" case the schedule slots rely on.
    const hiddenByFilter = (o) => blindFilterFids.some((fid) => {
      const want = grid.activeFilterValues[fid];
      const have = o?.fields?.[fid]?.value;
      if (want == null || have == null || have === "") return false;
      return !String(have).startsWith(String(want));
    });
    // ── AND THE CHECK IS SKIPPED WHERE A `filterOverride` IS IN PLAY ────────
    //
    // Added after this rule raised a FALSE POSITIVE on the Tasks page's
    // `Emotional` container: it reported every child hidden while the REAL
    // `isOccurrenceVisible` showed 3 of 4 visible. The reason is that
    // `filterOverride: {}` on an ancestor CLEARS the effective filter outright
    // (`selectors.js` — an empty override is not "inherit"), and this rule was
    // comparing against `grid.activeFilterValues` as though nothing could
    // override it.
    //
    // The fix is deliberately NOT to reimplement the cascade here. That walk
    // handles empty-clears, per-key mutes, `_ownsLocalFilter`, and a parent map
    // built from `occurrences[]` with a `parentId` fallback — a second copy of
    // it on the server is a twin that drifts, which is the failure this repo
    // keeps paying for. So the rule declines to judge any chain that carries an
    // override at all, and keeps its answer for the plain case it was written
    // for: 1,467 bookmarks hidden under no override whatsoever.
    const parentOf = new Map();
    for (const p of occurrences) for (const c of p.occurrences || []) if (!parentOf.has(c)) parentOf.set(c, p.id);
    const overriddenAnywhere = (occ) => {
      let cur = occ, n = 0;
      const seen = new Set();
      while (cur && n++ < 40 && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.filterOverride != null) return true;
        const up = parentOf.get(cur.id) || cur.parentId;
        cur = up ? occById.get(up) : null;
      }
      return false;
    };

    const blind = [];
    for (const o of occurrences) {
      const kids = (o.occurrences || []).map((id) => occById.get(id)).filter(Boolean);
      if (kids.length < 3) continue;
      if (hiddenByFilter(o)) continue;
      if (!kids.every(hiddenByFilter)) continue;
      if (overriddenAnywhere(o) || kids.some(overriddenAnywhere)) continue;
      blind.push(`${modById.get(o.moduleId)?.label || o.id} (${kids.length} children)`);
    }
    if (blind.length) add("error", "container-filtered-empty",
      `${blind.length} visible container(s) have EVERY child hidden by the grid filter — they render ` +
      `empty and nothing on screen says why`, blind);
  }

  return findings;
}

/** Pretty-print findings. Returns true when there are no errors. */
export function reportGridIntegrity(findings, { label = "grid", log = console.log } = {}) {
  const errors = findings.filter(f => f.level === "error");
  const warns = findings.filter(f => f.level === "warn");
  if (!findings.length) { log(`✅ integrity: ${label} is clean`); return true; }
  log(`\n🔎 integrity report — ${label}: ${errors.length} error(s), ${warns.length} warning(s)`);
  for (const f of [...errors, ...warns]) {
    log(`   ${f.level === "error" ? "❌" : "⚠️ "} [${f.code}] ${f.message}`);
    if (f.ids) log(`        ${f.ids.join(", ")}${f.ids.length >= 12 ? " …" : ""}`);
  }
  return errors.length === 0;
}
