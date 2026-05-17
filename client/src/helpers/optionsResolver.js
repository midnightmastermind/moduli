import { evalGroupAgainstRecord, resolveRecordPath } from "./operationActions";

const COLLECTION_KEYS = {
  $allOccurrences: "all",
  $allItems: "all",
  $allContainers: "container",
  $allPages: "page",
  $allPanels: "panel",
  $allInstances: "instance",
  $allTemplates: "templates",
  $allFields: "fields",
};

function buildCollection(over, ctx) {
  const { occurrencesById = {}, modulesById = {}, fieldsById = {} } = ctx;
  const filter = COLLECTION_KEYS[over];
  if (filter === undefined) return [];
  if (filter === "templates") return Object.values(modulesById);
  if (filter === "fields") return Object.values(fieldsById);

  const records = Object.values(occurrencesById).map(occ => {
    const tpl = occ.moduleId ? modulesById[occ.moduleId] : null;
    return {
      ...occ,
      label: occ.label ?? tpl?.label ?? tpl?.name ?? null,
      name: occ.name ?? tpl?.name ?? tpl?.label ?? null,
      role: occ.role ?? tpl?.role ?? null,
      kind: occ.kind ?? tpl?.kind ?? null,
      meta: { ...(tpl?.meta || {}), ...(occ.meta || {}) },
      templateId: occ.moduleId ?? null,
    };
  });
  if (filter === "all") return records;
  return records.filter(r => r.role === filter);
}

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
    const cfg = src.find || {};
    const over = cfg.over || "$allOccurrences";
    const records = buildCollection(over, ctx);
    const predicate = cfg.predicate || { rules: [] };
    const matched = records.filter(r => {
      if (!predicate.rules?.length) return true;
      return evalGroupAgainstRecord(predicate, r, {});
    });

    const valuePath = cfg.valuePath || "id";
    const labelPath = cfg.labelPath || valuePath;
    const pairs = matched.map(r => {
      const value = resolveRecordPath(r, valuePath);
      const label = labelPath === valuePath ? value : resolveRecordPath(r, labelPath);
      return { value, label: label == null ? "" : String(label), _record: r };
    }).filter(p => p.value !== undefined && p.value !== null);

    const totalMatched = pairs.length;

    const seen = new Map();
    for (const p of pairs) seen.set(p.value, p);
    let deduped = Array.from(seen.values());

    if (cfg.sortPath) {
      const dir = cfg.sortDir === "desc" ? -1 : 1;
      deduped.sort((a, b) => {
        const av = resolveRecordPath(a._record, cfg.sortPath);
        const bv = resolveRecordPath(b._record, cfg.sortPath);
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -dir : dir;
      });
    }

    const limit = typeof cfg.limit === "number" && cfg.limit > 0 ? cfg.limit : 100;
    const options = deduped.slice(0, limit).map(({ _record, ...rest }) => rest);

    return { options, totalMatched };
  }

  return { options: [], totalMatched: 0 };
}
