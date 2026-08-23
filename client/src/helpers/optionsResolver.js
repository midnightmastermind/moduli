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

// ── Find-mode RESULT cache ──────────────────────────────────────────────────
// `enrichedRecords` above shares the RECORDS between fields. What it cannot
// share is the per-field predicate scan, and that is where the time went:
// measured on poms grid, 772 occurrences each ran an INDEPENDENT filter over
// 7322 records, producing one of only 45 distinct results — ~5.6M predicate
// evaluations where 45 computations would do (~766ms of a date navigation,
// 2026-08-07 profile).
//
// The rows can share because the result does not depend on WHICH row is asking
// — with ONE exception. `ownerOccurrence` is used for exactly one thing: it is
// bound as `$this` so a predicate can reference the asking row
// (`fields.category.value IS $this.fields.type.value`). A predicate that uses
// it is NEVER cached. Measured before relying on it: 0 of 45 find-mode
// predicates on poms grid reference `$this`, and 0 of 42 on test grid 2 — but
// the guard is what makes that a fact about today's data rather than an
// assumption baked into the code.
//
// Keyed the same way `enrichedRecords` is, and for the same reason: the OBJECT
// IDENTITY of every map the answer derives from, plus the FIELD object (whose
// identity changes when its predicate is edited, because the store replaces
// `fieldsById`). NOTHING keys on a count or a length — a tree can be re-parented
// or a value edited with the count unchanged, and a derived-scalar key would
// serve the stale answer. A wrongly-keyed cache here fails SILENTLY, as zero
// options in a dropdown (2026-07-07), which is why the invalidation cases are
// tested by moving the world WITHOUT changing its size.
const _resultCache = new WeakMap(); // occurrencesById → modulesById → field → result
const _usesThisCache = new WeakMap(); // predicate object → boolean

function predicateUsesThis(predicate) {
  if (!predicate || typeof predicate !== "object") return false;
  const hit = _usesThisCache.get(predicate);
  if (hit !== undefined) return hit;
  let uses = false;
  try {
    uses = JSON.stringify(predicate).includes("$this");
  } catch {
    uses = true; // unserialisable → assume it does, and never share it
  }
  _usesThisCache.set(predicate, uses);
  return uses;
}

// Walks/creates the nested WeakMap chain. Returns the leaf holder.
//
// There is deliberately NO `fieldsById` level: the FIELD OBJECT is the leaf key,
// and the store replaces that object whenever its content changes, so a level
// keyed on the map it came from discriminates nothing. A/B'd — adding it back
// fails zero tests, and a cache level nobody has watched catch anything is
// exactly the kind of guard that gets trusted without earning it.
function resultSlot(occurrencesById, modulesById) {
  let byModules = _resultCache.get(occurrencesById);
  if (!byModules) { byModules = new WeakMap(); _resultCache.set(occurrencesById, byModules); }
  let byField = byModules.get(modulesById);
  if (!byField) { byField = new WeakMap(); byModules.set(modulesById, byField); }
  return byField;
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
    const predicate = cfg.predicate || { rules: [] };

    // Shareable only when the answer does not depend on the asking row.
    const shareable = !predicateUsesThis(predicate);
    let slot = null;
    if (shareable) {
      const { occurrencesById, modulesById } = ctx || {};
      // WeakMap keys must be objects; a caller passing a primitive or nothing
      // simply does not get a cache rather than throwing.
      if (occurrencesById && typeof occurrencesById === "object"
          && modulesById && typeof modulesById === "object"
          && field && typeof field === "object") {
        slot = resultSlot(occurrencesById, modulesById);
        const hit = slot.get(field);
        if (hit) return hit;
      }
    }

    const records = buildCollection(over, ctx);
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

    // Frozen because it is now SHARED across every row rendering this field —
    // one caller mutating it would change what every other row sees. Every
    // consumer today only reads (`.map` / `.find` / indexing); this makes that
    // a guarantee rather than an audit.
    const result = Object.freeze({ options: Object.freeze(options), totalMatched });
    if (slot) slot.set(field, result);
    return result;
  }

  return { options: [], totalMatched: 0 };
}
