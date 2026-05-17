export function resolveOptions(field, ctx) {
  if (field?.type !== "select") return { options: [], totalMatched: 0 };
  const src = field.meta?.optionsSource;
  if (!src?.mode) return { options: [], totalMatched: 0 };

  if (src.mode === "manual") {
    const values = Array.isArray(src.values) ? src.values : [];
    const options = values.map(v => ({ value: v, label: String(v) }));
    return { options, totalMatched: options.length };
  }

  if (src.mode === "range") {
    const { start, end, step } = src.range || {};
    if (typeof start !== "number" || typeof end !== "number" || typeof step !== "number") return { options: [], totalMatched: 0 };
    if (step <= 0 || end < start) return { options: [], totalMatched: 0 };
    const options = [];
    for (let v = start; v <= end; v += step) options.push({ value: v, label: String(v) });
    return { options, totalMatched: options.length };
  }

  if (src.mode === "find") {
    return { options: [], totalMatched: 0 };
  }

  return { options: [], totalMatched: 0 };
}
