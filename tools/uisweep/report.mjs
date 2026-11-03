// tools/uisweep/report.mjs — one row per control per run.
import fs from "node:fs";

export const COLUMNS = ["id", "surface", "control", "vp", "works", "reach", "a11y", "clear", "fast", "notes"];
const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
export function formatRow(r) { return `| ${COLUMNS.map((c) => esc(r[c])).join(" | ")} |`; }

/** Append rows to the report file (created with its header if missing). */
export function appendRows(file, rows) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, `| ${COLUMNS.join(" | ")} |\n|${COLUMNS.map(() => "---").join("|")}|\n`);
  fs.appendFileSync(file, rows.map(formatRow).join("\n") + (rows.length ? "\n" : ""));
}
