// server/migrations/0116-sweep-stranded-textblocks.mjs
//
// From the 2026-08-13 audit: 18 textblock occurrences sit in Notes and Journal
// docs holding `fwefefifeuife`, `trhthw`, `9865['0`, `.yl` and single letters —
// test typing stranded by the click-to-mint / backspace-delete work. Their
// parent no longer lists them and no body embeds them, so they are invisible on
// screen and invisible to `sweepOrphans`, which REFUSES them (correctly, by its
// own conservative predicate) because they hold a character or two.
//
// REACHABILITY IS CHECKED THREE WAYS, and that is the whole safety of this file.
// The 2026-08-07 (8) lesson was paid for by a wrong answer to exactly this
// question: an occurrence can be reached by its parent's `occurrences[]`, by a
// TEXTMAP embed, **or by a FIELD VALUE** — and a scan that knows about two of
// the three will confidently call a live row dead. All three are checked here,
// and the field-value pass runs over every occurrence's every field.
//
// A CONTROL PROVES THE SCAN WORKS. Before deleting anything it counts how many
// LIVE occurrences each reachability test finds. A test that returns zero for
// everything is not evidence of unreachability, it is a broken probe — so the
// migration REFUSES to delete if any of the three finds nothing at all.
//
// DUMPED BEFORE DELETING, raw, the way `sweepOrphans` does — a restore has to be
// byte-for-byte what was removed.
//
// Deliberately scoped to `role: "textblock"` with NO children. This is not a
// general orphan sweep; that is `sweepOrphans`' job and its refusals are there
// for good reasons.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0116-sweep-stranded-textblocks";
export const describe =
  "Delete invisible textblock occurrences no parent lists, no body embeds and no field names.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";

  // --- the three ways a thing can be reached -------------------------------
  const listed = new Set();
  for (const o of occs) for (const c of o.occurrences || []) listed.add(c);

  const embedded = new Set();
  for (const o of occs) {
    if (!o.textmap) continue;
    let tm = o.textmap;
    try { if (typeof tm === "string") tm = decompressTextmap(tm); } catch { continue; }
    const s = JSON.stringify(tm || "");
    for (const m of s.matchAll(/"(?:occurrenceId|moduleId|id)":"([^"]+)"/g)) embedded.add(m[1]);
  }

  const valued = new Set();
  for (const o of occs) {
    for (const v of Object.values(o.fields || {})) {
      const raw = v?.value;
      for (const x of (Array.isArray(raw) ? raw : [raw])) {
        if (typeof x === "string" && x) valued.add(x);
      }
    }
  }

  // CONTROL: each test must find real, live rows, or the test itself is broken.
  const control = {
    listed: occs.filter((o) => listed.has(o.id)).length,
    embedded: occs.filter((o) => embedded.has(o.id)).length,
    valued: occs.filter((o) => valued.has(o.id)).length,
  };
  log(`control — reachable by: parent list ${control.listed} · textmap ${control.embedded} · field value ${control.valued}`);
  if (!control.listed || !control.embedded || !control.valued) {
    log(`REFUSING: a reachability test found nothing at all — that is a broken probe, not an empty set.`);
    return;
  }

  const textOf = (o) => {
    let tm = o.textmap;
    if (!tm) return "";
    try { if (typeof tm === "string") tm = decompressTextmap(tm); } catch { return "<undecodable>"; }
    return (JSON.stringify(tm).match(/"text":"([^"]*)"/g) || [])
      .map((s) => s.slice(8, -1)).join(" ").trim();
  };

  const doomed = [];
  for (const o of occs) {
    if (modById.get(o.moduleId)?.role !== "textblock") continue;
    if ((o.occurrences || []).length) continue;          // has children — never
    if (listed.has(o.id) || embedded.has(o.id) || valued.has(o.id)) continue;
    // An undecodable body is not a body we can judge — leave it.
    const t = textOf(o);
    if (t === "<undecodable>") { log(`  KEEPING ${o.id} — its body could not be decoded`); continue; }
    doomed.push({ o, text: t, parent: nameOf(byId.get(o.parentId)) });
  }

  for (const d of doomed) log(`  - ${d.o.id.slice(0, 8)} in ${String(d.parent).padEnd(9)} ${d.text.length.toString().padStart(3)} chars  "${d.text.slice(0, 40)}"`);
  const chars = doomed.reduce((a, d) => a + d.text.length, 0);
  log(`${doomed.length} stranded textblock(s), ${chars} character(s) total`);
  if (!doomed.length) { log(`nothing stranded.`); return; }
  if (dryRun) { log(`WOULD delete ${doomed.length}. Re-read the text above before applying.`); return; }

  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backups", "orphans");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-stranded-textblocks.json`);
  // RAW documents — textmap still compressed, exactly as stored.
  const raw = await Occurrence.find({ gridId, id: { $in: doomed.map((d) => d.o.id) } }).lean();
  writeFileSync(file, JSON.stringify(raw, null, 2));
  log(`dumped ${raw.length} document(s) -> ${file}`);

  await Occurrence.deleteMany({ gridId, id: { $in: doomed.map((d) => d.o.id) } });
  log(`deleted ${doomed.length} stranded textblock(s).`);
}
