// Auto-sync for editor↔field bindings.
//
// When the host's selfField value changes (via header/body editor or any
// other write path), propagate the new value to all linked siblings — every
// other occurrence sharing the same link-field value AND already carrying
// the selfField. Loop prevention by skipping siblings whose current value
// already equals nextValue.
//
// Caller responsibility: write to the host first via CommitHelpers, THEN
// call this to fan out. The host write is fast (optimistic), and the sync
// fan-out is fire-and-forget (CommitHelpers handles emit + dispatch).

import * as CommitHelpers from "./CommitHelpers";
import { findLinkedSiblings } from "../state/editorBindings.js";

export function propagateBoundFieldWrite({
  hostOccurrence,
  binding,
  nextValue,
  occurrencesById,
  dispatch,
  socket,
}) {
  if (!binding || !hostOccurrence || !dispatch || !socket) return;
  const siblings = findLinkedSiblings({
    binding,
    hostOccurrence,
    occurrencesById,
    nextValue,
  });
  for (const sib of siblings) {
    CommitHelpers.updateOccurrence({
      dispatch,
      socket,
      occurrence: {
        id: sib.id,
        fields: {
          ...sib.fields,
          [binding.selfField]: {
            ...(sib.fields[binding.selfField] || {}),
            value: nextValue,
          },
        },
      },
      emit: true,
    });
  }
  return siblings;
}
