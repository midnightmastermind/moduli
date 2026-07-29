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
 * @param {{grid, occurrences, modules, fields, operations}} world
 * @returns {Array<{level:"error"|"warn", code:string, message:string, ids?:string[]}>}
 */
export function checkGridIntegrity({ occurrences = [], modules = [], fields = [], operations = [] } = {}) {
  const findings = [];
  const add = (level, code, message, ids) => findings.push({ level, code, message, ...(ids?.length ? { ids: ids.slice(0, 12) } : {}) });

  const occById = new Map(occurrences.map(o => [o.id, o]));
  const modById = new Map(modules.map(m => [m.id, m]));

  // 1. Dangling child refs — a parent listing children that do not exist.
  //    Cause: the create/update asymmetry on disconnect (fixed at source
  //    2026-07-29). 60 of these were live when the check was written.
  const dangling = [];
  for (const o of occurrences) {
    for (const c of o.occurrences || []) if (!occById.has(c)) dangling.push(`${o.id}→${c}`);
  }
  if (dangling.length) add("error", "dangling-child-ref",
    `${dangling.length} child id(s) in occurrences[] point at documents that do not exist`, dangling);

  // 2. Occurrences whose module is missing — renders as nothing, forever.
  const noModule = occurrences.filter(o => !modById.has(o.moduleId)).map(o => o.id);
  if (noModule.length) add("error", "missing-module",
    `${noModule.length} occurrence(s) reference a module that does not exist`, noModule);

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
  const KIND_BEARING = new Set(["container", "page", "artifact", "textblock"]);
  const strayKind = modules
    .filter(m => m.kind && m.role && !KIND_BEARING.has(m.role))
    .map(m => `${m.role}/${m.kind}`);
  if (strayKind.length) {
    const counts = strayKind.reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {});
    add("warn", "inert-kind",
      `${strayKind.length} module(s) carry a kind on a role that has none — the icon resolver ` +
      `prefers kind over role, so these draw the wrong icon`,
      Object.entries(counts).map(([k, n]) => `${k}×${n}`));
  }

  // 8. An operation that can never fire: no trigger objects, no trigger types,
  //    no schedule. Not an error (manual-run ops are legitimate) but worth
  //    surfacing, because it is usually a half-finished wiring job.
  const inert = operations
    .filter(op => op.enabled !== false && !(op.triggerObjects || []).length
      && !(op.triggerTypes || []).length && !op.schedule)
    .map(op => op.name);
  if (inert.length) add("warn", "unfireable-operation",
    `${inert.length} enabled operation(s) have no trigger and no schedule (manual-run only)`, inert);

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
