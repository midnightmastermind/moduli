// server/migrations/0393-trackers-grid-state-and-media-board.mjs
//
// Two places poms' Trackers page differs from the rebuild that the UI cannot reach (the user,
// 2026-10-09: "if it doesnt match poms, fix it on poms too" / "keep it visible but fix it on poms"):
//
// 1. The "Last Opened" marker `Grid: Snap Filter To Today` writes is parented to the Trackers page
//    and LISTED BY NOTHING, so it never shows and cannot be dragged anywhere. The rebuild keeps it
//    visible in a "Grid State" board at the bottom of Trackers. This adds that board on poms and
//    lists the marker in it. The op FINDs the marker by its field, not by where it sits.
// 2. Physical › Media is a container with NO kind; Convert offers no "board", so it cannot be made
//    one by clicking. Every other Media container (and the rebuild's) is a board.
// Nothing is deleted.

export const id = "0393-trackers-grid-state-and-media-board";
export const describe = "Trackers: a visible Grid State board holding the Last Opened marker (listed by nothing today); Physical › Media becomes a board. Nothing deleted.";
export const touches = ["modules", "occurrences"];

const uid = () => (globalThis.crypto?.randomUUID?.() || `o-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** PURE. The marker to adopt: an occurrence of the page that binds Last Opened Date and nothing lists. */
export function findMarker({ page, occurrences, modulesById, lastOpenedFieldId }) {
  const listed = new Set(occurrences.flatMap((o) => o.occurrences || []));
  return occurrences.filter((o) => o.parentId === page.id && !listed.has(o.id)
    && (modulesById[o.moduleId]?.fieldBindings || []).some((b) => b.fieldId === lastOpenedFieldId));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Field } = models;
  const mods = await Module.find({ gridId }).lean(); const modulesById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occs = await Occurrence.find({ gridId }).lean(); const byId = Object.fromEntries(occs.map((o) => [o.id, o]));
  const pageMods = new Set(mods.filter((m) => m.role === "page" && m.label === "Trackers").map((m) => m.id));
  const pages = occs.filter((o) => pageMods.has(o.moduleId) && !o.meta?.feedSourceId);
  if (pages.length !== 1) throw new Error(`0393: expected one Trackers page, found ${pages.length}`);
  const page = pages[0];

  // 1. Grid State
  const existing = (page.occurrences || []).map((id) => byId[id]).find((o) => modulesById[o?.moduleId]?.label === "Grid State");
  if (existing) log("Grid State board already on Trackers");
  else {
    const lof = await Field.find({ gridId, name: "Last Opened Date" }).lean();
    if (lof.length !== 1) throw new Error(`0393: expected one Last Opened Date field, found ${lof.length}`);
    const markers = findMarker({ page, occurrences: occs, modulesById, lastOpenedFieldId: lof[0].id });
    if (markers.length !== 1) throw new Error(`0393: expected one unlisted Last Opened marker, found ${markers.length}`);
    const marker = markers[0];
    log(`+ Grid State board at the bottom of Trackers, listing "${modulesById[marker.moduleId]?.label}" (${marker.id})`);
    if (!dryRun) {
      const modId = uid(); const occId = uid();
      await Module.create({ id: modId, userId: page.userId, gridId, role: "container", kind: "board", label: "Grid State", fieldBindings: [] });
      await Occurrence.create({ id: occId, userId: page.userId, gridId, moduleId: modId, parentId: page.id, occurrences: [marker.id], fields: {} });
      await Occurrence.updateOne({ gridId, id: page.id }, { $push: { occurrences: occId } });
      await Occurrence.updateOne({ gridId, id: marker.id }, { $set: { parentId: occId } });
    }
  }

  // 2. Physical › Media
  const physical = occs.filter((o) => modulesById[o.moduleId]?.label === "Physical" && (byId[o.parentId]?.id === page.id || (page.occurrences || []).includes(o.id)));
  const kids = physical.flatMap((p) => (p.occurrences || []).map((id) => byId[id])).filter(Boolean);
  const media = kids.filter((o) => modulesById[o.moduleId]?.label === "Media" && modulesById[o.moduleId]?.role === "container" && !modulesById[o.moduleId]?.kind);
  log(`${media.length} kind-less Physical › Media container(s) -> board`);
  if (!dryRun) for (const o of media) await Module.updateOne({ gridId, id: o.moduleId }, { $set: { kind: "board" } });
  log("done. Restart the server (pm2).");
}
