// helpers/inAppLink.js — what an in-app link chip does when its arrow is pressed.
//
// A chip pointing at an occurrence (a page, a folder page, a row) opens that target's page in the panel the chip sits
// in, then rings it — the same open the search uses (openOccurrenceInPanel). It used to call jumpToOccurrence alone,
// which only finds what is already on screen, so a glossary link to the Schedule did nothing (2026-11-15).
// Outside any panel, or for a target that sits on no page, it falls back to that jump.
import { openOccurrenceInPanel } from "./openOccurrenceInPanel";
import { jumpToOccurrence } from "./jumpToOccurrence";

/** @returns {{ ok: boolean }} */
export function openInAppLink({ targetId, panelOccurrence, maps = {}, dispatch, socket, open = openOccurrenceInPanel, jump = jumpToOccurrence }) {
  if (!targetId) return { ok: false };
  if (panelOccurrence?.id) {
    const res = open({
      occId: targetId, panelOccurrence,
      occurrencesById: maps.occurrencesById || {}, modulesById: maps.modulesById || {}, viewsById: maps.viewsById || {},
      dispatch, socket,
    });
    if (res?.ok) return { ok: true };
  }
  jump(targetId);
  return { ok: false };
}
