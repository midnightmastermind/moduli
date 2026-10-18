// A step value or rule value often holds a raw id (`literal:3fda27ed-…`, or a bare id) that
// names a row, a module, a field or a folder. Nobody can read that, so the editor shows what
// the id names beside it. Returns null when the value is not an id the grid knows.
import { occurrenceDisplayLabel } from "./occurrenceLabel.js";

export function literalTarget(value, { occurrencesById = {}, modulesById = {}, fieldsById = {}, foldersById = {} } = {}) {
  if (typeof value !== "string") return null;
  let v = value.trim();
  if (v.startsWith("literal:")) v = v.slice(8).trim();
  if (!v || v.length < 6 || /\s/.test(v) || v.startsWith("$")) return null;
  const occ = occurrencesById[v];
  if (occ) {
    const mod = modulesById[occ.moduleId || occ.targetId];
    return { kind: "occurrence", label: occurrenceDisplayLabel(occ, mod, "") || "(unnamed)" };
  }
  const mod = modulesById[v];
  if (mod) return { kind: "module", label: mod.label || "(unnamed)" };
  const field = fieldsById[v];
  if (field) return { kind: "field", label: field.name || field.label || "(unnamed)" };
  const folder = foldersById[v];
  if (folder) return { kind: "folder", label: folder.name || "(unnamed)" };
  return null;
}
