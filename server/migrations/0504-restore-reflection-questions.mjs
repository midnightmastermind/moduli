// 0504 — the reflection questions come back (user, 2026-11-16: the Daily Question showed no options and no day got a
// question; "yes" to restoring them and to the fill finding its section without a signature).
//
// Measured: between backups 2026-10-18T13-35 and 14-47 the old seeded "Library" container (occ VI5z1eAPtFg5) was
// deleted with its rows — 117 questions, 9 books, 8 movies, 5 podcasts, 4 courses. The questions were HOMED there
// (parentId) and also LISTED by "Reflection Questions" (occ YFfFUfAIhEL3, on the Daily Journal Questions page), which
// is the pool `Day Page: Build Day` picks from and the rows the Daily Question field lists (Library IS "question").
// Only the 117 questions are restored — the rest of the old Library is left deleted (the user's real boards replace
// it). They come back with their original ids, homed and listed by Reflection Questions, in their original order.
//
// And the fill's FIND no longer matches `identitySignature IS "daypage:Daily Question/question"` — something nobody
// can see in the app (user: "no signature search"). It matches the section under the day's column that carries the
// Daily Question field (`_boundFieldIds ARRAY_INCLUDES <Daily Question>`), which is what you see on the page.
import fs from "node:fs";
import path from "node:path";

export const id = "0504-restore-reflection-questions";
export const describe = "Restore the 117 reflection questions (deleted with the old Library on 2026-10-18) into Reflection Questions; the Daily Question fill finds its section by the Daily Question field, not a signature.";
export const touches = ["modules", "occurrences", "operations"];

const BACKUP = process.env.QUESTIONS_BACKUP_DIR
  || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../backups/poms-grid/2026-10-18T13-35-46-824Z_pre-migration-0421-jonah-notes");
const POOL_OCC = "YFfFUfAIhEL3";        // Reflection Questions
const OLD_LIBRARY_OCC = "VI5z1eAPtFg5";
const TAG_FIELD = "a_ktgSH-Vgh9";       // Library
const DQ_FIELD = "Kq-dG1dQ2-89";        // Daily Question
const SIG = "daypage:Daily Question/question";

function load(dir, name) {
  const t = fs.readFileSync(path.join(dir, `${name}.json`), "utf8").trim();
  return t.startsWith("[") ? JSON.parse(t) : t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const asDate = (v) => (v && typeof v === "object" && v.$date ? new Date(v.$date) : (typeof v === "string" ? new Date(v) : v));
const clean = (doc) => { const { _id, __v, ...rest } = doc; for (const k of ["createdAt", "updatedAt"]) if (rest[k]) rest[k] = asDate(rest[k]); return rest; };

/** The question rows of the backup, in the pool's order, and their modules. Pure over the loaded backup. */
export function questionsFromBackup(modules, occurrences) {
  const occ = new Map(occurrences.map((o) => [o.id, o]));
  const mod = new Map(modules.map((m) => [m.id, m]));
  const pool = occ.get(POOL_OCC);
  if (!pool) throw new Error("REFUSING: the backup has no Reflection Questions");
  const rows = (pool.occurrences || []).map((id) => occ.get(id)).filter((o) => o && o.fields?.[TAG_FIELD]?.value === "question");
  return rows.map((o) => ({ occ: o, mod: mod.get(o.moduleId) })).filter((r) => r.mod);
}

/** The pipeline with the signature FIND rule replaced. Pure; returns [pipeline, replaced]. */
export function withoutSignatureFind(pipeline) {
  let replaced = 0;
  const fixRules = (rules) => (rules || []).map((r) => {
    if (r?.left === "identitySignature" && r?.right === SIG) { replaced++; return { ...r, left: "_boundFieldIds", comparator: "ARRAY_INCLUDES", right: DQ_FIELD }; }
    return r?.rules ? { ...r, rules: fixRules(r.rules) } : r;
  });
  const walk = (steps) => (steps || []).map((st) => {
    const out = { ...st };
    if (st?.config?.predicate?.rules) out.config = { ...st.config, predicate: { ...st.config.predicate, rules: fixRules(st.config.predicate.rules) } };
    for (const k of ["then", "else", "body"]) if (Array.isArray(st?.[k])) out[k] = walk(st[k]);
    return out;
  });
  return [{ ...pipeline, steps: walk(pipeline?.steps) }, replaced];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Operation } = models;
  if (!fs.existsSync(BACKUP)) throw new Error(`REFUSING: no backup at ${BACKUP}`);
  const rows = questionsFromBackup(load(BACKUP, "modules"), load(BACKUP, "occurrences"));
  const pool = await Occurrence.findOne({ gridId, id: POOL_OCC }).lean();
  if (!pool) throw new Error("REFUSING: Reflection Questions is not on this grid");
  if (await Occurrence.exists({ gridId, id: OLD_LIBRARY_OCC })) throw new Error("REFUSING: the old Library still exists — nothing was deleted");
  const ids = rows.map((r) => r.occ.id);
  const already = new Set((await Occurrence.find({ gridId, id: { $in: ids } }).select("id").lean()).map((o) => o.id));
  const missing = rows.filter((r) => !already.has(r.occ.id));
  log(`  backup questions: ${rows.length} · already on the grid: ${already.size} · to restore: ${missing.length}`);
  log(`  e.g. "${rows[0]?.mod.label}" · "${rows[1]?.mod.label}"`);

  const op = await Operation.findOne({ gridId, name: "Day Page: Build Day" }).lean();
  const [pipe, replaced] = op ? withoutSignatureFind(op.pipeline) : [null, 0];
  log(`  "Day Page: Build Day": ${replaced} signature FIND rule(s) → the Daily Question field`);
  if (op && replaced !== 1 && !JSON.stringify(op.pipeline).includes(`"right":"${DQ_FIELD}"`)) throw new Error(`REFUSING: expected 1 signature rule, found ${replaced}`);
  if (dryRun) return;

  for (const r of missing) {
    if (!(await Module.exists({ gridId, id: r.mod.id }))) await Module.collection.insertOne({ ...clean(r.mod), gridId });
    await Occurrence.collection.insertOne({ ...clean(r.occ), gridId, parentId: POOL_OCC });
  }
  const list = [...ids, ...(pool.occurrences || []).filter((id) => !ids.includes(id))];
  await Occurrence.updateOne({ gridId, id: POOL_OCC }, { $set: { occurrences: list, updatedAt: new Date() } });
  if (op && replaced) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: pipe, updatedAt: new Date() } });

  const back = await Occurrence.countDocuments({ gridId, id: { $in: ids }, parentId: POOL_OCC });
  const poolNow = await Occurrence.findOne({ gridId, id: POOL_OCC }).lean();
  const tagged = await Occurrence.countDocuments({ gridId, [`fields.${TAG_FIELD}.value`]: "question" });
  log(`  read back: ${back} restored rows homed in Reflection Questions · it lists ${poolNow.occurrences.length} · rows tagged question: ${tagged}`);
  if (back !== rows.length || tagged < rows.length) throw new Error("read-back failed");
  log("  applied. RESTART pm2.");
}
