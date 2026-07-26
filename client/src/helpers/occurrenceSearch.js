// helpers/occurrenceSearch.js
//
// Occurrence search — index + query. Pure: no React, no socket, no DOM.
//
// HARD CONSTRAINT — no domain knowledge. This module reads occurrences,
// modules, fields and their values. It must never recognize a label prefix, a
// container kind, a page name, or a meta flag as MEANING something ("this is a
// schedule", "this is a day column"). Everything here is data-driven: a date is
// indexed because it is a date, a field value because it is a field value. If a
// behavior seems to need "but only for X", the answer is a field or an
// operation, not a branch in here.
import { buildParentMap } from "./dragHitTesting";
import { plainText } from "./textmapText";

const BODY_CHAR_CAP = 10000;   // one huge import must not dominate the index
const ISO_DAY_RX = /^\d{4}-\d{2}-\d{2}/;

const MONTHS_LONG = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS_LONG = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAYS_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
}

/**
 * Every spelling of a date someone might type. Local-tz parse — never
 * `new Date(iso)`, which reads a bare YYYY-MM-DD as UTC midnight and shifts
 * the weekday west of UTC.
 */
export function dateAliases(value) {
  const iso = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : typeof value === "string" && ISO_DAY_RX.test(value) ? value.slice(0, 10) : null;
  if (!iso) return [];
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return [];
  const mi = m - 1;
  return [
    iso,
    `${MONTHS_SHORT[mi]} ${d}`,
    `${MONTHS_LONG[mi]} ${d}`,
    `${MONTHS_LONG[mi]} ${ordinal(d)}`,
    DAYS_LONG[dt.getDay()],
    DAYS_SHORT[dt.getDay()],
    String(y),
  ];
}

/** A field value as searchable text. Reference values resolve to labels. */
export function fieldValueText(field, rawValue, occurrencesById) {
  if (rawValue == null || rawValue === "") return "";
  const type = field?.type;
  if (type === "boolean") return rawValue ? "yes" : "no";
  if (type === "date") return dateAliases(rawValue).join(" ");
  if (type === "occurrence") {
    const ids = Array.isArray(rawValue) ? rawValue : [rawValue];
    return ids
      .map(id => occurrencesById?.[id]?.label || null)
      .filter(Boolean)
      .join(" ");
  }
  if (Array.isArray(rawValue)) return rawValue.map(v => String(v)).join(" ");
  if (type === "number" || type === "duration") {
    const unit = field?.unit ? String(field.unit) : "";
    return unit ? `${rawValue} ${rawValue}${unit}` : String(rawValue);
  }
  return String(rawValue);
}

// FieldRenderer unwraps `{ value, flow }`; the raw store shape still carries it.
// Arrays pass through untouched — the 2026-07-12 extractValue bug was exactly
// this check treating an array as "an object with no value key".
function rawOf(stored) {
  if (stored && typeof stored === "object" && !Array.isArray(stored) && "value" in stored) return stored.value;
  return stored;
}

function labelOf(occ, modulesById) {
  return occ?.label ?? modulesById?.[occ?.moduleId || occ?.targetId]?.label ?? "";
}

/**
 * Every date alias carried by ONE occurrence: its own filter override, plus any
 * date-typed field value. Collected for the occurrence AND for each of its
 * ancestors, so a descendant is reachable by the date its container carries
 * ("9:00pm july 25" finds the 9:00pm item under the July 25 container).
 */
function datesForOcc(occ, fieldsById) {
  const out = [];
  for (const [fid, stored] of Object.entries(occ?.fields || {})) {
    if (fieldsById?.[fid]?.type !== "date") continue;
    const aliases = dateAliases(rawOf(stored));
    if (aliases.length) out.push(aliases.join(" "));
  }
  for (const v of Object.values(occ?.filterOverride || {})) {
    const iso = typeof v === "string" ? v : (v && typeof v === "object" ? v.value : null);
    const aliases = dateAliases(iso);
    if (aliases.length) out.push(aliases.join(" "));
  }
  return out;
}

/**
 * One index entry for a single occurrence, or null when it isn't indexable
 * (module-less orphan, or a panel — grid scaffolding, not content).
 *
 * Feed copies ARE indexed: they live on a real page, so hiding them would make
 * a board item you can see unfindable.
 */
