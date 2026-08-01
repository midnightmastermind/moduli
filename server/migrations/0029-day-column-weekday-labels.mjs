// User, 2026-08-01: "put the day of the week in too for the daypage header —
// the containers".
//
// Columns go from "2026-07-31" to "Friday, July 31st, 2026". The op that mints
// tomorrow's is switched to the `dateLong:` token in the same commit — the same
// one the Schedule's day-columns already use, so both surfaces name a day
// identically — and this renames the ones that already exist to match.
//
// The rename is by DATE, not by parsing the old label's prose: every column
// carries its date in the Date field, which is what the build op keys on. A
// column whose label the user has since renamed by hand is left alone.

export const id = "0029-day-column-weekday-labels";
export const describe =
  'Renames each day column from "2026-07-31" to "Friday, July 31st, 2026" (weekday first) and switches ' +
  "the Build op to the dateLong: token so new days are named the same way.";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Mirrors resolveExpr's `dateLong:` formatter exactly. */
function dateLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long" });
  const month = dt.toLocaleDateString("en-US", { month: "long" });
  const n = dt.getDate(), j = n % 10, k = n % 100;
  const sfx = (k >= 11 && k <= 13) ? "th" : j === 1 ? "st" : j === 2 ? "nd" : j === 3 ? "rd" : "th";
  return `${weekday}, ${month} ${n}${sfx}, ${dt.getFullYear()}`;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Operation } = models;

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ occurrences: 1 }).lean()
    : null;
  if (!boardOcc) { log("no Day Page board on this grid"); return; }

  let renamed = 0, skipped = 0;
  for (const cid of boardOcc.occurrences || []) {
    const col = await Occurrence.findOne({ gridId, id: cid }).select({ moduleId: 1 }).lean();
    const mod = col && await Module.findOne({ gridId, id: col.moduleId }).select({ id: 1, label: 1 }).lean();
    if (!mod) continue;
    if (!ISO.test((mod.label || "").trim())) {
      log(`  "${mod.label}" is not a bare date — left as the user named it`);
      skipped++;
      continue;
    }
    const next = dateLong(mod.label.trim());
    log(`  "${mod.label}" → "${next}"`);
    renamed++;
    if (!dryRun) await Module.updateOne({ gridId, id: mod.id }, { $set: { label: next } });
  }
  log(`${renamed} renamed${skipped ? `, ${skipped} left alone` : ""}`);

  for (const op of await Operation.find({ gridId, name: /^Day Page: Build/ }).lean()) {
    const json = JSON.stringify(op.pipeline || {});
    if (!json.includes('"rootLabel":"${$day}"')) continue;
    const next = JSON.parse(json.split('"rootLabel":"${$day}"').join('"rootLabel":"${dateLong:$day}"'));
    log(`  "${op.name}": rootLabel → "\${dateLong:$day}"`);
    if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next } });
  }
}
