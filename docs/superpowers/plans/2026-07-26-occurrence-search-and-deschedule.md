# Occurrence Search + De-schedule Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live occurrence search to the panel header (grid-wide) and the page header (page-scoped) that matches labels, locations, field names/values and body text — and remove every place the client code recognizes "a schedule".

**Architecture:** One pure engine (`helpers/occurrenceSearch.js`) builds a per-occurrence index of lowercased haystacks and answers AND-of-terms queries with tiered ranking; one component (`ui/OccurrenceSearch.jsx`) renders it at both mount sites; one shared helper opens a result in a panel. Separately, four renderer-level schedule assumptions are deleted or made data-driven, `SET_FILTER` is fixed to write the filter cascade (not just the nav widget), and a seeded onLoad op snaps the grid filter to today once per day.

**Tech Stack:** React 18, Vitest + Testing Library, lucide-react icons, Redux-style reducer over socket.io. No new dependencies.

## Global Constraints

- **No domain knowledge in app code.** No branch may key off a label prefix, a page name, a container kind, or a `meta` flag meaning "this is a schedule / day column / goal". Capabilities are data-driven: a date is indexed because it is a date. Seed files (`server/scripts/createLiveData.js`, `server/utils/createDefaultUserData.js`, `server/utils/liveSystemBuilders.js`) are exempt — they author data.
- **No abbreviations in user-visible text.** Full words; the marquee owns overflow.
- **Unique field names.** Any new field must not collide case-insensitively with an existing one.
- **Client mutations go through `CommitHelpers`.** No component calls `socket.emit` directly.
- **Ancestor walks use `occurrences[]` first, `parentId` as fallback** — via `buildParentMap` from `helpers/dragHitTesting.js`.
- **Local-timezone dates only.** `toISOString().slice(0,10)` is banned; build `YYYY-MM-DD` from `getFullYear()/getMonth()/getDate()`.
- Client tests: `cd client && ./node_modules/.bin/vitest run <path>`. Full suite: `npm test` in `client/`. Server: `npm test` in `server/`.
- Baseline before starting: 1352 client tests, 245 server tests passing.

---

### Task 1: Lift `plainText` into its own module

`plainText(tiptapDoc) → string` currently lives in `helpers/tableCells.js`. The search engine needs it, and a search helper importing from table code is a bad dependency edge.

**Files:**
- Create: `client/src/helpers/textmapText.js`
- Modify: `client/src/helpers/tableCells.js:21-30`
- Test: `client/src/__tests__/textmapText.test.js`

**Interfaces:**
- Produces: `plainText(doc) → string` (trimmed concatenation of every `text` node, depth-first)

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/textmapText.test.js
import { describe, it, expect } from "vitest";
import { plainText } from "../helpers/textmapText";

describe("plainText", () => {
  it("concatenates text nodes depth-first", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] },
        { type: "paragraph", content: [{ type: "text", text: "!" }] },
      ],
    };
    expect(plainText(doc)).toBe("Hello world!");
  });

  it("ignores non-text nodes and is null-safe", () => {
    expect(plainText({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "x" } }] })).toBe("");
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/textmapText.test.js`
Expected: FAIL — `Failed to resolve import "../helpers/textmapText"`.

- [ ] **Step 3: Create the module**

```js
// client/src/helpers/textmapText.js
// Plain-text extraction from a TipTap document. Shared by the table cell
// helpers (sort keys) and the occurrence search index (body haystack).
export function plainText(doc) {
  let out = "";
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") out += n.text;
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out.trim();
}
```

- [ ] **Step 4: Re-point `tableCells.js` at it**

In `client/src/helpers/tableCells.js`, delete the local `plainText` definition (lines 21-30) and add at the top of the file, after the existing imports (or as the first line if there are none):

```js
import { plainText } from "./textmapText";
export { plainText };
```

The re-export keeps every existing `import { plainText } from "./tableCells"` call site working.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/textmapText.test.js src/__tests__/tableCells.test.js`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add client/src/helpers/textmapText.js client/src/helpers/tableCells.js client/src/__tests__/textmapText.test.js
git commit -m "refactor: lift plainText out of tableCells into helpers/textmapText"
```

---

### Task 2: Search index — entries, haystacks, date aliases

The index is one entry per occurrence with pre-lowercased haystacks. This task builds it; Task 3 queries it.

**Files:**
- Create: `client/src/helpers/occurrenceSearch.js`
- Test: `client/src/__tests__/occurrenceSearch.test.js`

**Interfaces:**
- Consumes: `plainText` (Task 1), `buildParentMap(occurrencesById) → { [childId]: parentId }` from `helpers/dragHitTesting.js`
- Produces:
  - `dateAliases(iso) → string[]`
  - `fieldValueText(field, rawValue, occurrencesById) → string`
  - `buildSearchIndex({ occurrencesById, modulesById, fieldsById, gridId }) → { entries, byId }`
  - `SearchEntry = { occId, label, pathLabels, ancestorIds, pageOccId, role, kind, haystacks: { label, path, fields, body, dates }, fieldPairs }`

- [ ] **Step 1: Write the failing tests**

```js
// client/src/__tests__/occurrenceSearch.test.js
import { describe, it, expect } from "vitest";
import { dateAliases, fieldValueText, buildSearchIndex } from "../helpers/occurrenceSearch";

describe("dateAliases", () => {
  it("expands an ISO day into every spelling a person might type", () => {
    const a = dateAliases("2026-07-25");
    expect(a).toContain("2026-07-25");
    expect(a).toContain("jul 25");
    expect(a).toContain("july 25");
    expect(a).toContain("july 25th");
    expect(a).toContain("saturday");
    expect(a).toContain("2026");
  });

  it("returns nothing for a non-date", () => {
    expect(dateAliases("not a date")).toEqual([]);
    expect(dateAliases(null)).toEqual([]);
  });
});

describe("fieldValueText", () => {
  const occs = { o1: { id: "o1", label: "Tortillas" }, o2: { id: "o2", label: "Cheese" } };

  it("appends the unit to a number", () => {
    expect(fieldValueText({ type: "number", unit: "g" }, 42, occs)).toBe("42 42g");
  });

  it("spells booleans", () => {
    expect(fieldValueText({ type: "boolean" }, true, occs)).toBe("yes");
    expect(fieldValueText({ type: "boolean" }, false, occs)).toBe("no");
  });

  it("resolves occurrence references to their labels, never ids", () => {
    const out = fieldValueText({ type: "occurrence" }, ["o1", "o2"], occs);
    expect(out).toBe("Tortillas Cheese");
    expect(out).not.toContain("o1");
  });

  it("expands a date value into aliases", () => {
    expect(fieldValueText({ type: "date" }, "2026-07-25", occs)).toContain("july 25");
  });
});

