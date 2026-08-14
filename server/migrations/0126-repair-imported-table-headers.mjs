// server/migrations/0126-repair-imported-table-headers.mjs
//
// User, 2026-08-14: "the headers are off with the stars. and arent being shown
// wide enough (its cut off half way in the table headers)."
//
// Both are the same defect in `markdownImporter.buildTable`, now fixed there
// too: it took the pipe-table's header cells VERBATIM. Markdown writes them
// bold — `| **Item** | **Amount** |` — so:
//   - every column header rendered the literal asterisks, and
//   - `headers[0]` doubles as the container LABEL, so the table was titled
//     `**Item**` (visible in the user's screenshot as a section heading).
// The heading path has stripped inline markdown since 2026-06-09; the table
// path never learned to.
//
// ── WHY THEY WERE ALSO CUT OFF, WHICH IS A SEPARATE CAUSE ───────────────────
// `buildTable` gave every column a flat `width: 160`, and `ContainerTable`
// scales columns **proportionally** to fit the container — so "Key Vitamins &
// Nutrients" got exactly as much room as "Item" and truncated. It truncates
// rather than wrapping because the header renders in an `<input>`, which cannot
// wrap the way a body cell does. So width now TRACKS THE HEADER LENGTH,
// clamped [110, 320] so one long header cannot squeeze the data columns to
// nothing.
//
// ── IT ONLY TOUCHES WHAT IS DEMONSTRABLY WRONG ─────────────────────────────
// A title is rewritten only when stripping actually changes it, and a width
// only when the column still carries the importer's flat 160. A table the user
// has since retitled or resized by hand is left exactly as they left it —
// which is also what makes a re-run a no-op.
export const id = "0126-repair-imported-table-headers";
export const describe =
  "Imported table headers lose their markdown asterisks and get widths that fit them.";

export const IMPORTER_DEFAULT_WIDTH = 160;
export const TABLE_LABEL = "List";
export const TABLE_HEADING_LEVEL = 4;

// The same strip the importer applies to headings: bold/italic/code/link syntax
// removed, the TEXT kept.
export function stripInlineMd(s) {
  return String(s ?? "")
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function headerWidth(title) {
  const n = String(title ?? "").length;
  return Math.max(110, Math.min(320, 12 + n * 8));
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
    const next = cols.map((c) => {
      const clean = stripInlineMd(c?.title);
      const titleChanged = clean !== String(c?.title ?? "");
      // Only re-width a column still at the importer's flat default — a hand
      // resized column is the user's decision.
      const widthChanged = c?.width === IMPORTER_DEFAULT_WIDTH;
      return {
        ...c,
        ...(titleChanged ? { title: clean } : {}),
        ...(widthChanged ? { width: headerWidth(clean) } : {}),
        _t: titleChanged, _w: widthChanged,
      };
    });
    const titles = next.filter((c) => c._t).length;
    const widths = next.filter((c) => c._w).length;

    // THE BODY CELLS CARRY THE SAME ASTERISKS. `buildTable` writes each cell as
    // a one-text-node paragraph straight from the markdown row, so a bolded cell
    // ("**33 oz**") renders its markers too. Walked rather than regexed over the
    // whole doc: only `text` leaves are rewritten, so a cell that was promoted to
    // an embed or carries other nodes is left structurally untouched.
    const cells = { ...(o.meta?.table?.cells || {}) };
    let cellHits = 0;
    for (const [k, doc] of Object.entries(cells)) {
      let touched = false;
      const walk = (n) => {
        if (!n || typeof n !== "object") return n;
        if (n.type === "text" && typeof n.text === "string") {
          const clean = stripInlineMd(n.text);
          if (clean !== n.text) { touched = true; return { ...n, text: clean }; }
          return n;
        }
        if (Array.isArray(n.content)) return { ...n, content: n.content.map(walk) };
        return n;
      };
      const nextDoc = walk(doc);
      if (touched) { cells[k] = nextDoc; cellHits++; }
    }
    const mod = modById.get(o.moduleId);
    // The label is NOT the first column. The importer reused `headers[0]`, so the
    // container was titled after a COLUMN ("**Item**") — which reads as a mislabel
    // beside the section heading above it. A table is a list of rows.
    // Rewritten ONLY when the current label still matches that first header
    // (raw or stripped), so a table the user has named themselves is untouched.
    const first = String(cols[0]?.title ?? "");
    const looksImported = !!mod && [first, stripInlineMd(first)]
      .some((c) => c && String(mod.label ?? "") === c);
    const cleanLabel = looksImported ? TABLE_LABEL : stripInlineMd(mod?.label);
    const labelChanged = !!mod && cleanLabel !== String(mod.label ?? "");
    if (!titles && !widths && !labelChanged && !cellHits) continue;
    plan.push({
      occ: o, mod, cleanLabel, labelChanged, titles, widths, cellHits, cells,
      columns: next.map(({ _t, _w, ...c }) => c),
    });
  }

  for (const p of plan) {
    log(`  "${nameOf(p.occ)}"${p.labelChanged ? ` -> label "${p.cleanLabel}"` : ""}` +
      ` · ${p.titles} title(s) stripped · ${p.cellHits} cell(s) stripped · ${p.widths} width(s) re-fitted`);
    if (p.titles) log(`      ${p.columns.map((c) => `${c.title}@${c.width}`).join(" | ")}`.slice(0, 200));
  }
  const tables = occs.filter((o) => Array.isArray(o.meta?.table?.columns)).length;
  log(`tables on the grid: ${tables} · needing repair: ${plan.length}`);
  if (!plan.length) { log(`every table header is already clean.`); return; }
  if (dryRun) { log(`WOULD repair ${plan.length} table(s).`); return; }

  for (const p of plan) {
    // $set the columns key only — meta.table also holds cells and rowCount, and
    // writing meta whole would drop them.
    await Occurrence.updateOne({ gridId, id: p.occ.id }, { $set: {
      "meta.table.columns": p.columns,
      ...(p.cellHits ? { "meta.table.cells": p.cells } : {}),
    } });
    if (p.labelChanged) {
      await Module.updateOne({ gridId, id: p.mod.id }, { $set: {
        label: p.cleanLabel,
        // Level 4 renders it as `####`, below the section that contains it.
        ...(p.cleanLabel === TABLE_LABEL ? { "meta.headingLevel": TABLE_HEADING_LEVEL } : {}),
      } });
    }
  }
  log(`repaired ${plan.length} table(s).`);

  const after = await Occurrence.find({ gridId, id: { $in: plan.map((p) => p.occ.id) } }).lean();
  const stars = after.filter((o) => (o.meta?.table?.columns || [])
    .some((c) => /\*/.test(String(c?.title ?? "")))).length;
  const cellStars = after.filter((o) =>
    /\*\*/.test(JSON.stringify(o.meta?.table?.cells || {}))).length;
  log(`  check: ${stars} header(s) and ${cellStars} table body(ies) still carry an asterisk (want 0, 0).`);
}