export function buildEntry(occ, { occurrencesById, modulesById, fieldsById, parentOf }) {
  const module = modulesById[occ.moduleId || occ.targetId];
  if (!module) return null;
  if (module.role === "panel") return null;

  // Dates are pure data — the index has no notion of what a date on an
  // occurrence signifies, only that it is one.
  const dateBits = datesForOcc(occ, fieldsById);

  // Ancestor chain, closest-first; labels reversed for root-first display.
  // Ancestors contribute their labels AND their dates.
  const ancestorIds = [];
  const pathLabels = [];
  let pageOccId = module.role === "page" ? occ.id : null;
  let cursor = parentOf(occ.id);
  let guard = 0;
  while (cursor && guard++ < 64) {
    const anc = occurrencesById[cursor];
    if (!anc) break;
    const ancMod = modulesById[anc.moduleId || anc.targetId];
    ancestorIds.push(cursor);
    if (ancMod && ancMod.role !== "panel") pathLabels.unshift(labelOf(anc, modulesById));
    if (!pageOccId && ancMod?.role === "page") pageOccId = anc.id;
    dateBits.push(...datesForOcc(anc, fieldsById));
    cursor = parentOf(cursor);
  }

  // Fields: names + values, and the pairs a result row shows as "why it matched".
  const fieldPairs = [];
  for (const [fid, stored] of Object.entries(occ.fields || {})) {
    const field = fieldsById[fid];
    if (!field) continue;
    const text = fieldValueText(field, rawOf(stored), occurrencesById);
    if (!text) continue;
    fieldPairs.push({ name: field.name || "", text });
  }

  let body = occ.textmap && typeof occ.textmap === "object" ? plainText(occ.textmap) : "";
  for (const cell of Object.values(occ.meta?.table?.cells || {})) {
    if (body.length >= BODY_CHAR_CAP) break;
    const t = cell && typeof cell === "object" ? plainText(cell) : "";
    if (t) body += (body ? " " : "") + t;
  }
  if (body.length > BODY_CHAR_CAP) body = body.slice(0, BODY_CHAR_CAP);

  const label = labelOf(occ, modulesById);
  return {
    occId: occ.id,
    label,
    pathLabels,
    ancestorIds,
    pageOccId,
    role: module.role,
    kind: module.kind,
    fieldPairs,
    haystacks: {
      label: label.toLowerCase(),
      path: pathLabels.join(" ").toLowerCase(),
      fields: fieldPairs.map(p => `${p.name} ${p.text}`).join(" ").toLowerCase(),
      body: body.toLowerCase(),
      dates: dateBits.join(" ").toLowerCase(),
    },
  };
}

/** Index every indexable occurrence on the grid. */
export function buildSearchIndex({ occurrencesById = {}, modulesById = {}, fieldsById = {}, gridId = null } = {}) {
  const parentBy = buildParentMap(occurrencesById);
  const parentOf = (id) => parentBy[id] ?? occurrencesById[id]?.parentId ?? null;
  const ctx = { occurrencesById, modulesById, fieldsById, parentOf };

  const entries = [];
  const byId = new Map();
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.id) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    const entry = buildEntry(occ, ctx);
    if (!entry) continue;
    entries.push(entry);
    byId.set(entry.occId, entry);
  }
  return { entries, byId };
}

// ── Query ────────────────────────────────────────────────────────────────
// Tiers, lower is better. Tiering is load-bearing: without it, typing "water"
// buries the Drink Water item under every paragraph that mentions water.
const TIER_LABEL_PREFIX = 0;
const TIER_LABEL_SUBSTR = 1;
const TIER_FIELD        = 2;
const TIER_PATH         = 3;
const TIER_BODY         = 4;
const TIER_MISS         = Infinity;

const WHY_SOURCE_BY_TIER = { [TIER_FIELD]: "field", [TIER_PATH]: "path", [TIER_BODY]: "body" };

function tierForTerm(h, term) {
  if (h.label.startsWith(term)) return TIER_LABEL_PREFIX;
  if (h.label.includes(term)) return TIER_LABEL_SUBSTR;
  if (h.fields.includes(term)) return TIER_FIELD;
  if (h.path.includes(term) || h.dates.includes(term)) return TIER_PATH;
  if (h.body.includes(term)) return TIER_BODY;
  return TIER_MISS;
}

