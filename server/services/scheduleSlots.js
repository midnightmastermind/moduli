// server/services/scheduleSlots.js
//
// The slot labels a shared calendar event is floored onto (spec D11). They are
// the GRID'S OWN vocabulary, never a constant:
//   1. the static options of the grid's "Time Slot" field (poms: 48 half-hour
//      labels — the same list the Schedule's SLOTS_COVERED places by), else
//   2. the distinct time-shaped labels of the grid's occurrences — the slot
//      rows themselves ("2:00pm"), for a grid whose Time Slot field reads its
//      options from those rows rather than listing them.
// Nothing found → [], and the event keeps `timeSlot: null` with a notice,
// rather than being placed by a guess.
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import { slotLabelToMinutes } from "./slotSnap.js";

const TIME_LABEL = /^\d{1,2}:\d{2}\s*(am|pm)$/i;

export function staticOptionLabels(field) {
  const raw = field?.meta?.optionsSource?.values ?? field?.meta?.options ?? [];
  return (Array.isArray(raw) ? raw : [])
    .map((o) => (typeof o === "string" ? o : (o?.value ?? o?.label)))
    .filter((l) => typeof l === "string" && slotLabelToMinutes(l) != null);
}

export async function scheduleSlotLabels({ userId, gridId }) {
  const fields = await Field.find({ userId, gridId, name: /^time\s*slot$/i }).lean();
  for (const f of fields) {
    const labels = staticOptionLabels(f);
    if (labels.length) return labels;
  }
  const labels = await Occurrence.distinct("label", { userId, gridId, label: TIME_LABEL });
  return (labels || []).filter((l) => TIME_LABEL.test(String(l)));
}
