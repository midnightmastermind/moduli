// server/services/sharePresetSuggest.js
//
// "Movies, appointments, bookmarks… based on where they go" (user, 2026-09-29).
//
// A preset is a SHAPE you can reuse — and until now every one of them had to be
// built by hand in the window and saved. These are the ones the grid already
// implies: one per destination whose rows are a real, typed, populated kind.
//
// DERIVED, NEVER A LIST OF NAMES. Nothing here knows the word "movie". A
// suggestion is a destination's OWN shape (the role, kind and bindings its rows
// carry, read by `destinationSearch.shapeOf`) plus a mapping per bound field
// chosen from that field's name and type. So a grid with a Recipes board gets a
// Recipes preset, and poms' Movies/Bookmarks/People boards get theirs, with no
// migration and nothing to keep in step as boards are added.
//
// SUGGESTED, NOT SAVED. They are computed per request and written nowhere, so
// they follow the grid: rename a board and its preset renames, delete it and
// the preset goes. Using one fills the form exactly as a saved preset does
// (same object shape as the client's `presetFromForm`), and pressing Save is
// what makes a chosen one permanent — at which point it is the user's and this
// stops having an opinion about it.

// A destination with fewer rows than this is a scratch container, not a board
// you file things into — and `commonValues` needs several rows before it can
// say anything about the shape anyway (it refuses under 2).
const MIN_ROWS = 3;

// A preset makes a ROW. So a destination only implies one when the things
// already in it ARE rows — an instance, an artifact, a textblock.
//
// MEASURED ON POMS, which is what made this a rule rather than a taste: the
// first pass offered Songs / Albums / Artists / Bookmarks / Movies / Books …
// and then four **Schedule day columns** ("Schedule - Tuesday, September 8th,
// 2026"), which rank high because a day column holds 49 children. Its children
// are time SLOTS — containers — so filing a clipped movie "into Tuesday" is not
// a thing anyone meant, and each one displaced a real board at the cap.
//
// The discriminator is the shape's ROLE, never its label: a destination whose
// rows are containers or pages is a LAYOUT, and a grid that names its boards
// something else entirely is filtered exactly the same way.
const ROW_ROLES = new Set(["instance", "artifact", "textblock"]);

// How many to offer. The window lists them under the saved ones; past a
// screenful this is a directory rather than a shortcut.
const MAX_SUGGESTIONS = 12;

const name = (f) => String(f?.name || "").toLowerCase();

// ── which clip part belongs in which field ──────────────────────────────────
//
// Ordered: the FIRST rule that matches a field wins, so the specific ones
// (year, date) come before the general ones (title). Each is answered from the
// field's own name and type — the only thing a grid-agnostic rule can read.
//
// `linkUrl` rather than `url`: its reader falls back to the page URL, so it is
// right for a link clip AND a page clip, where `url` is only right for one.
const RULES = [
  // A year is a number the title carries; the transform returns EMPTY on no
  // match, so a film with no year in its title writes nothing rather than its
  // name into a Year field.
  { when: (f) => f.type === "number" && /\byear\b/.test(name(f)),
    map: { source: "title", transform: "year" } },

  // "Date added" / "Saved on" / "Clipped" — when it happened is now.
  { when: (f) => f.type === "date" && /\b(date|added|saved|clipped|logged|created)\b/.test(name(f)),
    map: { source: "today" } },

  // The address. `url`/`link`/`website`/`source`/`address`, any text-ish type.
  { when: (f) => /\b(url|link|website|address|source)\b/.test(name(f)),
    map: { source: "linkUrl" } },

  // The site it came from.
  { when: (f) => /\b(site|domain|host|publisher|channel)\b/.test(name(f)),
    map: { source: "siteName" } },

  // Prose. A selection is what you highlighted; falling back to the page's
  // description would put boilerplate in Notes on every clip that has none.
  { when: (f) => /\b(notes?|description|summary|excerpt|quote|body)\b/.test(name(f)),
    map: { source: "selection" } },

  // The name of the thing. Last, so Year/Date/URL never reach it.
  { when: (f) => /\b(title|name|label)\b/.test(name(f)),
    map: { source: "title", transform: "stripSuffix" } },
];

/** The mapping a bound field gets, or null to leave it unmapped. */
export function mappingForField(field) {
  if (!field) return null;
  const hit = RULES.find((r) => r.when(field));
  return hit ? { ...hit.map } : null;
}

/**
 * @param {object[]} destinations  `searchDestinations` output
 * @param {object[]} fields        the grid's Field docs (id, name, type)
 * @returns {object[]} presets in the client's own preset shape
 */
export function suggestPresets(destinations = [], fields = [], { max = MAX_SUGGESTIONS } = {}) {
  const fieldById = new Map((fields || []).filter((f) => f?.id).map((f) => [f.id, f]));
  const seen = new Set();
  const out = [];

  const usable = (destinations || [])
    .filter((d) => d?.shape && d.shape.kind && (d.childCount || 0) >= MIN_ROWS
      && ROW_ROLES.has(d.shape.role || "instance"))
    // Biggest first: the board you have filed 994 things into is the one you
    // are most likely filing the next thing into.
    .sort((a, b) => (b.childCount || 0) - (a.childCount || 0));

  for (const d of usable) {
    if (out.length >= max) break;
    if (seen.has(d.id)) continue;
    seen.add(d.id);

    const s = d.shape;
    const bindFields = Array.isArray(s.bindFields) ? s.bindFields : [];
    const mappings = {};

    // The values its rows agree on, exactly as the window computes them when
    // you pick the destination by hand — same `autoFields`, same `auto` flag.
    for (const [fieldId, raw] of Object.entries(s.autoFields || {})) {
      mappings[fieldId] = {
        source: "literal",
        value: Array.isArray(raw) ? raw.join(", ") : String(raw),
        raw,
        auto: true,
      };
    }
    // Then a mapping per bound field the rules recognise. An auto value is NOT
    // overwritten: a constant every row already carries beats a guess from a
    // field's name.
    for (const fieldId of bindFields) {
      if (mappings[fieldId]) continue;
      const m = mappingForField(fieldById.get(fieldId));
      if (m) mappings[fieldId] = m;
    }

    out.push({
      id: `suggested:${d.id}`,
      name: d.label,
      suggested: true,
      role: s.role || "instance",
      kind: s.kind || null,
      bindingsLike: s.moduleId || null,
      bindFields,
      // A bookmark IS its address — the executor keys the module on the
      // fileRef, so re-clipping one link reuses its row rather than adding a
      // second. Any other kind has a url field or none.
      fileFrom: s.kind === "bookmark" ? "url" : null,
      destinationId: d.id,
      destinationLabel: d.label,
      mappings,
      labelMapping: { source: "title", transform: "stripSuffix" },
    });
  }
  return out;
}