// The fragment around the first hit, so a non-label row explains itself.
function whyFor(entry, tier, term) {
  const source = WHY_SOURCE_BY_TIER[tier];
  if (!source) return null;
  if (source === "field") {
    const pair = entry.fieldPairs.find(p => `${p.name} ${p.text}`.toLowerCase().includes(term));
    return pair ? { source, text: `${pair.name} ${pair.text}`.trim() } : { source, text: "" };
  }
  if (source === "path") return { source, text: entry.pathLabels.join(" › ") };
  const body = entry.haystacks.body;
  const at = body.indexOf(term);
  const from = Math.max(0, at - 40);
  const to = Math.min(body.length, at + term.length + 60);
  return { source, text: `${from > 0 ? "…" : ""}${body.slice(from, to)}${to < body.length ? "…" : ""}` };
}

/**
 * AND-of-terms over every haystack. `water 9:00am` matches only the copy under
 * the 9:00am container; `9pm july 25` matches the 9:00pm occurrence whose
 * ancestor carries that date. Substring, case-insensitive, no fuzzing —
 * with AND-of-terms, fuzz produces more noise than help.
 */
export function searchOccurrences(index, query, { scopeRootId = null, limit = 50 } = {}) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length || !index?.entries?.length) return { results: [], total: 0 };

  const scored = [];
  for (const entry of index.entries) {
    if (scopeRootId) {
      if (entry.occId === scopeRootId) continue;
      if (!entry.ancestorIds.includes(scopeRootId)) continue;
    }
    let score = 0;
    let worstTier = -1;
    let why = null;
    for (const term of terms) {
      const tier = tierForTerm(entry.haystacks, term);
      if (tier === TIER_MISS) { score = TIER_MISS; break; }
      score += tier;
      if (tier > worstTier) { worstTier = tier; why = whyFor(entry, tier, term); }
    }
    if (score === TIER_MISS) continue;
    scored.push({ entry, score, tier: worstTier, why });
  }

  scored.sort((a, b) =>
    a.score - b.score ||
    a.entry.ancestorIds.length - b.entry.ancestorIds.length ||
    a.entry.label.localeCompare(b.entry.label) ||
    a.entry.occId.localeCompare(b.entry.occId));

  return { results: scored.slice(0, limit), total: scored.length };
}

// ── Cached access ────────────────────────────────────────────────────────
// Extracting body text is the expensive part of indexing, so entries are cached
// on the occurrence OBJECT: a write swaps the identity of only what changed, and
// everything else is reused. An entry also embeds its ancestors' labels and
// dates, so the cache record holds the ancestor objects it was built from and is
// invalidated when any of them is replaced (a parent rename must not leave a
// child with a stale path). The assembled index is memoized on the map identity.
const _entryCache = new WeakMap();
let _lastArgs = null;
let _lastIndex = null;

export function getSearchIndex({ occurrencesById = {}, modulesById = {}, fieldsById = {}, gridId = null } = {}) {
  if (_lastArgs
    && _lastArgs.occurrencesById === occurrencesById
    && _lastArgs.modulesById === modulesById
    && _lastArgs.fieldsById === fieldsById
    && _lastArgs.gridId === gridId) return _lastIndex;

  const parentBy = buildParentMap(occurrencesById);
  const parentOf = (id) => parentBy[id] ?? occurrencesById[id]?.parentId ?? null;
  const ctx = { occurrencesById, modulesById, fieldsById, parentOf };

  const entries = [];
  const byId = new Map();
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.id) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;

    const cached = _entryCache.get(occ);
    const reusable = cached
      && cached.modulesById === modulesById
      && cached.fieldsById === fieldsById
      && cached.ancestors.every(a => occurrencesById[a.id] === a);

    let entry;
    if (reusable) {
      entry = cached.entry;
    } else {
      entry = buildEntry(occ, ctx);
      if (entry) {
        _entryCache.set(occ, {
          entry,
          modulesById,
          fieldsById,
          ancestors: entry.ancestorIds.map(id => occurrencesById[id]).filter(Boolean),
        });
      }
    }
    if (!entry) continue;
    entries.push(entry);
    byId.set(entry.occId, entry);
  }

  _lastArgs = { occurrencesById, modulesById, fieldsById, gridId };
  _lastIndex = { entries, byId };
  return _lastIndex;
}
