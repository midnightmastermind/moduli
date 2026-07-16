// helpers/convertOccurrence.js
// ============================================================================
// Seamless occurrence conversion (2026-07-16 plan Part B1).
//
// Convert a CONTAINER occurrence between kinds (doc ↔ board ↔ list ↔ table)
// while preserving its children. `kind` lives on the MODULE; the render path is:
//   - doc   → renders the occurrence's `textmap` (moduleEmbed node per child)
//   - board/list/table → renders the occurrence's `occurrences[]` child list
// A doc container ALSO keeps its children in `occurrences[]` for ancestry
// (importer contract), so converting is a kind flip + a textmap materialize/clear
// — no child occurrences are minted, moved, or lost.
//
// `planContainerKindConversion` is PURE (unit-tested); `convertContainerKind`
// applies the plan through CommitHelpers (the only socket boundary).
// ============================================================================

import { updateModule, updateOccurrence } from "./CommitHelpers";

export const CONVERTIBLE_CONTAINER_KINDS = ["doc", "board", "list", "table"];

const moduleEmbedNode = (occurrenceId) => ({ type: "moduleEmbed", attrs: { occurrenceId } });

/**
 * Pure planner. Returns { modulePatch, occurrencePatch } (occurrencePatch may be
 * null when only the module kind changes), or null for a no-op (same kind /
 * missing inputs).
 */
export function planContainerKindConversion({ occurrence, module, targetKind }) {
  const fromKind = module?.kind;
  if (!module || !targetKind || fromKind === targetKind) return null;
  if (!CONVERTIBLE_CONTAINER_KINDS.includes(targetKind)) return null;

  const childIds = Array.isArray(occurrence?.occurrences) ? occurrence.occurrences : [];
  const modulePatch = { ...module, kind: targetKind };
  let occurrencePatch = null;

  if (targetKind === "doc") {
    // → doc: materialize a textmap that embeds each child in order. TipTap's
    // non-empty-content invariant needs at least one node when there are none.
    occurrencePatch = {
      ...occurrence,
      textmap: {
        type: "doc",
        content: childIds.length ? childIds.map(moduleEmbedNode) : [{ type: "paragraph" }],
      },
    };
  } else if (fromKind === "doc") {
    // doc → board/list/table: children already live in occurrences[]; drop the
    // now-unused doc textmap so it can't render stale embeds.
    occurrencePatch = { ...occurrence, textmap: null };
  }
  // board ↔ list ↔ table (non-doc → non-doc): kind flip only — both render
  // occurrences[]. (table seeds default columns lazily in the renderer.)

  return { modulePatch, occurrencePatch };
}

/**
 * Apply a container kind conversion in place (transform this occurrence's
 * module). Optimistic — routes through CommitHelpers. Returns the plan (or null).
 */
export function convertContainerKind({ dispatch, socket, occurrence, module, targetKind }) {
  const plan = planContainerKindConversion({ occurrence, module, targetKind });
  if (!plan) return null;
  updateModule({ dispatch, socket, module: plan.modulePatch });
  if (plan.occurrencePatch) {
    updateOccurrence({ dispatch, socket, occurrence: plan.occurrencePatch });
  }
  return plan;
}
