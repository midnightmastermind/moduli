// helpers/pasteClipboard.js
//
// Bulk-paste executor for the multi-select clipboard (see
// state/SelectionContext.js). Given a clipboard `{ mode, ids }` and a
// destination occurrence (container or page), replays each id according
// to mode:
//
//   copy     — mint a fresh occurrence with the same moduleId. Fields are
//              deep-copied from the source occurrence. New occurrences are
//              independent (no linkedGroupId).
//   move     — re-parent the existing occurrence. The source's old parent
//              loses it from `occurrences[]`; the destination gains it.
//              The occurrence keeps its identity, fields, and linkedGroupId.
//   copylink — mint a fresh occurrence that shares moduleId AND
//              linkedGroupId with the source. Field/textmap writes
//              propagate across the linked group (server fan-out).
//
// Destination resolution: occurrences[] on a container or page is the
// canonical "what's inside me" list. The helper always reads / writes
// occurrences via CommitHelpers so optimistic dispatches stay consistent.

import * as LayoutHelpers from "./LayoutHelpers";
import * as CommitHelpers from "./CommitHelpers";

// Heuristic: the helper accepts either a container occurrence or a page
// occurrence as destination. Both shapes use `occurrences[]` for ordering;
// the only difference is the module's role.
function buildToContainerShim(destinationOccurrence, destinationModule) {
  return {
    id: destinationModule?.id || destinationOccurrence?.moduleId,
    label: destinationModule?.label || "",
    _occurrence: destinationOccurrence,
  };
}

export function runPasteClipboard({
  mode,
  ids,
  destinationOccurrence,
  destinationModule = null,
  occurrencesById = {},
  dispatch,
  socket,
  gridId,
  userId,
  panelId = null,
  panelLabel = "",
}) {
  if (!mode || !Array.isArray(ids) || ids.length === 0) return { pasted: 0 };
  if (!destinationOccurrence?.id) return { pasted: 0 };

  let pasted = 0;
  const toContainer = buildToContainerShim(destinationOccurrence, destinationModule);

  for (const occId of ids) {
    const src = occurrencesById[occId];
    if (!src) continue;
    if (occId === destinationOccurrence.id) continue;

    if (mode === "copy") {
      const result = LayoutHelpers.copyInstanceToContainer({
        dispatch, socket, gridId,
        sourceInstanceId: src.moduleId,
        toContainer,
        userId,
        sourceOccurrence: src,
        toPanelId: panelId,
        toPanelLabel: panelLabel,
      });
      if (result?.occurrence) pasted += 1;
    } else if (mode === "copylink") {
      const result = LayoutHelpers.copylinkInstanceToContainer({
        dispatch, socket, gridId,
        sourceInstanceId: src.moduleId,
        sourceOccurrenceId: src.id,
        toContainer,
        userId,
        sourceOccurrence: src,
      });
      if (result?.occurrence) pasted += 1;
    } else if (mode === "move") {
      // Find the current parent: any occurrence whose occurrences[] contains
      // this id. Falls back to src.parentId if no parent map entry exists
      // (matches the parentByChildId build pattern used elsewhere).
      let fromOcc = null;
      for (const cand of Object.values(occurrencesById)) {
        if (Array.isArray(cand.occurrences) && cand.occurrences.includes(occId)) {
          fromOcc = cand;
          break;
        }
      }
      if (!fromOcc && src.parentId) fromOcc = occurrencesById[src.parentId] || null;
      if (!fromOcc) continue;
      if (fromOcc.id === destinationOccurrence.id) continue;

      LayoutHelpers.moveInstanceBetweenContainers({
        dispatch, socket,
        fromContainerOccurrence: fromOcc,
        toContainerOccurrence: destinationOccurrence,
        occurrenceId: occId,
      });
      // Keep src.parentId aligned with the new home so downstream ancestor
      // walks (operationExecutor, filter cascade) see the move immediately.
      if (src.parentId !== destinationOccurrence.id) {
        CommitHelpers.updateOccurrence({
          dispatch, socket,
          occurrence: { id: occId, parentId: destinationOccurrence.id },
          emit: true,
        });
      }
      pasted += 1;
    }
  }

  return { pasted };
}
