// Two things the user reported on 2026-07-31:
//
//   "you got rid of a lot of my trackers like workout log"
//   "make the daypage diff colors that match the theme"
//
// NOTHING was deleted. Workout Log, Reps, the six per-muscle Volume tiles, Meal
// Log and Meal Nutrition are all still in the grid — they had become invisible.
// When the tracker tiles were nested (Workout + Nutrition under Physical, Media
// under Intellectual, Planning under Occupational), the re-parenting landed but
// the flag that lets a container RENDER child containers did not:
// `ModuleContainer` only lists nested containers when the parent module carries
// `meta.allowChildContainers`, and otherwise renders leaf children only. So the
// nested containers — and every tile inside them — dropped off the page while
// the data sat untouched underneath. The Routines dimensions carry the flag,
// which is why the same nesting works there; the seed sets it too, but the seed
// never touches this frozen grid.
//
// Found structurally (any tracker container that HOLDS a container needs the
// flag) rather than from a list of three labels, so it can't drift as more
// tracker groups are nested later.
//
// The day-page columns then take the same nine-dimension vintage palette the
// rest of the grid uses, so each section reads as its own block instead of nine
// identical grey boxes.

export const id = "0021-nested-trackers-visible-and-day-page-colors";
export const describe =
  "Sets meta.allowChildContainers on every Trackers container that holds a nested container — without it " +
  "the renderer hides nested containers, which is why Workout Log / Reps / Volume / Meal tiles vanished " +
  "from the page while remaining in the data. Also colours the day-page sections from the existing " +
  "vintage palette.";

// The grid's own palette (createLiveData DIM_COLORS) — reused rather than
// invented so the day page matches everything else.
const DAY_PAGE_COLORS = {
  "Daily Question": "#4a3b52", // plum
  "Todo":           "#b34f24", // rust
  "Journal":        "#3e8e7e", // teal
  "Notes":          "#6d7434", // avocado
  "Tasks Completed":"#4a8c5c", // green
  "Highlights":     "#e0a63f", // mustard
};

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  // ── 1. the hidden trackers ────────────────────────────────────────────────
  const trkMod = await Module.findOne({ gridId, role: "page", label: "Trackers" }).select({ id: 1 }).lean();
  const trkOcc = trkMod
    ? await Occurrence.findOne({ gridId, moduleId: trkMod.id }).select({ occurrences: 1 }).lean()
    : null;

  let flagged = 0;
  for (const cid of trkOcc?.occurrences || []) {
    const occ = await Occurrence.findOne({ gridId, id: cid }).select({ moduleId: 1, occurrences: 1 }).lean();
    if (!occ) continue;
    const kids = await Occurrence.find({ gridId, id: { $in: occ.occurrences || [] } }).select({ moduleId: 1 }).lean();
    const kidMods = await Module.find({ gridId, id: { $in: kids.map(k => k.moduleId) } })
      .select({ id: 1, role: 1, label: 1 }).lean();
    const nested = kidMods.filter(m => m.role === "container");
    if (!nested.length) continue;

    const mod = await Module.findOne({ gridId, id: occ.moduleId }).select({ id: 1, label: 1, meta: 1 }).lean();
    if (!mod || mod.meta?.allowChildContainers === true) continue;
    log(`  "${mod.label}" holds [${nested.map(n => n.label).join(", ")}] → allowChildContainers`);
    flagged++;
    if (!dryRun) {
      await Module.updateOne({ gridId, id: mod.id }, { $set: { "meta.allowChildContainers": true } });
    }
  }
  log(flagged ? `${flagged} tracker container(s) can render their nested groups again` : "tracker nesting already renderable");

  // ── 2. day-page section colours ───────────────────────────────────────────
  // Every column is built from the same template, so the sections share their
  // module across days — colouring the module colours every day at once.
  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" }).select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ occurrences: 1 }).lean()
    : null;
  const tplMod = await Module.findOne({ gridId, label: "Day Page", role: "container", "meta.templateModule": true })
    .select({ id: 1 }).lean();
  const tplOcc = tplMod ? await Occurrence.findOne({ gridId, moduleId: tplMod.id }).select({ occurrences: 1 }).lean() : null;

  const colIds = [...(boardOcc?.occurrences || []), ...(tplOcc ? [tplOcc.id] : [])];
  const painted = new Set();
  for (const cid of colIds) {
    const col = await Occurrence.findOne({ gridId, id: cid }).select({ occurrences: 1 }).lean();
    for (const kid of col?.occurrences || []) {
      const ko = await Occurrence.findOne({ gridId, id: kid }).select({ moduleId: 1 }).lean();
      if (!ko) continue;
      const km = await Module.findOne({ gridId, id: ko.moduleId }).select({ id: 1, label: 1, ownStyle: 1 }).lean();
      const bg = km && DAY_PAGE_COLORS[km.label];
      if (!bg || painted.has(km.id) || km.ownStyle?.bg === bg) continue;
      painted.add(km.id);
      log(`  "${km.label}" → ${bg}`);
      if (!dryRun) {
        // Whole-object write: these modules carry `ownStyle: null`, and a dotted
        // "ownStyle.bg" $set cannot create a field inside a null.
        await Module.updateOne({ gridId, id: km.id },
          { $set: { styleMode: "own", ownStyle: { ...(km.ownStyle || {}), bg } } });
      }
    }
  }
  log(`${painted.size} day-page section(s) coloured`);
}
