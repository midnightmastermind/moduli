/**
 * 0239 — how much media you own, of what, on the Trackers page.
 *
 * User, 2026-08-25: *"put the numbers then on the grid under trackers. put how
 * much media i own of what"* — after `0238` imported the six-drive survey.
 *
 * ── ONE PASS, NOT ONE PER KIND ────────────────────────────────────────────
 *
 * Seven counts could be seven ops, each looping the grid. That is the shape
 * `Schedule: Fill Day` had — 3 layers x 49 slots x 1,347 containers = 198,009
 * predicate evaluations for zero effects, 40% of the navigation sweep, and a
 * session to remove (2026-08-23 (9)). This is ONE loop over `$allItems` with
 * seven counters, gated on `Owned IS true` at the top so the seven tag checks
 * only run for rows that already qualify.
 *
 * ── `$allItems`, NOT `$allInstances`, AND THAT IS NOT AN OVERSIGHT ────────
 *
 * `0222`/`0226` deliberately made library rows `role: "artifact"` so they leave
 * the `$allInstances` slice that 42 of 66 enabled ops iterate — that decision is
 * worth ~1.5s of every grid load. `$allInstances` therefore CANNOT see them:
 * `allItems` is every occurrence, and the role slices are filtered from it.
 * A tracker written over `$allInstances` here would report seven zeroes and look
 * like a broken op rather than a wrong collection.
 *
 * ── onLoad ONLY, AND THAT IS THE COST CONTROL ────────────────────────────
 *
 * Every other tracker fires on `onFilterChange` because it aggregates a DAY. A
 * media count is a fact about the library, not about the date on screen, so
 * firing it on navigation would add a full-grid pass to every date change and
 * change nothing. It fires when the grid loads and when the library does.
 *
 * ── WHAT "OWN" MEANS, AND WHERE IT DELIBERATELY COUNTS ZERO ───────────────
 *
 * `Owned` is set by `0238` from the survey: from the Status column where the
 * table has one (so the 244 want-list films and 79 want-list shows are excluded,
 * which is the point of the flag) and from the fact of the file otherwise.
 *
 * **The 666 Calibre books are backfilled to `Owned: true` here**, because
 * `0226`'s source was the same kind of thing — a survey of 1,817 files on disk.
 * Without it "Books Owned" would report only the 212 rows `0238` happened to add
 * and read as a library four times smaller than it is.
 *
 * **The 1,595 Spotify artists and 2,757 Spotify albums are deliberately NOT
 * backfilled.** They are a streaming library, not files you have — so "Albums
 * Owned" counts the 271 local rips, which is the honest answer to the question
 * asked. Flagging them owned would make the tile a count of what you have
 * LISTENED to, under a label that says otherwise.
 */
const uid = () => Math.random().toString(36).slice(2, 14);

export const id = "0239-media-owned-tracker";
export const describe =
  "A 'Media Owned' tile on the Trackers page counting owned Movies / TV Series / Documentaries / Games / Comics / Books / Albums, plus the op that fills it.";
export const touches = ["fields", "occurrences", "modules", "operations"];

/** field name -> the Board Category tag it counts. Order is render order. */
export const COUNTS = Object.freeze([
  ["Movies Owned",        "movie"],
  ["TV Series Owned",     "series"],
  ["Documentaries Owned", "documentary"],
  ["Games Owned",         "game"],
  ["Comics Owned",        "comic"],
  ["Books Owned",         "book"],
  ["Albums Owned",        "album"],
]);

