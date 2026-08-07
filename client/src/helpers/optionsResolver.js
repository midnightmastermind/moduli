import { evalGroupAgainstRecord, resolveRecordPath } from "./operationActions";
import { cachedParentMap } from "./dragHitTesting";

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

// ── Enriched-collection cache ───────────────────────────────────────────────
// `buildCollection` spreads EVERY occurrence into an enriched record and walks
// each one's ancestor chain. On the measured grid that is 4122 records, and
// FieldRenderer calls it once per select/occurrence field per render — 1381ms
// (27% of active CPU) for ONE date navigation (2026-08-07 profile). The work
// is identical for every field in the pass, so it is done once here.
//
// Keyed on the OBJECT IDENTITY of both maps the records are derived from: the
// occurrence map (ids, parents, fields) and the module map (label/name/role/
// kind/meta fall back to the module). A rename swaps `modulesById` without
// touching `occurrencesById`, so keying on the occurrence map alone would
// serve stale labels. Nested WeakMaps mean an entry is collected as soon as
// either map is replaced — and since the store replaces both on every write,
// a new object IS the invalidation. NOTHING keys on a count or a length.
const _collectionCache = new WeakMap(); // occurrencesById → modulesById → { all, byRole }

function enrichedRecords(occurrencesById, modulesById) {
  let byModules = _collectionCache.get(occurrencesById);
  if (!byModules) {
    byModules = new WeakMap();
    _collectionCache.set(occurrencesById, byModules);
  }
  const hit = byModules.get(modulesById);
  if (hit) return hit;

  // Ancestor chains for HAS_ANCESTOR predicates (e.g. the Account picker's
  // `_ancestors HAS_ANCESTOR <library container>`). The executor enriches
  // its $allItems this way; the resolver never did, so every ancestor-scoped
  // optionsSource silently resolved to zero options (2026-07-07 audit).
  const parentByChildId = cachedParentMap(occurrencesById);
  const ancestorsFor = (id) => {
    const out = [];
    let cursor = id;
    let guard = 0;
    while (cursor && guard++ < 64) {
      const pid = parentByChildId[cursor] ?? occurrencesById[cursor]?.parentId ?? null;
      if (!pid || out.includes(pid)) break;
      out.push(pid);
      cursor = pid;
    }
    return out;
  };

  const all = Object.values(occurrencesById).map(occ => {
    const tpl = occ.moduleId ? modulesById[occ.moduleId] : null;
    return {
      ...occ,
      label: occ.label ?? tpl?.label ?? tpl?.name ?? null,
      name: occ.name ?? tpl?.name ?? tpl?.label ?? null,
      role: occ.role ?? tpl?.role ?? null,
      kind: occ.kind ?? tpl?.kind ?? null,
      meta: { ...(tpl?.meta || {}), ...(occ.meta || {}) },
      templateId: occ.moduleId ?? null,
      _ancestors: ancestorsFor(occ.id),
    };
  });

  const entry = { all, byRole: new Map() };
  byModules.set(modulesById, entry);
  return entry;
}

function buildCollection(over, ctx) {
  const { occurrencesById = {}, modulesById = {}, fieldsById = {} } = ctx;
  const filter = COLLECTION_KEYS[over];
  if (filter === undefined) return [];
  if (filter === "templates") return Object.values(modulesById);
  if (filter === "fields") return Object.values(fieldsById);

  const entry = enrichedRecords(occurrencesById, modulesById);
  if (filter === "all") return entry.all;
  let slice = entry.byRole.get(filter);
  if (!slice) {
    slice = entry.all.filter(r => r.role === filter);
    entry.byRole.set(filter, slice);
  }
  return slice;
}

export function resolveOptions(field, ctx, ownerOccurrence = null) {
  if (field?.type !== "select" && field?.type !== "occurrence") return { options: [], totalMatched: 0 };
  const src = field.meta?.optionsSource;
  if (!src?.mode) return { options: [], totalMatched: 0 };

  if (src.mode === "manual") {
    const values = Array.isArray(src.values) ? src.values : [];
    const options = values.map(v => {
      if (v && typeof v === "object" && "value" in v) {
        return { value: v.value, label: String(v.label ?? v.value) };
      }
      return { value: v, label: String(v) };
    });
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
    // Support both nested shape ({ find: { over, predicate, ... } }) and
    // flat shape ({ mode: "find", over, predicate, ... }).
    const cfg = src.find || src;
    const over = cfg.over || "$allOccurrences";
    const records = buildCollection(over, ctx);
    const predicate = cfg.predicate || { rules: [] };
    // Pass ownerOccurrence as $this so predicates can reference the instance
    // whose field is being resolved — e.g. `fields.category.value IS $this.fields.type.value`.
    const $vars = ownerOccurrence ? { $this: ownerOccurrence } : {};
    const matched = records.filter(r => {
      if (!predicate.rules?.length) return true;
      return evalGroupAgainstRecord(predicate, r, $vars);
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
