// An operation's category — one picker for every surface that files an operation (the op editor and the
// read-only alarm panel), plus the grouping the Schedules list uses so a scheduled op's category is
// visible somewhere. Before, a scheduled op appeared in no category column and an alarm's editor had no
// picker, so their category could only be written by a seed and was shown nowhere (2026-10-08).
import React from "react";

export default function OpCategorySelect({ value, onChange, categoryFolders = [], style }) {
  return (
    <select
      aria-label="Operation category"
      value={value || ""}
      onChange={(e) => onChange?.(e.target.value || null)}
      style={style}
    >
      <option value="">Uncategorized</option>
      {categoryFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

/** Group operations by category, in category-column order, Uncategorized last; empty groups dropped. */
export function groupOpsByCategory(ops = [], categoryFolders = []) {
  const known = new Set(categoryFolders.map((f) => f.id));
  const groups = categoryFolders.map((f) => ({ key: f.id, label: f.name, ops: [] }));
  const byId = Object.fromEntries(groups.map((g) => [g.key, g]));
  const rest = { key: "uncategorized", label: "Uncategorized", ops: [] };
  for (const op of ops) (op?.folderId && known.has(op.folderId) ? byId[op.folderId] : rest).ops.push(op);
  return [...groups, rest].filter((g) => g.ops.length > 0);
}
