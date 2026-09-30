// helpers/occurrenceLabel.js
//
// WHAT A ROW IS CALLED. One rule, because five surfaces had it and three of them
// had it backwards.
//
// A MODULE is the type and an OCCURRENCE is the placement, and on this grid the
// heavy boards share ONE module per type: 993 movies point at a single module
// labelled "Movie", 5,484 songs at "Song", plus Album / Artist / Book / Author /
// TV Series / Comic / Game — **12,265 rows across 13 shared modules**. Each
// row's title lives on the occurrence (`occurrence.label`), which is exactly
// what that field is for (2026-09-06: "per-placement label override; the client
// renderer prefers it over module.label").
//
// So a renderer that reads the module first does not show a wrong name
// occasionally — it shows the SAME name for every row of a kind. Reported by the
// user, 2026-09-29: *"for the label of each movie it doesnt have the movie name,
// it just says Movie"*. It was true of the artifact card, the representation
// chip, a table cell embedding a row, and the DELETE CONFIRMATION — which asked
// `Delete "Movie"?` when you were deleting John Wick.
//
// The module label is still the right ANSWER when a placement has no name of its
// own: a container, a page, a one-off upload. It is just the fallback, not the
// first choice.
//
// NOT here: `module.meta.originalName`. That is the file name an upload arrived
// with, it belongs to a module that has exactly one placement, and ArtifactCard
// shows it beside the file's dimensions and size as file metadata. A caller that
// wants it prefers it itself.

/**
 * The name to show for a placement.
 * @param {object} occurrence  the placement (its own label wins)
 * @param {object} module      the type (its label is the fallback)
 * @param {string} [fallback]  when neither has one
 * @returns {string}
 */
export function occurrenceDisplayLabel(occurrence, module, fallback = "") {
  const own = typeof occurrence?.label === "string" ? occurrence.label.trim() : "";
  if (own) return own;
  const type = typeof module?.label === "string" ? module.label.trim() : "";
  if (type) return type;
  return fallback;
}
