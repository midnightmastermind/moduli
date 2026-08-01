// User, 2026-07-31: "make the daypages taller so they hit the full height of
// the content on load and also take out Day Page from the container names",
// plus "it should scroll horizontally too — if i add more during the filter
// change".
//
// Three data changes, no renderer knowledge involved:
//   1. Day columns take their CONTENT height again (`childMaxHeight` cleared).
//      The 420px cap was added earlier to bound a hover-expansion shove; the
//      user would rather see the whole day on load. The cap is still settable
//      from the page header's Layout menu if it needs to come back.
//   2. Column labels lose the "Day Page - " prefix — the board is already
//      called Day Page, so every column repeated it. Both the existing columns
//      and the op that mints tomorrow's are updated, or the name would come
//      back the next morning.
//   3. Horizontal scrolling needs nothing: `mode: "flex-row"` already lays the
//      columns in a row that scrolls (PageBoard sets overflowX auto +
//      width max-content), so picking a week in the filter widens the board
//      rather than squashing the columns. Asserted here so a regression shows
//      up as a failed migration rather than a squashed page.

export const id = "0026-day-column-names-and-height";
export const describe =
  "Clears the day columns' height cap so they show their full content, drops the redundant " +
  '"Day Page - " prefix from every column name (and from the op that mints new ones), and asserts the ' +
  "board still lays out as a horizontally scrolling row.";

const PREFIX = /^Day Page - /;

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Operation } = models;

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  if (!boardMod) { log("no Day Page board on this grid"); return; }
  const boardOcc = await Occurrence.findOne({ gridId, moduleId: boardMod.id })
    .select({ id: 1, meta: 1, occurrences: 1 }).lean();
  if (!boardOcc) { log("Day Page board module has no occurrence"); return; }

  // ── 1. full content height ────────────────────────────────────────────────
  const cascade = { ...(boardOcc.meta?.layoutCascade || {}) };
  if (cascade.childMaxHeight != null) {
    log(`clearing the ${cascade.childMaxHeight}px column cap — columns take their content height`);
    delete cascade.childMaxHeight;
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: boardOcc.id }, {
        $set: { meta: { ...(boardOcc.meta || {}), layoutCascade: cascade } },
      });
    }
  } else {
    log("no column cap set");
  }

  // ── 3. the row layout that gives horizontal scrolling ─────────────────────
  if (cascade.mode !== "flex-row") {
    throw new Error(`Day Page board is "${cascade.mode || "stack"}", not flex-row — it would not scroll horizontally`);
  }
  log("board lays out as a scrolling row (flex-row) ✓");

  // ── 2. column names ───────────────────────────────────────────────────────
  let renamed = 0;
  for (const cid of boardOcc.occurrences || []) {
    const col = await Occurrence.findOne({ gridId, id: cid }).select({ moduleId: 1, label: 1 }).lean();
    if (!col) continue;
    const mod = await Module.findOne({ gridId, id: col.moduleId }).select({ id: 1, label: 1 }).lean();
    if (mod && PREFIX.test(mod.label || "")) {
      const next = mod.label.replace(PREFIX, "");
      log(`  "${mod.label}" → "${next}"`);
      renamed++;
      if (!dryRun) await Module.updateOne({ gridId, id: mod.id }, { $set: { label: next } });
    }
    // A per-placement label override would win over the module label, so clear
    // any that still carries the prefix.
    if (col.label && PREFIX.test(col.label)) {
      if (!dryRun) await Occurrence.updateOne({ gridId, id: col.id }, { $set: { label: col.label.replace(PREFIX, "") } });
    }
  }
  log(`${renamed} column(s) renamed`);

  // The op that mints tomorrow's column — without this the prefix returns on
  // the next new day. Patched in place rather than regenerated from the
  // builder, so nothing else about the stored pipeline moves.
  const ops = await Operation.find({ gridId, name: /^Day Page: Build/ }).lean();
  for (const op of ops) {
    const json = JSON.stringify(op.pipeline || {});
    if (!json.includes("Day Page - ${$day}")) continue;
    const next = JSON.parse(json.split("Day Page - ${$day}").join("${$day}"));
    log(`  "${op.name}": rootLabel → "\${$day}"`);
    if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next } });
  }
}