/** A var name the pipeline can carry: "$moviesowned". PURE. */
export const varFor = (name) => `$${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const gid = String(gridId);

  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  const ownedField = await Field.findOne({ gridId: gid, name: "Owned" }).lean();
  if (!tagField) { log("no Board Category field — nothing to count"); return; }
  if (!ownedField) { log("no Owned field — run 0238 first"); return; }

  const occs = await Occurrence.find({ gridId: gid },
    { id: 1, moduleId: 1, label: 1, parentId: 1, userId: 1, occurrences: 1,
      [`fields.${tagField.id}`]: 1, [`fields.${ownedField.id}`]: 1, "meta.feedSourceId": 1 }).lean();
  const mods = await Module.find({ gridId: gid }, { id: 1, label: 1, role: 1, meta: 1, fieldBindings: 1, userId: 1 }).lean();
  const mById = new Map(mods.map((m) => [m.id, m]));
  const tagOf = (o) => { const v = o.fields?.[tagField.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };

  // ── the Trackers page, found by the tiles already on it ─────────────────
  // Never by label: a page is one rename away from breaking this.
  const trackerTile = mods.find((m) => m.meta?.workoutGoalTile) || mods.find((m) => m.label === "Workouts" && m.role === "instance");
  const trackerOcc = trackerTile ? occs.find((o) => o.moduleId === trackerTile.id) : null;
  const group = trackerOcc ? occs.find((o) => o.id === trackerOcc.parentId) : null;
  const trackersPage = group ? occs.find((o) => o.id === group.parentId) : null;
  if (!trackersPage) { log("could not locate the Trackers page from an existing tile — refusing to guess"); return; }
  log(`Trackers page: ${trackersPage.id} (via the "${mById.get(trackerTile.id)?.label}" tile's group "${mById.get(group.moduleId)?.label}")`);

  // ── the books backfill (see the header) ─────────────────────────────────
  const booksToFlag = occs.filter((o) =>
    !o.meta?.feedSourceId && tagOf(o).includes("book") &&
    o.fields?.[ownedField.id]?.value !== true);
  log(`books on the board with no Owned flag: ${booksToFlag.length} (a survey of files on disk — backfilled true)`);

  // ── the fields ──────────────────────────────────────────────────────────
  const existing = await Field.find({ gridId: gid, name: { $in: COUNTS.map((c) => c[0]) } }).lean();
  const byName = new Map(existing.map((f) => [f.name, f]));
  const toMint = COUNTS.filter(([n]) => !byName.has(n));
  // The unique-field-names rule (2026-07-14) is not cosmetic here: `[Field]`
  // label tokens resolve BY NAME, so a twin silently re-points one.
  const collide = existing.filter((f) => !f.meta?.mediaOwnedCount && f.displayEnabled !== true);
  if (collide.length) { log(`REFUSING: ${collide.map((f) => f.name).join(", ")} already exist and are not ours`); return; }

  const haveGroup = occs.find((o) => mById.get(o.moduleId)?.meta?.mediaOwnedGroup);
  const haveTile = mods.find((m) => m.meta?.mediaOwnedTile);

  log(`fields to mint : ${toMint.map((c) => c[0]).join(", ") || "(none)"}`);
  log(`group to mint  : ${haveGroup ? "(exists)" : "Media"}`);
  log(`tile to mint   : ${haveTile ? "(exists)" : "Media Owned"}`);
  if (dryRun) {
    // The counts this op WILL produce, computed here so the dry run is checkable
    // against a named expectation rather than a promise.
    for (const [name, tag] of COUNTS) {
      const n = occs.filter((o) => !o.meta?.feedSourceId && tagOf(o).includes(tag) &&
        (o.fields?.[ownedField.id]?.value === true || (tag === "book" && true))).length;
      log(`  ${name.padEnd(20)} -> ${n}`);
    }
    return;
  }

  if (booksToFlag.length) {
    await Occurrence.updateMany(
      { gridId: gid, id: { $in: booksToFlag.map((o) => o.id) } },
      { $set: { [`fields.${ownedField.id}`]: { value: true, flow: "in" } } });
    log(`  flagged ${booksToFlag.length} books as owned`);
    // A VALUE STORED ON A FIELD THE MODULE DOES NOT BIND RENDERS NOWHERE — the
    // `0047` half of this repo's most repeated defect. 0226's Book module and
    // 0238's are DIFFERENT modules (0238 mints its own, keyed on meta.mediaRow),
    // so flagging the Calibre rows without binding the field would set a value
    // the board can never show and the tile would still be right while the row
    // looked untouched. Bind it on every module those rows actually use.
    const modIds = [...new Set(booksToFlag.map((o) => o.moduleId))].filter(Boolean);
    let bound = 0;
    for (const mid of modIds) {
      const m = mById.get(mid);
      if (!m || (m.fieldBindings || []).some((b) => b.fieldId === ownedField.id)) continue;
      await Module.updateOne({ id: mid, gridId: gid }, { $push: { fieldBindings:
        { fieldId: ownedField.id, order: (m.fieldBindings || []).length, role: "input" } } });
      bound++;
    }
    log(`  bound "Owned" on ${bound} of ${modIds.length} module(s) those rows use`);
  }

  // ── THE GENERAL FORM OF THE SAME GUARD ──────────────────────────────────
  // Reading 0238's result back out of Mongo found 8 documentary rows carrying a
  // `Year` value on a module that does not bind Year — stored, reported as
  // written, and rendering nowhere. Rather than patch those 8, sweep the class:
  // any field a media row actually HOLDS must be bound on the module it renders
  // through, or the row silently shows less than it has.
  {
    const media = occs.filter((o) => o.meta?.mediaLibraryKey);
    const byMod = new Map();
    for (const o of media) {
      if (!o.moduleId) continue;
      if (!byMod.has(o.moduleId)) byMod.set(o.moduleId, new Set());
      for (const fid of Object.keys(o.fields || {})) byMod.get(o.moduleId).add(fid);
    }
    let added = 0;
    for (const [mid, held] of byMod) {
      const m = mById.get(mid);
      if (!m) continue;
      const bound2 = new Set((m.fieldBindings || []).map((b) => b.fieldId));
      const missing = [...held].filter((f) => !bound2.has(f));
      if (!missing.length) continue;
      await Module.updateOne({ id: mid, gridId: gid }, { $push: { fieldBindings: { $each:
        missing.map((f, i) => ({ fieldId: f, order: (m.fieldBindings || []).length + i, role: "input" })) } } });
      added += missing.length;
      log(`  bound ${missing.length} unbound field(s) on "${m.label}"`);
    }
    log(`  unbound-value sweep: ${added} binding(s) added`);
  }

  const fid = {};
  for (const [name] of COUNTS) {
    const f = byName.get(name);
    if (f) { fid[name] = f.id; continue; }
    const id2 = uid();
    await Field.create({ id: id2, gridId: gid, userId: trackersPage.userId, name, type: "number",
      inputEnabled: false, displayEnabled: true, meta: { mediaOwnedCount: true } });
    fid[name] = id2;
    log(`  minted field "${name}"`);
  }

  // ── the group and the tile ──────────────────────────────────────────────
  let groupOcc = haveGroup;
  if (!groupOcc) {
    const gm = uid(), go = uid();
    await Module.create({ id: gm, gridId: gid, userId: trackersPage.userId, label: "Media",
      role: mById.get(group.moduleId)?.role || "container", kind: mById.get(group.moduleId)?.kind,
      fieldBindings: [], meta: { ...(mById.get(group.moduleId)?.meta || {}), mediaOwnedGroup: true } });
    await Occurrence.create({ id: go, gridId: gid, userId: trackersPage.userId, moduleId: gm,
      parentId: trackersPage.id, occurrences: [], fields: {} });
    await Occurrence.updateOne({ id: trackersPage.id, gridId: gid }, { $push: { occurrences: go } });
    groupOcc = { id: go };
    log(`  minted the "Media" group ${go} on the Trackers page`);
  }

  const bindings = COUNTS.map(([n], i) => ({ fieldId: fid[n], order: i, role: "display" }));
  let tileOccId;
  if (haveTile) {
    await Module.updateOne({ id: haveTile.id, gridId: gid }, { $set: { fieldBindings: bindings } });
    tileOccId = occs.find((o) => o.moduleId === haveTile.id)?.id;
    log(`  rebound the existing tile to ${bindings.length} fields`);
  } else {
    const tm = uid(), to = uid();
    await Module.create({ id: tm, gridId: gid, userId: trackersPage.userId, label: "Media Owned",
      role: "instance", fieldBindings: bindings, meta: { mediaOwnedTile: true } });
    await Occurrence.create({ id: to, gridId: gid, userId: trackersPage.userId, moduleId: tm,
      parentId: groupOcc.id, fields: {}, occurrences: [] });
    await Occurrence.updateOne({ id: groupOcc.id, gridId: gid }, { $push: { occurrences: to } });
    tileOccId = to;
    log(`  minted the "Media Owned" tile ${to}`);
  }
  if (!tileOccId) { log("no tile occurrence — refusing to write an op that targets nothing"); return; }

  // ── the op: ONE pass, seven counters ────────────────────────────────────
  const A = (config) => ({ id: uid(), type: "action", config });
  const rule = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
  const steps = [
    A({ type: "INIT_VAR", name: "$tile", expr: `$allItemsById.${tileOccId}` }),
    ...COUNTS.map(([n]) => A({ type: "INIT_VAR", name: varFor(n), value: 0 })),
    { id: uid(), type: "loop", overExpr: "$allItems", as: "$m", body: [
      { id: uid(), type: "if", condition: { operator: "AND", rules: [
        // The outer gate is what keeps this one cheap: only rows that are
        // already owned pay for the seven tag comparisons below.
        rule(`$m.fields.${ownedField.id}.value`, "IS", true),
        // A feed COPY carries its source's tag and would double every count.
        rule("$m.meta.feedSourceId", "IS_EMPTY"),
      ] }, then: COUNTS.map(([n, tag]) => ({
        id: uid(), type: "if",
        condition: { operator: "AND", rules: [rule(`$m.fields.${tagField.id}.value`, "CONTAINS", tag)] },
        then: [A({ type: "INCREMENT_VAR", name: varFor(n), by: 1 })], else: [],
      })), else: [] },
    ] },
    ...COUNTS.map(([n]) => A({ type: "UPDATE", path: `$tile.fields.${fid[n]}.value`, value: varFor(n) })),
  ];

  await Operation.deleteOne({ gridId: gid, name: "Trackers: Media Owned" });
  await Operation.create({ id: uid(), gridId: gid, userId: trackersPage.userId,
    name: "Trackers: Media Owned", enabled: true,
    // onLoad ONLY — see the header. `triggerObjects: []` with an explicit
    // `triggerTypes` is the shape `computeTriggerMatch` reads as "events, and
    // only these"; an EMPTY triggerTypes takes the legacy no-config path.
    triggerTypes: ["onLoad"], triggerObjects: [],
    targetOccurrenceId: null,
    pipeline: { sources: [], steps } });
  log(`  created "Trackers: Media Owned" (${steps.length} top-level steps, one pass)`);
  log("  RESTART pm2 and reload.");
}