describe("buildSearchIndex", () => {
  const fieldsById = {
    f_water: { id: "f_water", name: "Water", type: "number", unit: "oz" },
    f_date: { id: "f_date", name: "Date", type: "date" },
  };
  const modulesById = {
    m_page: { id: "m_page", role: "page", kind: "board", label: "Routines" },
    m_cont: { id: "m_cont", role: "container", kind: "list", label: "Physical" },
    m_item: { id: "m_item", role: "instance", kind: "list", label: "Drink Water" },
    m_panel: { id: "m_panel", role: "panel", kind: "board", label: "Left Panel" },
    m_text: { id: "m_text", role: "textblock", kind: "doc", label: "" },
  };
  const occurrencesById = {
    panel1: { id: "panel1", gridId: "g1", moduleId: "m_panel", occurrences: ["page1"] },
    page1: { id: "page1", gridId: "g1", moduleId: "m_page", occurrences: ["cont1", "text1"] },
    cont1: {
      id: "cont1", gridId: "g1", moduleId: "m_cont", occurrences: ["item1"],
      filterOverride: { f_date: "2026-07-25" },
    },
    item1: {
      id: "item1", gridId: "g1", moduleId: "m_item",
      fields: { f_water: { value: 16, flow: "in" } },
    },
    text1: {
      id: "text1", gridId: "g1", moduleId: "m_text",
      textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hydration matters" }] }] },
    },
    other: { id: "other", gridId: "g2", moduleId: "m_item" },
  };
  const build = () => buildSearchIndex({ occurrencesById, modulesById, fieldsById, gridId: "g1" });

  it("excludes panels, other grids, and module-less occurrences", () => {
    const ids = build().entries.map(e => e.occId);
    expect(ids).toContain("item1");
    expect(ids).toContain("page1");
    expect(ids).not.toContain("panel1");
    expect(ids).not.toContain("other");
  });

  it("indexes the ancestor path root-first", () => {
    const e = build().byId.get("item1");
    expect(e.pathLabels).toEqual(["Routines", "Physical"]);
    expect(e.haystacks.path).toBe("routines physical");
  });

  it("resolves the nearest page ancestor", () => {
    expect(build().byId.get("item1").pageOccId).toBe("page1");
    expect(build().byId.get("page1").pageOccId).toBe("page1");
  });

  it("indexes field names and values together", () => {
    const e = build().byId.get("item1");
    expect(e.haystacks.fields).toContain("water");
    expect(e.haystacks.fields).toContain("16oz");
  });

  it("indexes a date from filterOverride as aliases", () => {
    expect(build().byId.get("cont1").haystacks.dates).toContain("july 25");
  });

  it("indexes textmap body text", () => {
    expect(build().byId.get("text1").haystacks.body).toBe("hydration matters");
  });

  it("falls back to the module label and prefers the occurrence override", () => {
    expect(build().byId.get("item1").label).toBe("Drink Water");
    const withOverride = buildSearchIndex({
      occurrencesById: { ...occurrencesById, item1: { ...occurrencesById.item1, label: "Sip Water" } },
      modulesById, fieldsById, gridId: "g1",
    });
    expect(withOverride.byId.get("item1").label).toBe("Sip Water");
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearch.test.js`
Expected: FAIL — `Failed to resolve import "../helpers/occurrenceSearch"`.

- [ ] **Step 3: Write the index builder**

```js
// client/src/helpers/occurrenceSearch.js
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
 * One entry per indexable occurrence, with lowercased haystacks.
 * Excludes panels (grid scaffolding), other grids, and module-less orphans.
 * Feed copies are INCLUDED — they live on a real page, so hiding them would
 * make a visible board item unfindable.
 */
export function buildSearchIndex({ occurrencesById = {}, modulesById = {}, fieldsById = {}, gridId = null } = {}) {
  const parentBy = buildParentMap(occurrencesById);
  const parentOf = (id) => parentBy[id] ?? occurrencesById[id]?.parentId ?? null;

  const entries = [];
  const byId = new Map();

  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.id) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    const module = modulesById[occ.moduleId || occ.targetId];
    if (!module) continue;
    if (module.role === "panel") continue;

    // Ancestor chain, closest-first, then reversed for display.
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
      cursor = parentOf(cursor);
    }

    // Fields: names + values, and the pairs the result row shows as "why".
    const fieldPairs = [];
    const dateBits = [];
    for (const [fid, stored] of Object.entries(occ.fields || {})) {
      const field = fieldsById[fid];
      if (!field) continue;
      const text = fieldValueText(field, rawOf(stored), occurrencesById);
      if (!text) continue;
      fieldPairs.push({ name: field.name || "", text });
      if (field.type === "date") dateBits.push(text);
    }

    // Dates also come from the occurrence's own filter override — pure data,
    // no notion of what that date means.
    for (const v of Object.values(occ.filterOverride || {})) {
      const iso = typeof v === "string" ? v : (v && typeof v === "object" ? v.value : null);
      const aliases = dateAliases(iso);
      if (aliases.length) dateBits.push(aliases.join(" "));
    }

    let body = occ.textmap && typeof occ.textmap === "object" ? plainText(occ.textmap) : "";
    for (const cell of Object.values(occ.meta?.table?.cells || {})) {
      if (body.length >= BODY_CHAR_CAP) break;
      const t = cell && typeof cell === "object" ? plainText(cell) : "";
      if (t) body += (body ? " " : "") + t;
    }
    if (body.length > BODY_CHAR_CAP) body = body.slice(0, BODY_CHAR_CAP);

    const label = labelOf(occ, modulesById);
    const entry = {
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
    entries.push(entry);
    byId.set(entry.occId, entry);
  }

  return { entries, byId };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearch.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/occurrenceSearch.js client/src/__tests__/occurrenceSearch.test.js
git commit -m "feat(search): occurrence index — labels, paths, fields, dates, body text"
```

---

### Task 3: Query — AND-of-terms, tiered ranking, scoping, why-matched

**Files:**
- Modify: `client/src/helpers/occurrenceSearch.js` (append)
- Test: `client/src/__tests__/occurrenceSearch.query.test.js`

**Interfaces:**
- Consumes: `buildSearchIndex` (Task 2)
- Produces: `searchOccurrences(index, query, { scopeRootId = null, limit = 50 }) → { results, total }` where
  `results[] = { entry, score, tier, why: { source, text } | null }` and `source` is one of
  `"field" | "path" | "date" | "body"` (null when the label alone matched)

- [ ] **Step 1: Write the failing tests**

```js
// client/src/__tests__/occurrenceSearch.query.test.js
import { describe, it, expect } from "vitest";
import { buildSearchIndex, searchOccurrences } from "../helpers/occurrenceSearch";

const fieldsById = {
  f_protein: { id: "f_protein", name: "Protein", type: "number", unit: "g" },
  f_date: { id: "f_date", name: "Date", type: "date" },
};
const modulesById = {
  m_page: { id: "m_page", role: "page", kind: "board", label: "Routines" },
  m_slot6: { id: "m_slot6", role: "container", kind: "list", label: "6:00am" },
  m_slot9: { id: "m_slot9", role: "container", kind: "list", label: "9:00am" },
  m_water: { id: "m_water", role: "instance", kind: "list", label: "Drink Water" },
  m_meal: { id: "m_meal", role: "instance", kind: "list", label: "Greek Salad" },
  m_text: { id: "m_text", role: "textblock", kind: "doc", label: "Intro" },
};
const occurrencesById = {
  page1: { id: "page1", gridId: "g1", moduleId: "m_page", occurrences: ["slot6", "slot9", "meal1", "text1"] },
  slot6: { id: "slot6", gridId: "g1", moduleId: "m_slot6", occurrences: ["water6"], filterOverride: { f_date: "2026-07-25" } },
  slot9: { id: "slot9", gridId: "g1", moduleId: "m_slot9", occurrences: ["water9"] },
  water6: { id: "water6", gridId: "g1", moduleId: "m_water" },
  water9: { id: "water9", gridId: "g1", moduleId: "m_water" },
  meal1: { id: "meal1", gridId: "g1", moduleId: "m_meal", fields: { f_protein: { value: 42 } } },
  text1: {
    id: "text1", gridId: "g1", moduleId: "m_text",
    textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "drink water often" }] }] },
  },
  outside: { id: "outside", gridId: "g1", moduleId: "m_water" },
};
const index = buildSearchIndex({ occurrencesById, modulesById, fieldsById, gridId: "g1" });
const ids = (q, opts) => searchOccurrences(index, q, opts).results.map(r => r.entry.occId);

