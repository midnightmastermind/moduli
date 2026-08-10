// ui/OccurrenceFields.jsx
// ============================================================
// The pill strip for an OCCURRENCE'S OWN fields — container, page, panel,
// textblock, artifact. Instances are deliberately not routed through here
// (see helpers/universalFields).
//
// TWO POSITIONS, AND WHICH ONE IS NOT A STYLE CHOICE:
//   "under"  — beneath the label, for anything with a header to sit under
//              (user 2026-08-10: *"it should go underneath the label"*).
//   "corner" — top-right, for anything with NO heading (user, same day:
//              *"make sure anything without a heading (textblocks) shows up in
//              the top right"*). A textblock's body starts at its first line;
//              there is no label row to go under, so "under the label" would
//              mean "in front of the prose".
//
// HOVER MUST NOT MOVE ANYTHING. `reveal: "hover"` changes OPACITY ONLY, and the
// strip keeps its box either way. This is the 2026-08-01 (17) defect verbatim:
// a hover rule that un-collapsed a trailing line grew the day column +23px per
// nesting level, and because the layout shifted out from under the pointer the
// hover re-fired — 46-64 mutations per three idle seconds, ~20 flips/sec. A
// reveal that reflows is a reveal that oscillates.
//
// And the reveal is CSS, not React state: anything that must be visible while
// the main thread is busy has to be (2026-08-07 (2), where a 150ms JS timer for
// a loading spinner never fired during the load it existed to cover).
// ============================================================
import React, { useMemo } from "react";
import AutoMarquee from "./AutoMarquee";
import FieldRenderer from "./FieldRenderer";
import { resolveOccurrenceFields } from "../helpers/universalFields";
import {
  getEffectiveFieldVisibilityForOccurrence,
  getEffectiveFieldRevealForOccurrence,
} from "../state/selectors";

/**
 * BOTH CASCADES ARE RESOLVED HERE, not at the call sites. Five surfaces mount
 * this; five copies of the ancestor walk is how they stop agreeing (and how
 * `ModuleInstance`'s subtleties — force-show, media exclusion — got out of sync
 * with the container's simpler copy in the first place). A caller may still pass
 * `fieldVisibility` explicitly to override, which is what a table column needs.
 *
 * @param position "under" (has a label to sit beneath) | "corner" (has none)
 */
export default function OccurrenceFields({
  occurrence, module, grid, fieldsById, occurrencesById,
  fieldVisibility = undefined,
  position = "under",
  state, dispatch, socket, className = "",
}) {
  const visibility = useMemo(
    () => (fieldVisibility !== undefined
      ? fieldVisibility
      : getEffectiveFieldVisibilityForOccurrence(occurrence, { occurrencesById })),
    [fieldVisibility, occurrence, occurrencesById],
  );
  const reveal = useMemo(
    () => getEffectiveFieldRevealForOccurrence(occurrence, { occurrencesById }),
    [occurrence, occurrencesById],
  );
  const items = useMemo(
    () => resolveOccurrenceFields({ module, grid, fieldsById, fieldVisibility: visibility }),
    [module, grid, fieldsById, visibility],
  );

  // Render NOTHING when there is nothing to show — an empty strip in the corner
  // is a box that eats clicks meant for the card under it.
  if (!items.length || !occurrence?.id) return null;

  const base = { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", minWidth: 0 };
  const style = position === "corner"
    // ABSOLUTE so the strip never participates in the card's layout: a
    // textblock's prose must not reflow around it, and under `reveal:hover`
    // nothing may move at all. The host sets `position: relative`.
    ? { ...base, position: "absolute", top: 2, right: 4, justifyContent: "flex-end", zIndex: 2, maxWidth: "60%" }
    : { ...base, padding: "0px 12px 4px 28px" };

  return (
    <div
      className={`occurrence-fields occurrence-fields--${position}${reveal === "hover" ? " occurrence-fields--hover" : ""} ${className}`}
      style={style}
      // The pills are inputs; a pointerdown here must not start a drag of the
      // card that owns them. Every sibling field row in this codebase does the
      // same thing for the same reason.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map(({ field, binding }) => (
        <AutoMarquee key={field.id} className="instance-field-mq">
          <FieldRenderer
            field={field}
            binding={binding}
            occurrence={occurrence}
            instance={module}
            state={state}
            dispatch={dispatch}
            socket={socket}
            compact={true}
          />
        </AutoMarquee>
      ))}
    </div>
  );
}
