// server/migrations/0128-wider-table-columns.mjs
//
// User, 2026-08-14: "and make it wider."
//
// `0126` fitted each column to its header with `max(110, min(320, 12 + n*8))`.
// With the scaler no longer shrinking columns (they used to be squeezed to
// ~78px in a narrow panel), those widths are now what you actually see — and
// the floor of 110 is tight: it is what EVERY short header lands on, so "Item",
// "Amount" and "Calories" all sat at the minimum.
//
//     old   max(110, min(320, 12 + n*8))      Calories 110 · Key Vitamins… 204
//     new   max(150, min(360, 28 + n*9))      Calories 150 · Key Vitamins… 244
//
// ── IT RE-WIDTHS ONLY COLUMNS NOBODY HAS TOUCHED ────────────────────────────
// A column is rewritten only when its stored width still equals what an earlier
// automatic pass would have produced for that exact title — the `0126` formula
// or the importer's old flat 160. Anything else is a width the user dragged, and
// a migration that overwrites a hand-resized column teaches people not to resize
// columns. That check is also what makes a re-run a no-op.
export const id = "0128-wider-table-columns";
export const describe = "Imported table columns get roomier widths; hand-resized ones are left alone.";

export const IMPORTER_FLAT_WIDTH = 160;

// The width `0126` (and the first importer pass) would have produced.
export function previousHeaderWidth(title) {
  const n = String(title ?? "").length;
  return Math.max(110, Math.min(320, 12 + n * 8));
}

export function headerWidth(title) {
  const n = String(title ?? "").length;
  return Math.max(150, Math.min(360, 28 + n * 9));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";

  const plan = [];
  for (const o of occs) {
    const cols = o.meta?.table?.columns;
    if (!Array.isArray(cols) || !cols.length) continue;
    let hits = 0, kept = 0;
    const next = cols.map((c) => {
      const want = headerWidth(c?.title);
      const automatic = c?.width === previousHeaderWidth(c?.title) || c?.width === IMPORTER_FLAT_WIDTH;
      if (!automatic || c?.width === want) { if (!automatic) kept++; return c; }
      hits++;
      return { ...c, width: want };
    });
    if (!hits) continue;
    plan.push({ occ: o, columns: next, hits, kept });
  }

  for (const p of plan) {
    log(`  "${nameOf(p.occ)}" — ${p.hits} column(s) widened` +
      (p.kept ? `, ${p.kept} hand-resized kept` : ""));
    log(`      ${p.columns.map((c) => `${c.title || "—"}@${c.width}`).join(" | ")}`.slice(0, 200));
  }
  const tables = occs.filter((o) => Array.isArray(o.meta?.table?.columns)).length;
  log(`tables: ${tables} · widening: ${plan.length}`);
  if (!plan.length) { log(`nothing to widen.`); return; }
  if (dryRun) { log(`WOULD widen columns on ${plan.length} table(s).`); return; }

  for (const p of plan) {
    // Only the columns key — meta.table also holds cells and rowCount.
    await Occurrence.updateOne({ gridId, id: p.occ.id },
      { $set: { "meta.table.columns": p.columns } });
  }
  log(`widened ${plan.reduce((a, p) => a + p.hits, 0)} column(s) across ${plan.length} table(s).`);
}