describe("searchOccurrences", () => {
  it("returns nothing for an empty query", () => {
    expect(searchOccurrences(index, "   ").results).toEqual([]);
  });

  it("ranks a label match above a body-text match", () => {
    const out = ids("water");
    expect(out.indexOf("water6")).toBeLessThan(out.indexOf("text1"));
  });

  it("requires every term to match — location terms narrow the result", () => {
    expect(ids("water 9:00am")).toEqual(["water9"]);
  });

  it("matches an ancestor date alias from a descendant", () => {
    expect(ids("water july 25")).toEqual(["water6"]);
  });

  it("matches a field name and a field value", () => {
    expect(ids("protein")).toEqual(["meal1"]);
    expect(ids("42g")).toEqual(["meal1"]);
  });

  it("reports why a non-label match hit", () => {
    const [hit] = searchOccurrences(index, "protein").results;
    expect(hit.why.source).toBe("field");
    expect(hit.why.text.toLowerCase()).toContain("protein");
    const [labelHit] = searchOccurrences(index, "greek").results;
    expect(labelHit.why).toBeNull();
  });

  it("scopes to a subtree when scopeRootId is given", () => {
    expect(ids("water", { scopeRootId: "slot9" })).toEqual(["water9"]);
    expect(ids("water", { scopeRootId: "page1" })).not.toContain("outside");
  });

  it("is case-insensitive and reports the untruncated total", () => {
    const out = searchOccurrences(index, "DRINK WATER", { limit: 1 });
    expect(out.results).toHaveLength(1);
    expect(out.total).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearch.query.test.js`
Expected: FAIL — `searchOccurrences is not a function`.

- [ ] **Step 3: Append the query half to `helpers/occurrenceSearch.js`**

```js
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
  const snippet = body.slice(from, Math.min(body.length, at + term.length + 60));
  return { source, text: `${from > 0 ? "…" : ""}${snippet}${at + term.length + 60 < body.length ? "…" : ""}` };
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearch.query.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/occurrenceSearch.js client/src/__tests__/occurrenceSearch.query.test.js
git commit -m "feat(search): AND-of-terms query with tiered ranking and why-matched"
```

---

### Task 4: Cached index accessor

Rebuilding the body-text haystack on every keystroke is wasteful; rebuilding it on every occurrence write is worse. Cache per occurrence object identity, so a write only re-extracts what changed.

**Files:**
- Modify: `client/src/helpers/occurrenceSearch.js` (append)
- Test: `client/src/__tests__/occurrenceSearch.cache.test.js`

**Interfaces:**
- Produces: `getSearchIndex({ occurrencesById, modulesById, fieldsById, gridId }) → index` (memoized)

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/occurrenceSearch.cache.test.js
import { describe, it, expect } from "vitest";
import { getSearchIndex } from "../helpers/occurrenceSearch";

const modulesById = { m: { id: "m", role: "instance", kind: "list", label: "Item" } };
const mk = (id, label) => ({ id, gridId: "g1", moduleId: "m", label });

describe("getSearchIndex", () => {
  it("returns the same index object for an unchanged map", () => {
    const occurrencesById = { a: mk("a", "Alpha") };
    const args = { occurrencesById, modulesById, fieldsById: {}, gridId: "g1" };
    expect(getSearchIndex(args)).toBe(getSearchIndex(args));
  });

  it("reuses entries for occurrences that did not change", () => {
    const a = mk("a", "Alpha");
    const first = getSearchIndex({ occurrencesById: { a }, modulesById, fieldsById: {}, gridId: "g1" });
    const second = getSearchIndex({
      occurrencesById: { a, b: mk("b", "Beta") },   // new map, `a` unchanged
      modulesById, fieldsById: {}, gridId: "g1",
    });
    expect(second.byId.get("a")).toBe(first.byId.get("a"));
    expect(second.byId.get("b").label).toBe("Beta");
  });

  it("rebuilds the entry for an occurrence that did change", () => {
    const a = mk("a", "Alpha");
    const first = getSearchIndex({ occurrencesById: { a }, modulesById, fieldsById: {}, gridId: "g1" });
    const second = getSearchIndex({
      occurrencesById: { a: { ...a, label: "Renamed" } },
      modulesById, fieldsById: {}, gridId: "g1",
    });
    expect(second.byId.get("a")).not.toBe(first.byId.get("a"));
    expect(second.byId.get("a").label).toBe("Renamed");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearch.cache.test.js`
Expected: FAIL — `getSearchIndex is not a function`.

- [ ] **Step 3: Implement the cache**

First refactor `buildSearchIndex`: move the body of its `for` loop verbatim into a new module-level
`function buildEntry(occ, { occurrencesById, modulesById, fieldsById, parentOf })` that returns the
entry object (or `null` for a skipped occurrence — module-less, or `role === "panel"`), and have
`buildSearchIndex` build `parentOf` once and call `buildEntry` per occurrence, pushing non-null
results. No behavior change; the Task 2 tests must still pass unmodified. Then append:

```js
// Per-occurrence entry cache keyed on the occurrence OBJECT — a write swaps the
// identity of only what changed, so a rebuild re-extracts only those entries.
// The assembled index is memoized against the occurrencesById map identity.
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
    // An entry also depends on its ancestors' labels; a parent rename swaps the
    // parent's identity but not the child's, so the cache key includes the
    // rendered path. Cheap to compute, and it keeps stale paths out.
    const entry = (cached && cached.modulesById === modulesById && cached.fieldsById === fieldsById)
      ? cached.entry
      : buildEntry(occ, ctx);
    if (!entry) continue;
    if (!cached || cached.entry !== entry) _entryCache.set(occ, { entry, modulesById, fieldsById });
    entries.push(entry);
    byId.set(entry.occId, entry);
  }

  _lastArgs = { occurrencesById, modulesById, fieldsById, gridId };
  _lastIndex = { entries, byId };
  return _lastIndex;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearch.cache.test.js src/__tests__/occurrenceSearch.test.js src/__tests__/occurrenceSearch.query.test.js`
Expected: PASS, all three files.

- [ ] **Step 5: Commit**

```bash
git add client/src/helpers/occurrenceSearch.js client/src/__tests__/occurrenceSearch.cache.test.js
git commit -m "perf(search): memoize the index, cache entries per occurrence identity"
```

---

### Task 5: `openOccurrenceInPanel` — one implementation, two callers

`ui/AssistantDrawer.jsx` (`PanelPickCard.openInPanel`, ~line 1085-1115) already does resolve-page →
pin → activate → jump. The panel search needs the same. Extract it.

**Files:**
- Create: `client/src/helpers/openOccurrenceInPanel.js`
- Modify: `client/src/ui/AssistantDrawer.jsx` (replace the inline sequence with a call)
- Test: `client/src/__tests__/openOccurrenceInPanel.test.js`

**Interfaces:**
- Consumes: `CommitHelpers.pinPageToPanel({ dispatch, socket, pageOccurrenceId, panelOccurrenceId })`,
  `CommitHelpers.updateView({ dispatch, socket, view, emit })`, `jumpToOccurrence(occId, opts)`
- Produces: `openOccurrenceInPanel({ occId, panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket }) → { ok, pageOccId, alreadyOpen }`

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/openOccurrenceInPanel.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../helpers/CommitHelpers", () => ({
  pinPageToPanel: vi.fn(),
  updateView: vi.fn(),
}));
vi.mock("../helpers/jumpToOccurrence", () => ({ jumpToOccurrence: vi.fn(() => true) }));

import * as CommitHelpers from "../helpers/CommitHelpers";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel";

const modulesById = {
  m_page: { id: "m_page", role: "page", kind: "board" },
  m_item: { id: "m_item", role: "instance", kind: "list" },
};
const occurrencesById = {
  page1: { id: "page1", moduleId: "m_page", occurrences: ["item1"] },
  item1: { id: "item1", moduleId: "m_item" },
};
const viewsById = { v1: { id: "v1", activeOccurrenceId: null } };
const base = { occurrencesById, modulesById, viewsById, dispatch: vi.fn(), socket: {} };

beforeEach(() => vi.clearAllMocks());

describe("openOccurrenceInPanel", () => {
  it("pins the ancestor page, activates it, then jumps", () => {
    const panelOccurrence = { id: "panel1", viewId: "v1", occurrences: [] };
    const out = openOccurrenceInPanel({ occId: "item1", panelOccurrence, ...base });
    expect(out).toMatchObject({ ok: true, pageOccId: "page1" });
    expect(CommitHelpers.pinPageToPanel).toHaveBeenCalledWith(
      expect.objectContaining({ pageOccurrenceId: "page1", panelOccurrenceId: "panel1" }));
    expect(CommitHelpers.updateView).toHaveBeenCalledWith(
      expect.objectContaining({ view: expect.objectContaining({ activeOccurrenceId: "page1" }) }));
    expect(jumpToOccurrence).toHaveBeenCalledWith("item1", expect.anything());
  });

  it("does not re-pin a page the panel already holds", () => {
    const panelOccurrence = { id: "panel1", viewId: "v1", occurrences: ["page1"] };
    openOccurrenceInPanel({ occId: "item1", panelOccurrence, ...base });
    expect(CommitHelpers.pinPageToPanel).not.toHaveBeenCalled();
    expect(CommitHelpers.updateView).toHaveBeenCalled();
  });

  it("skips pin and activate when the page is already active", () => {
    const panelOccurrence = { id: "panel1", viewId: "v1", occurrences: ["page1"] };
    const out = openOccurrenceInPanel({
      ...base, occId: "item1", panelOccurrence,
      viewsById: { v1: { id: "v1", activeOccurrenceId: "page1" } },
    });
    expect(out.alreadyOpen).toBe(true);
    expect(CommitHelpers.updateView).not.toHaveBeenCalled();
    expect(jumpToOccurrence).toHaveBeenCalled();
  });

  it("reports failure when the occurrence has no page ancestor", () => {
    const out = openOccurrenceInPanel({
      ...base, occId: "loose", panelOccurrence: { id: "panel1", viewId: "v1", occurrences: [] },
      occurrencesById: { loose: { id: "loose", moduleId: "m_item" } },
    });
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/openOccurrenceInPanel.test.js`
Expected: FAIL — cannot resolve `../helpers/openOccurrenceInPanel`.

- [ ] **Step 3: Write the helper**

```js
// client/src/helpers/openOccurrenceInPanel.js
//
// Open an occurrence in a specific panel: resolve its nearest ancestor page,
// pin that page to the panel if it isn't already a tab, make it the panel's
// active page, then scroll + flash the occurrence itself.
//
// One implementation, two callers (the assistant's panel picker and the panel
// header search) — the sequence is fiddly (pin, then activate, then jump after
// the page mounts) and was duplicated once already.
import * as CommitHelpers from "./CommitHelpers";
import { jumpToOccurrence } from "./jumpToOccurrence";
import { buildParentMap } from "./dragHitTesting";

export function nearestPageOccId(occId, { occurrencesById, modulesById }) {
  const parentBy = buildParentMap(occurrencesById);
  let cursor = occId;
  let guard = 0;
  while (cursor && guard++ < 64) {
    const occ = occurrencesById[cursor];
    if (!occ) return null;
    const mod = modulesById[occ.moduleId || occ.targetId];
    if (mod?.role === "page") return cursor;
    cursor = parentBy[cursor] ?? occ.parentId ?? null;
  }
  return null;
}

export function openOccurrenceInPanel({
  occId, panelOccurrence, occurrencesById = {}, modulesById = {}, viewsById = {}, dispatch, socket,
}) {
  if (!occId || !panelOccurrence?.id) return { ok: false, pageOccId: null, alreadyOpen: false };

  const pageOccId = nearestPageOccId(occId, { occurrencesById, modulesById });
  if (!pageOccId) return { ok: false, pageOccId: null, alreadyOpen: false };

  const viewId = panelOccurrence.viewId || modulesById[panelOccurrence.moduleId || panelOccurrence.targetId]?.viewId;
  const view = viewId ? viewsById[viewId] : null;
  const alreadyOpen = view?.activeOccurrenceId === pageOccId;

  if (!alreadyOpen) {
    if (!(panelOccurrence.occurrences || []).includes(pageOccId)) {
      CommitHelpers.pinPageToPanel({ dispatch, socket, pageOccurrenceId: pageOccId, panelOccurrenceId: panelOccurrence.id });
    }
    if (view) {
      CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: pageOccId }, emit: true });
    }
  }

  // jumpToOccurrence already retries after a page-switch grace window.
  const found = jumpToOccurrence(occId, { onActivatePage: () => {} });
  return { ok: true, pageOccId, alreadyOpen, found };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/openOccurrenceInPanel.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Migrate AssistantDrawer to the shared helper**

In `client/src/ui/AssistantDrawer.jsx`, inside `PanelPickCard.openInPanel`, replace the block that
starts at `let pageOccId;` and ends at `setTimeout(() => jumpToOccurrence(occId), 300);` with:

```js
    if (pageOcc) {
      openOccurrenceInPanel({
        occId, panelOccurrence: panelOcc, occurrencesById, modulesById, viewsById, dispatch, socket,
      });
    } else {
      // No ancestor page (an imported container at root) — wrap it in a doc page
      // under the Imports folder first, then activate that.
      const pageOccId = createImportsDocPage({
        rootOccId: occId, panelOccurrenceId: panelOcc.id, grid,
        manifests: Object.values(manifestsById || {}),
        folders: Object.values(foldersById || {}),
        occurrencesById, dispatch, socket, userId, label: mod?.label,
      });
      const panelMod = modulesById[panelOcc.moduleId || panelOcc.targetId];
      const viewId = panelOcc.viewId || panelMod?.viewId;
      const view = viewId ? viewsById?.[viewId] : null;
      if (view) CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: pageOccId }, emit: true });
      setTimeout(() => jumpToOccurrence(occId), 300);
    }
```

Add the import at the top of the file:

```js
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel";
```

- [ ] **Step 6: Run the full suite**

Run: `cd client && npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add client/src/helpers/openOccurrenceInPanel.js client/src/ui/AssistantDrawer.jsx client/src/__tests__/openOccurrenceInPanel.test.js
git commit -m "refactor: extract openOccurrenceInPanel, use it from the assistant panel picker"
```

---

### Task 6: `OccurrenceSearch` component

**Files:**
- Create: `client/src/ui/OccurrenceSearch.jsx`
- Modify: `client/src/index.css` (append a `.occ-search-*` block at the end)
- Test: `client/src/__tests__/occurrenceSearchUI.test.jsx`

**Interfaces:**
- Consumes: `getSearchIndex`, `searchOccurrences` (Tasks 2-4), `useGridActionsSelector`,
  `getModuleTypeIcon` from `helpers/moduleIcons`
- Produces: `<OccurrenceSearch scopeRootId={null} onPick={(occId, entry) => void} title="…" />`

- [ ] **Step 1: Write the failing test**

```jsx
// client/src/__tests__/occurrenceSearchUI.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";

const modulesById = { m: { id: "m", role: "instance", kind: "list", label: "Drink Water" } };
const occurrencesById = {
  page1: { id: "page1", gridId: "g1", moduleId: "mp", occurrences: ["a", "b"] },
  a: { id: "a", gridId: "g1", moduleId: "m", label: "Drink Water" },
  b: { id: "b", gridId: "g1", moduleId: "m", label: "Water Bottle" },
};
const state = { grid: { _id: "g1" } };

vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({
    occurrencesById,
    modulesById: { ...modulesById, mp: { id: "mp", role: "page", kind: "board", label: "Routines" } },
    fieldsById: {},
    state,
    grid: state.grid,
  }),
}));

beforeEach(() => vi.clearAllMocks());

describe("OccurrenceSearch", () => {
  it("starts collapsed and expands to an input on click", () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("lists matches with their location once you type", () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "water" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getAllByText("Routines").length).toBeGreaterThan(0);
  });

  it("picks the highlighted row on Enter", () => {
    const onPick = vi.fn();
    render(<OccurrenceSearch onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "water" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(typeof onPick.mock.calls[0][0]).toBe("string");
  });

  it("collapses and clears on Escape", () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "water" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearchUI.test.jsx`
Expected: FAIL — cannot resolve `../ui/OccurrenceSearch.jsx`.

- [ ] **Step 3: Write the component**

```jsx
// client/src/ui/OccurrenceSearch.jsx
//
// Live occurrence search. Collapsed it is a magnifying-glass button; clicking
// expands it into an input in place, and the results dropdown opens on the
// first keystroke. Mounted twice: in the panel header (whole grid, picking
// opens the result's page in that panel) and in the page header
// (scopeRootId = that page, picking just scrolls to it).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { useGridActionsSelector } from "../GridActionsContext.js";
import { getSearchIndex, searchOccurrences } from "../helpers/occurrenceSearch";
import { getModuleTypeIcon } from "../helpers/moduleIcons";

const MENU_W = 340;
const MENU_MAX_H = 380;
const DEBOUNCE_MS = 120;

// Split a string around the first match so it can be rendered with the hit bolded.
function highlight(text, term) {
  if (!term) return [text, "", ""];
  const at = text.toLowerCase().indexOf(term);
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), text.slice(at, at + term.length), text.slice(at + term.length)];
}

function Row({ hit, term, active, onPick, onHover }) {
  const { entry, why } = hit;
  const Icon = getModuleTypeIcon({ role: entry.role, kind: entry.kind });
  const [before, hitText, after] = highlight(entry.label || "Untitled", term);
  return (
    <div
      role="option"
      aria-selected={active}
      className={`occ-search-row${active ? " occ-search-row--active" : ""}`}
      onMouseEnter={onHover}
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
    >
      <Icon size={12} className="occ-search-row-icon" />
      <div className="occ-search-row-text">
        <div className="occ-search-row-label">
          {before}<mark>{hitText}</mark>{after}
        </div>
        {entry.pathLabels.length > 0 && (
          <div className="occ-search-row-path">{entry.pathLabels.join(" › ")}</div>
        )}
        {why && why.text && <div className="occ-search-row-why">{why.text}</div>}
      </div>
    </div>
  );
}

export default function OccurrenceSearch({
  scopeRootId = null,
  onPick,
  title = "Search occurrences",
  placeholder = "Search occurrences…",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchorRect, setAnchorRect] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const gridId = useGridActionsSelector(s => s.grid?._id || s.state?.grid?._id || null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Built lazily — nothing is indexed until the user actually types.
  const hits = useMemo(() => {
    if (!debounced) return { results: [], total: 0 };
    const index = getSearchIndex({ occurrencesById, modulesById, fieldsById, gridId });
    return searchOccurrences(index, debounced, { scopeRootId });
  }, [debounced, occurrencesById, modulesById, fieldsById, gridId, scopeRootId]);

  useEffect(() => { setActiveIdx(0); }, [debounced]);

  const close = useCallback(() => { setOpen(false); setQuery(""); setDebounced(""); }, []);

  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    setAnchorRect(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    // Reposition rather than close — the 2026-06-09 QuickAddMenu lesson: closing
    // on scroll fires on the menu's own internal scrolling.
    const onScroll = () => reposition();
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, reposition, close]);

  const pick = useCallback((hit) => {
    if (!hit) return;
    onPick?.(hit.entry.occId, hit.entry);
    close();
  }, [onPick, close]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, hits.results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); pick(hits.results[activeIdx]); }
  };

  const firstTerm = debounced.toLowerCase().split(/\s+/).filter(Boolean)[0] || "";

  const menu = open && debounced && anchorRect ? createPortal(
    <div
      role="listbox"
      className="occ-search-menu"
      style={{
        position: "fixed",
        top: Math.min(anchorRect.bottom + 4, window.innerHeight - MENU_MAX_H - 8),
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - MENU_W - 8)),
        width: MENU_W,
        maxHeight: MENU_MAX_H,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {hits.results.length === 0 ? (
        <div className="occ-search-empty">No matches</div>
      ) : (
        <>
          {hits.results.map((hit, i) => (
            <Row
              key={hit.entry.occId}
              hit={hit}
              term={firstTerm}
              active={i === activeIdx}
              onHover={() => setActiveIdx(i)}
              onPick={() => pick(hit)}
            />
          ))}
          {hits.total > hits.results.length && (
            <div className="occ-search-more">+{hits.total - hits.results.length} more</div>
          )}
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={wrapRef} className={`occ-search${open ? " occ-search--open" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      {open ? (
        <div className="occ-search-field">
          <Search size={11} className="occ-search-field-icon" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="textbox"
            className="occ-search-input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="occ-search-clear" title="Close search" aria-label="Close search" onClick={close}>
            <X size={11} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="occ-search-trigger"
          title={title}
          aria-label={title}
          onClick={() => { setOpen(true); requestAnimationFrame(reposition); }}
        >
          <Search size={11} />
        </button>
      )}
      {menu}
    </div>
  );
}
```

- [ ] **Step 4: Append the styles to `client/src/index.css`**

```css
/* ── Occurrence search (panel header = whole grid, page header = that page) ── */
.occ-search { display: flex; align-items: center; flex-shrink: 0; }
.occ-search--open { flex: 1 1 auto; min-width: 0; }
.occ-search-trigger {
  display: flex; align-items: center; justify-content: center;
  padding: 3px 5px; border: none; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--text-muted);
}
.occ-search-trigger:hover { color: var(--text-primary); background: rgba(255,255,255,0.06); }
.occ-search-field {
  display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0;
  padding: 2px 4px; border: 1px solid var(--border-default);
  border-radius: 4px; background: var(--input-bg);
}
.occ-search-field-icon { color: var(--text-faint); flex-shrink: 0; }
.occ-search-input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  font-size: 11px; font-family: var(--font-mono); color: var(--text-primary);
}
.occ-search-clear {
  display: flex; align-items: center; border: none; background: transparent;
  color: var(--text-faint); cursor: pointer; padding: 1px;
}
.occ-search-clear:hover { color: var(--text-primary); }
.occ-search-menu {
  z-index: 1200; overflow-y: auto;
  background: var(--surface, #1f2125);
  border: 1px solid var(--border-default); border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  padding: 4px;
}
.occ-search-row {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 5px 6px; border-radius: 4px; cursor: pointer;
}
.occ-search-row--active { background: rgba(96,165,250,0.14); }
.occ-search-row-icon { margin-top: 2px; flex-shrink: 0; opacity: 0.7; }
.occ-search-row-text { min-width: 0; flex: 1; }
.occ-search-row-label { font-size: 12px; color: var(--text-primary); }
.occ-search-row-label mark { background: rgba(96,165,250,0.35); color: inherit; border-radius: 2px; }
.occ-search-row-path,
.occ-search-row-why {
  font-size: 10px; color: var(--text-faint); font-family: var(--font-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.occ-search-row-why { color: var(--text-muted); font-style: italic; }
.occ-search-empty,
.occ-search-more { padding: 6px; font-size: 10px; color: var(--text-faint); text-align: center; }
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/occurrenceSearchUI.test.jsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/OccurrenceSearch.jsx client/src/index.css client/src/__tests__/occurrenceSearchUI.test.jsx
git commit -m "feat(search): OccurrenceSearch component — expanding field, ranked dropdown"
```

---

### Task 7: Mount the grid-wide search in the panel header

**Files:**
- Modify: `client/src/modules/ModulePanel.jsx` (imports; the action cluster at ~lines 906-930)

**Interfaces:**
- Consumes: `OccurrenceSearch` (Task 6), `openOccurrenceInPanel` (Task 5)

- [ ] **Step 1: Add the imports**

At the top of `client/src/modules/ModulePanel.jsx`:

```js
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel";
import { toast } from "sonner";
```

(`toast` may already be imported — check before adding a duplicate.)

- [ ] **Step 2: Add the pick handler**

Next to the existing `closePage` callback (~line 682):

```js
  const handleSearchPick = useCallback((occId) => {
    const res = openOccurrenceInPanel({
      occId,
      panelOccurrence,
      occurrencesById,
      modulesById,
      viewsById,
      dispatch,
      socket,
    });
    if (!res.ok) toast("That item isn't on a page yet");
    else if (res.found === false) toast("Found it, but it's hidden by the current filter");
  }, [panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket]);
```

If `occurrencesById` / `modulesById` / `viewsById` are not already destructured in this component,
add them to the existing `useGridActions()` destructure at the top of the component.

- [ ] **Step 3: Render it in the header action cluster**

In the `pageHeader` JSX, inside the action `<div>` that currently opens with the Root-tree button
(the one commented "Root tree toggle — replaces the + quick-add"), insert **before** that button:

```jsx
                <OccurrenceSearch onPick={handleSearchPick} title="Search all occurrences" />
```

Header order becomes: drag handle · Local tree · page label · **search** · Root tree · stack · fullscreen.

- [ ] **Step 4: Verify in the browser**

Run: `cd client && npm run build`
Expected: exit 0.

Then load the app, click the magnifying glass in a panel header, type a word that exists on
another page, and confirm the panel switches to that page and the row flashes.

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModulePanel.jsx
git commit -m "feat(search): grid-wide search in the panel header, opens results in that panel"
```

---

### Task 8: Mount the page-scoped search + the page close button

**Files:**
- Modify: `client/src/modules/ModulePage.jsx` (imports; header cluster at ~lines 666-700)
- Modify: `client/src/modules/ModulePanel.jsx` (pass `onClosePage` into `<Page>`)

**Interfaces:**
- Consumes: `OccurrenceSearch` (Task 6), `jumpToOccurrence` (already imported in ModulePage),
  `closePage` (already defined in ModulePanel at line 682)

- [ ] **Step 1: Thread `onClosePage` from the panel**

In `client/src/modules/ModulePanel.jsx`, in the `<Page … />` render inside `pageContent`, add:

```jsx
                  onClosePage={closePage}
```

- [ ] **Step 2: Accept the prop and render the search + close button**

In `client/src/modules/ModulePage.jsx`, add `onClosePage = null` to the component's props, and add
the import:

```js
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";
```

Then in the header cluster, insert the search immediately **before** the `<HeaderChevron …/>` line
(so it sits left of the filter funnel):

```jsx
              <OccurrenceSearch
                scopeRootId={occurrence?.id || null}
                onPick={(occId) => {
                  const ok = jumpToOccurrence(occId);
                  if (!ok) toast("Found it, but it's hidden by the current filter");
                }}
                title="Search this page"
                placeholder="Search this page…"
              />
```

and add the close button immediately **after** the page-label `<span>` / edit `<input>` block:

```jsx
            {onClosePage && (
              <button
                type="button"
                className="page-header-close-btn"
                title="Close this page"
                aria-label="Close this page"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onClosePage(occurrence.id); }}
              >
                <X size={11} />
              </button>
            )}
```

`X` must be in the `lucide-react` import list, and `toast` from `sonner` — add either if missing.

- [ ] **Step 3: Style the close button**

Append to `client/src/index.css`:

```css
.page-header-close-btn {
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; padding: 2px; border: none; border-radius: 3px;
  background: transparent; color: var(--text-faint); cursor: pointer;
  opacity: 0; transition: opacity 0.12s ease-out;
}
.page-shell:hover .page-header-close-btn { opacity: 1; }
.page-header-close-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.08); }
```

- [ ] **Step 4: Verify**

Run: `cd client && npm run build`
Expected: exit 0.

In the browser: the page header shows the magnifying glass left of the funnel; searching finds only
items on that page and scrolls to them; hovering the header reveals the ×, and clicking it removes
the page from the panel (the panel falls back to another tab).

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModulePage.jsx client/src/modules/ModulePanel.jsx client/src/index.css
git commit -m "feat(search): page-scoped search + close button in the page header"
```

---

### Task 9: De-schedule #1 — drop `computeScheduleColLabel`

`ModuleContainer` string-matches a `"Schedule - "` label prefix to decide whether to recompute a
header from its date filter. Delete it; a seeded operation stamps `occurrence.label` instead.

**Files:**
- Modify: `client/src/modules/ModuleContainer.jsx:46-93` (delete), `:418-421` (simplify)
- Modify: `server/scripts/createLiveData.js` (new op, modelled on the existing
  "Trackers: Date-Prefix Labels" op — search that name in the file)

- [ ] **Step 1: Delete the helper and its constants**

Remove `SCHEDULE_LABEL_PREFIX`, `ISO_DAY_RX`, the whole `computeScheduleColLabel` function, and the
comment block above them (lines 46-53 and 74-93). Remove the now-unused
`import { summarizeSelection } from "../ui/filterSummary";` if nothing else in the file uses it
(check with `grep -n summarizeSelection client/src/modules/ModuleContainer.jsx`).

- [ ] **Step 2: Simplify `displayLabel`**

```js
  const displayLabel = useMemo(
    () => containerOccurrence?.label ?? module.label,
    [containerOccurrence?.label, module.label],
  );
```

- [ ] **Step 3: Add the label-stamping operation to the seed**

In `server/scripts/createLiveData.js`, find the existing `"Trackers: Date-Prefix Labels"` operation
and add a sibling built the same way, named `"Schedule: Date Labels"`, that:
- triggers `onLoad` and `onFilterChange` scoped to the Schedule page (`ancestorLabel` as the
  existing tracker op does),
- loops the day-column containers under the Schedule page,
- writes `$dayCol.label = "Schedule - " + $dayColDateLabel` through the `UPDATE` action's
  `label` path (routed to the `UPDATE_ITEM_LABEL` effect — see `helpers/applyUpdate.js`),
  deriving the date text from the day-column's own date field with `DATE_FORMAT`.

Read `moduleLabel`, never `label`, when composing — reading `label` makes the op re-prefix its own
previous write (the bug fixed on 2026-07-25 in the tracker op).

- [ ] **Step 4: Verify**

```bash
cd client && npm test
cd ../server && npm test
```
Expected: PASS both. Then reseed and confirm day-column headers still show their date:

```bash
cd /home/joshpoms/moduli && node --env-file=.env server/scripts/createLiveData.js
```

- [ ] **Step 5: Commit**

```bash
git add client/src/modules/ModuleContainer.jsx server/scripts/createLiveData.js
git commit -m "refactor: renderer no longer recognizes schedule labels; an op stamps the date"
```

---

### Task 10: De-schedule #2 — remove the weekday rainbow from `PageBoard`

**Files:**
- Modify: `client/src/modules/pages/PageBoard.jsx` (delete `WEEKDAY_RAINBOW`, `weekdayColor`, and
  the `dayColor` / `wrapStyle` branch at ~lines 178-181)

- [ ] **Step 1: Delete the constant and the helper**

Remove the `WEEKDAY_RAINBOW` array and the whole `weekdayColor` function (~lines 39-57).

- [ ] **Step 2: Simplify the child wrapper**

Replace the `dayColor` / `wrapStyle` lines with:

```jsx
          const wrapStyle = childWrapperStyle;
```

- [ ] **Step 3: Verify**

Run: `cd client && npm test && npm run build`
Expected: PASS, exit 0. Board pages render without per-weekday tints.

- [ ] **Step 4: Commit**

```bash
git add client/src/modules/pages/PageBoard.jsx
git commit -m "refactor: board renderer no longer colors children by weekday"
```

---

### Task 11: De-schedule #3 — Pomodoro reads its slot label from the field's own options

`currentSlotLabel()` hardcodes the `"9:00am"` format so the op's FIND can string-match
`meta.slotLabel`. The op does still read `$trigger.slotLabel` (`createLiveData.js:7947` matches it
against the timeslot **field**), so the value is needed — but it must come from that field's
configured options, not a baked format.

**Files:**
- Modify: `client/src/ui/PomodoroTimer.jsx:33-44, 173`
- Test: `client/src/__tests__/pomodoroSlotOption.test.js`

**Interfaces:**
- Produces: `pickTimeOptionForNow(options, now) → string | null` (exported from PomodoroTimer.jsx)

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/pomodoroSlotOption.test.js
import { describe, it, expect } from "vitest";
import { pickTimeOptionForNow } from "../ui/PomodoroTimer.jsx";

const OPTIONS = ["12:00am", "6:00am", "9:00am", "12:00pm", "5:00pm", "11:00pm"];

describe("pickTimeOptionForNow", () => {
  it("picks the latest option at or before now", () => {
    expect(pickTimeOptionForNow(OPTIONS, new Date(2026, 6, 25, 9, 30))).toBe("9:00am");
    expect(pickTimeOptionForNow(OPTIONS, new Date(2026, 6, 25, 17, 5))).toBe("5:00pm");
  });

  it("handles 24-hour option spellings too", () => {
    expect(pickTimeOptionForNow(["09:00", "13:00"], new Date(2026, 6, 25, 14, 0))).toBe("13:00");
  });

  it("returns null when there are no usable options", () => {
    expect(pickTimeOptionForNow([], new Date())).toBeNull();
    expect(pickTimeOptionForNow(["not a time"], new Date())).toBeNull();
  });

  it("returns null when every option is later than now", () => {
    expect(pickTimeOptionForNow(["5:00pm"], new Date(2026, 6, 25, 6, 0))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/pomodoroSlotOption.test.js`
Expected: FAIL — `pickTimeOptionForNow is not a function`.

- [ ] **Step 3: Replace `currentSlotLabel`**

Delete `currentSlotLabel` and its comment block, and add:

```js
// The destination value the Pomodoro: Start op matches against the timeslot
// FIELD. The candidate values are that field's own configured options — this
// component formats nothing and assumes nothing about what the options mean.
export function pickTimeOptionForNow(options, now = new Date()) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  let best = null;
  let bestMinutes = -1;
  for (const opt of options || []) {
    const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(String(opt).trim());
    if (!m) continue;
    let h = Number(m[1]);
    const mins = Number(m[2]);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const total = h * 60 + mins;
    if (total <= minutesNow && total > bestMinutes) { bestMinutes = total; best = String(opt); }
  }
  return best;
}
```

- [ ] **Step 4: Feed it the field's options at the call site**

Inside the component, next to the existing `targetContainerId` lookup:

```js
  const timeslotFieldId = grid?.meta?.scheduleFieldIds?.timeslotFieldId || null;
  const timeslotOptions = useMemo(() => {
    const f = timeslotFieldId ? fieldsById?.[timeslotFieldId] : null;
    const src = f?.meta?._resolvedOptions || f?.meta?.optionsSource?.values || f?.meta?.options || [];
    return src.map(o => (typeof o === "string" ? o : o?.value)).filter(Boolean);
  }, [fieldsById, timeslotFieldId]);
```

Add `fieldsById` to the `useGridActions()` destructure, and `useMemo` to the React import if
missing. Then at line ~173 replace `slotLabel: currentSlotLabel(),` with:

```js
          slotLabel: pickTimeOptionForNow(timeslotOptions),
```

A grid with no configured timeslot field sends `null`, and the op falls through to its target
container — the documented fallback.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/pomodoroSlotOption.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/ui/PomodoroTimer.jsx client/src/__tests__/pomodoroSlotOption.test.js
git commit -m "refactor: pomodoro picks its destination from the timeslot field's own options"
```

---

### Task 12: De-schedule #4 — alarms resolve their destination page by id

`helpers/alarmOps.js:52` finds the destination page with `label IS "Schedule"`. Resolve a seeded id
instead. **The server twin `server/utils/liveSystemBuilders.js makeAlarmOp` must change in
lockstep** — these two builders are documented as twins.

**Files:**
- Modify: `client/src/helpers/alarmOps.js:35-60`
- Modify: `client/src/ui/AlarmDropdown.jsx:84`
- Modify: `server/utils/liveSystemBuilders.js` (`makeAlarmOp`, ~line 2689-2760)
- Modify: `server/scripts/createLiveData.js` (stamp the page id into `grid.meta.scheduleFieldIds`)
- Test: `client/src/__tests__/alarmOps.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `client/src/__tests__/alarmOps.test.js`:

```js
  it("finds the destination page by id, never by the label \"Schedule\"", () => {
    const op = buildAlarmOperation({
      alarm: { type: "alarm", label: "Wake up", time: "06:30" },
      sched: {
        dateFieldId: "f_date",
        timeslotFieldId: "f_slot",
        scheduleFormatFieldId: "f_fmt",
        pageOccurrenceId: "page_abc",
      },
    });
    const json = JSON.stringify(op);
    expect(json).toContain("page_abc");
    expect(json).not.toContain('"Schedule"');
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/alarmOps.test.js`
Expected: FAIL — the built op still contains `"Schedule"`.

- [ ] **Step 3: Change the client builder**

In `client/src/helpers/alarmOps.js`, in `alarmScheduleSteps`, require the page id and replace the
label FIND rule:

```js
  if (!sched || !sched.dateFieldId || !sched.scheduleFormatFieldId
      || !sched.timeslotFieldId || !sched.pageOccurrenceId) return [];
```

and swap the rule

```js
        { id: uid(), left: "label", comparator: "IS", right: "Schedule" },
```

for

```js
        { id: uid(), left: "id", comparator: "IS", right: sched.pageOccurrenceId },
```

- [ ] **Step 4: Mirror it on the server**

Apply the identical change in `server/utils/liveSystemBuilders.js`'s `makeAlarmOp` — same guard,
same rule swap. The two builders must stay byte-equivalent in behavior.

- [ ] **Step 5: Stamp the id in the seed**

In `server/scripts/createLiveData.js`, find where `grid.meta.scheduleFieldIds` is written and add
`pageOccurrenceId: schedPageOccId` (the variable already exists in that scope) to the object. No
client change is needed in `AlarmDropdown.jsx` — it forwards the whole blob.

- [ ] **Step 6: Run both suites**

```bash
cd client && npm test
cd ../server && npm test
```
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add client/src/helpers/alarmOps.js client/src/__tests__/alarmOps.test.js server/utils/liveSystemBuilders.js server/scripts/createLiveData.js
git commit -m "refactor: alarms resolve their destination page by id, not by the name Schedule"
```

---

### Task 13: Make `SET_FILTER` write the filter cascade

`SET_FILTER_NAV` writes only `filterNavState` (the nav widget). The cascade reads
`grid.activeFilterValues`. An op can therefore move the date display without filtering anything.

**Files:**
- Modify: `client/src/state/bindSocketToStore.js:1242-1250`
- Test: `client/src/__tests__/setFilterEffect.test.js`

- [ ] **Step 1: Write the failing test**

```js
// client/src/__tests__/setFilterEffect.test.js
import { describe, it, expect } from "vitest";
import { applySetFilterEffect } from "../state/bindSocketToStore";

describe("applySetFilterEffect", () => {
  const state = { grid: { _id: "g1", activeFilterValues: { f_date: "2026-07-25" } }, filterNavState: {} };

  it("writes both the nav display and the filter cascade value", () => {
    const out = applySetFilterEffect(
      { fieldId: "f_date", value: "2026-07-26" }, state);
    expect(out.navValue).toEqual({ key: "f_date", value: "2026-07-26" });
    expect(out.gridPatch).toEqual({ activeFilterValues: { f_date: "2026-07-26" } });
  });

  it("short-circuits when the value is already set — an onLoad op must not loop", () => {
    const out = applySetFilterEffect(
      { fieldId: "f_date", value: "2026-07-25" },
      { ...state, filterNavState: { f_date: "2026-07-25" } });
    expect(out).toBeNull();
  });

  it("ignores an effect with no target", () => {
    expect(applySetFilterEffect({ value: "2026-07-26" }, state)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/setFilterEffect.test.js`
Expected: FAIL — `applySetFilterEffect is not a function`.

- [ ] **Step 3: Extract the decision and use it**

In `client/src/state/bindSocketToStore.js`, add near the top (module scope, exported):

```js
// Pure decision half of the SET_FILTER effect, so it can be tested without a
// socket. filterNavState drives the nav WIDGET; grid.activeFilterValues drives
// the filter CASCADE (isOccurrenceVisible) — an op must write both or it moves
// the date display without filtering anything.
export function applySetFilterEffect(effect, state) {
  const key = effect?.filterId || effect?.fieldId;
  if (!key) return null;
  const value = effect.value;
  const currentNav = state?.filterNavState?.[key];
  const currentGrid = state?.grid?.activeFilterValues?.[key];
  const gridMatches = currentGrid === value
    || (currentGrid && typeof currentGrid === "object" && currentGrid.value === value);
  if (currentNav === value && gridMatches) return null;   // no-op guard: onLoad ops must not loop
  return {
    navValue: { key, value },
    gridPatch: { activeFilterValues: { ...(state?.grid?.activeFilterValues || {}), [key]: value } },
    gridId: state?.grid?._id || null,
  };
}
```

Replace the body of `case "SET_FILTER":` with:

```js
      case "SET_FILTER": {
        const plan = applySetFilterEffect(effect, state);
        if (!plan) break;
        socketDispatch(setFilterNavAction(plan.navValue.key, plan.navValue.value));
        if (plan.gridId) {
          socketDispatch(updateGridAction({ gridId: plan.gridId, grid: plan.gridPatch }));
          safeEmit(socket, "update_grid", { gridId: plan.gridId, patch: plan.gridPatch });
        }
        break;
      }
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/setFilterEffect.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/state/bindSocketToStore.js client/src/__tests__/setFilterEffect.test.js
git commit -m "fix: SET_FILTER writes grid.activeFilterValues, not just the nav widget"
```

---

### Task 14: "Snap the filter to today on first load of the day" operation

The full_state bootstrap fills `activeFilterValues` only when a value is missing and never
overwrites — so once you navigate, the date is pinned and the grid still shows yesterday tomorrow
morning. This op fixes that without fighting a user who deliberately navigated and reloaded.

**Files:**
- Modify: `server/scripts/createLiveData.js` (marker field + marker occurrence + the op)
- Test: `client/src/__tests__/liveOpsBehavioral.test.js` (extend)

- [ ] **Step 1: Seed the marker**

Add a date field named `"Last Opened Date"` (unique name — verify no collision) and a hidden
instance occurrence carrying it, parented wherever the other system-state occurrences live. Capture
its occurrence id in a variable (e.g. `lastOpenedOccId`) for the op to bind picker-direct.

- [ ] **Step 2: Add the operation**

Name: `"Grid: Snap Filter To Today"`. `triggerTypes: ["onLoad"]`, `priority: 0` (ahead of the
trackers so they aggregate against the right date). Pipeline:

1. `INIT_VAR $marker = $allItemsById.<lastOpenedOccId>`
2. `IF $marker.fields.<lastOpenedFieldId>.value NOT SAME_DAY $today` — comparator `SAME_DAY`
   negated via the group's `not` flag, matching how other ops in this file express it:
   - `SET_FILTER { fieldId: <dateFieldId>, valueExpr: "$today" }`
   - `UPDATE $marker.fields.<lastOpenedFieldId>.value = $today`

- [ ] **Step 3: Write the behavioral test**

Append to `client/src/__tests__/liveOpsBehavioral.test.js`, following the existing harness pattern
in that file (it boots the executor on the exported seed and replays the onLoad sweep):

```js
  it("snaps the grid filter to today when the marker is from an earlier day", () => {
    const marker = findOccurrenceByFieldId(lastOpenedFieldId);
    setFieldValue(marker.id, lastOpenedFieldId, "2020-01-01");
    const effects = runOnLoadSweep();
    const setFilter = effects.find(e => e._effect === "SET_FILTER");
    expect(setFilter).toBeTruthy();
    expect(setFilter.value).toBe(localToday());
  });

  it("does nothing when the marker is already today", () => {
    const marker = findOccurrenceByFieldId(lastOpenedFieldId);
    setFieldValue(marker.id, lastOpenedFieldId, localToday());
    const effects = runOnLoadSweep();
    expect(effects.find(e => e._effect === "SET_FILTER")).toBeUndefined();
  });
```

Use the file's existing helpers for occurrence lookup, field writes and the sweep — do not invent
new ones; read the top of the file first and match its names.

- [ ] **Step 4: Verify**

```bash
cd client && npm test
cd ../server && npm test
cd /home/joshpoms/moduli && node --env-file=.env server/scripts/createLiveData.js
```
Expected: PASS both; reseed succeeds.

Then in the browser: navigate the date away from today, reload — it stays put (same day). Set the
marker occurrence's date back a day by hand and reload — it snaps to today.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/createLiveData.js client/src/__tests__/liveOpsBehavioral.test.js
git commit -m "feat: snap the grid filter to today on the first load of each day"
```

---

### Task 15: Regression guard + final verification

**Files:**
- Create: `client/src/__tests__/noDomainKnowledge.test.js`

- [ ] **Step 1: Write the guard test**

```js
// client/src/__tests__/noDomainKnowledge.test.js
//
// The renderers and helpers must not recognize "a schedule". Seed files author
// that as DATA and are exempt; this guard covers client source only.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const BANNED = [
  /SCHEDULE_LABEL_PREFIX/,
  /computeScheduleColLabel/,
  /WEEKDAY_RAINBOW/,
  /right:\s*["']Schedule["']/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); }
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("no schedule-specific code in client source", () => {
  it("has no banned identifiers", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const rx of BANNED) if (rx.test(text)) offenders.push(`${file} :: ${rx}`);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd client && ./node_modules/.bin/vitest run src/__tests__/noDomainKnowledge.test.js`
Expected: PASS (Tasks 9-12 removed every banned identifier). If it fails, the listed file still
carries one — fix that file, don't weaken the test.

- [ ] **Step 3: Rename the leftover `dayCol` locals**

In `client/src/helpers/dropHandlers.js`, rename the local variables `dayColOcc`,
`copyDayColOcc` and `ccDayColOcc` to `filterAncestorOcc`, `copyFilterAncestorOcc` and
`ccFilterAncestorOcc` — they hold the result of the generic `findFilterOverrideAncestor`.
Behavior-preserving rename; update every reference in the same blocks.

- [ ] **Step 4: Full verification**

```bash
cd client && npm test && npm run build
cd ../server && npm test
```
Expected: all green, build exit 0. Confirm the client chunk sizes look normal (tiptap ~435kB,
highlight ~969kB, CommandCenter ~208kB) — a collapsed chunk means an import was stripped.

- [ ] **Step 5: Commit**

```bash
git add client/src/__tests__/noDomainKnowledge.test.js client/src/helpers/dropHandlers.js
git commit -m "test: guard against schedule-specific code returning; rename dayCol locals"
```

---

## Already done before this plan (no task needed)

- Alarm ring stops instantly on Stop — `helpers/alarmSound.js` gained `stopAlarm()` (ramps each
  live gain to zero over 10ms, then stops the oscillator) and `state/alarmRingStore.js` calls it.
  3 tests in `client/src/__tests__/alarmSound.test.js`.
- Empty-container `+` stays centered — the hidden "Add new item" label was `opacity: 0` but still
  held its width, shoving the `+` off-center and making it jump on hover. Now absolutely
  positioned (`index.css` `.insert-gap-empty-label`).
- Inline instance images 18px → 22px (`index.css` `.instance-media-inline`).
