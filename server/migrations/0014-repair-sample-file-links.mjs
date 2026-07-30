// User, 2026-07-30 (asked four times now): the Examples / sample-files page has
// "broken links".
//
// Three of the five sample artifacts were dead — verified by requesting each
// fileRef rather than eyeballing them:
//   404  Earthrise          — thumb path carried a stale hash directory (1/1f → a/a8)
//   404  Pillars of Creation — the file was renamed on Commons (→ Eagle_nebula_pillars.jpg)
//   403  Big Buck Bunny.mp4  — the GCS sample bucket no longer serves it
// Blue Marble and the W3C PDF still answer 200 and are left alone.
//
// Replacements were each checked for a 200 before landing, and the video moved
// to Wikimedia's own transcode so all four externals share one host. The seed
// carries the same list, so a fresh grid gets working links too.
//
// Matched by the DEAD URL, not by label: a label ("Earthrise (Apollo 8).jpg")
// is the user's to rename, and a migration that keys on one silently skips any
// they have renamed. A row already pointing at a good URL is left untouched, so
// this is safe to re-run.

export const id = "0014-repair-sample-file-links";
export const describe =
  "Repoints the three dead sample-file artifacts (Earthrise 404, Pillars of Creation 404, " +
  "Big Buck Bunny 403) at verified-working URLs. Touches only artifacts whose fileRef is one of " +
  "those exact dead URLs; no labels, no other artifacts.";

const REPAIRS = [
  {
    was: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/NASA-Apollo8-Dec24-Earthrise.jpg/1280px-NASA-Apollo8-Dec24-Earthrise.jpg",
    now: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/NASA-Apollo8-Dec24-Earthrise.jpg/1280px-NASA-Apollo8-Dec24-Earthrise.jpg",
    why: "stale hash directory",
  },
  {
    was: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Pillars_2014_HST_WFC3-UVIS_full-res_denoised.jpg/1280px-Pillars_2014_HST_WFC3-UVIS_full-res_denoised.jpg",
    now: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Eagle_nebula_pillars.jpg/1280px-Eagle_nebula_pillars.jpg",
    why: "file renamed on Commons",
  },
  {
    was: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    now: "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.480p.vp9.webm",
    why: "GCS bucket returns 403",
    // The replacement is a webm, so the stored mime has to move with it or the
    // viewer picks its player from a type the bytes aren't.
    mime: "video/webm",
  },
];

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;
  let fixed = 0;

  for (const r of REPAIRS) {
    const mods = await Module.find({ gridId, fileRef: r.was }).select({ id: 1, label: 1 }).lean();
    if (!mods.length) { log(`already repaired (or absent): ${r.why}`); continue; }
    for (const m of mods) {
      log(`  "${m.label}" → ${r.why}; repointing`);
      fixed++;
      if (!dryRun) {
        const set = { fileRef: r.now };
        if (r.mime) set["meta.mimeType"] = r.mime;
        await Module.updateOne({ gridId, id: m.id }, { $set: set });
      }
    }
  }

  log(fixed
    ? `${fixed} artifact(s) ${dryRun ? "would be" : ""} repointed`
    : "no dead sample-file links on this grid");
}
