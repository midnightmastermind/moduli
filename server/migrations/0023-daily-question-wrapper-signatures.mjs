// Follow-on to 0022, and the deeper half of the same bug.
//
// 0022 signed the day-page SECTIONS, which stopped whole sections being cloned.
// But `APPLY_TEMPLATE mode:"merge"` recurses INTO a node it matched — and the
// question container inside Daily Question carried no signature of its own, so
// every single build cloned another one. Today's column had accumulated
// TWENTY-THREE empty question wrappers by the time it was caught; 07-30 was
// gaining one per load even after the section-level repair.
//
// The template is signed in the same commit (`daypage:Daily Question/question`
// + `/answer`), so newly built days are correct. This collapses the wrappers
// that already piled up and signs the survivor on each existing column.
//
// The keeper is the wrapper that still holds its answer textblock; empties are
// removed. As in 0022, nothing containing text is ever deleted.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0023-daily-question-wrapper-signatures";
export const describe =
  "Collapses the duplicate question wrappers inside each Daily Question (merge cloned one per build because " +
  "the wrapper had no identitySignature) and signs the survivor so it stops recurring. Never deletes a " +
  "wrapper containing text.";

const QUESTION_SIG = "daypage:Daily Question/question";
const ANSWER_SIG = "daypage:Daily Question/answer";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  // Every Daily Question section: the columns' AND the template's.
  const dqMods = await Module.find({ gridId, label: "Daily Question", role: "container" }).select({ id: 1 }).lean();
  const dqOccs = await Occurrence.find({ gridId, moduleId: { $in: dqMods.map(m => m.id) } })
    .select({ id: 1, occurrences: 1, textmap: 1, parentId: 1 }).lean();
  if (!dqOccs.length) { log("no Daily Question sections on this grid"); return; }

  const textIn = (o) => {
    const tm = decompressTextmap(o?.textmap) || {};
    return (JSON.stringify(tm.content || []).match(/"text":"[^"]*"/g) || []).length;
  };

  let collapsed = 0, signed = 0, kept = 0;

  for (const dq of dqOccs) {
    const wrappers = [];
    for (const kid of dq.occurrences || []) {
      const o = await Occurrence.findOne({ gridId, id: kid })
        .select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1, identitySignature: 1 }).lean();
      if (!o) continue;
      const m = await Module.findOne({ gridId, id: o.moduleId }).select({ role: 1 }).lean();
      if (m?.role !== "container") continue;
      // How much is really in here: its own text, plus its answer textblock's.
      let text = textIn(o);
      const children = [];
      for (const c of o.occurrences || []) {
        const co = await Occurrence.findOne({ gridId, id: c }).select({ id: 1, textmap: 1 }).lean();
        if (!co) continue;
        children.push(co);
        text += textIn(co);
      }
      wrappers.push({ occ: o, children, text, score: text * 100 + children.length });
    }
    if (!wrappers.length) continue;

    // Keeper: the one with writing, else the one that still has its answer
    // textblock, else the first.
    wrappers.sort((a, b) => b.score - a.score);
    const [keep, ...rest] = wrappers;

    const drop = [];
    for (const r of rest) {
      if (r.text > 0) { log(`  wrapper ${r.occ.id.slice(0, 8)} CONTAINS TEXT — keeping it`); kept++; continue; }
      drop.push(r.occ.id, ...r.children.map(c => c.id));
      collapsed++;
    }

    if (drop.length) {
      log(`  Daily Question ${dq.id.slice(0, 8)}: ${wrappers.length} wrapper(s) → 1 (removing ${drop.length} occurrence(s))`);
      if (!dryRun) {
        const tm = decompressTextmap(dq.textmap) || {};
        const content = (tm.content || []).filter(n => !drop.includes(n?.attrs?.occurrenceId));
        await Occurrence.updateOne({ gridId, id: dq.id }, {
          $set: {
            occurrences: (dq.occurrences || []).filter(k => !drop.includes(k)),
            textmap: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
          },
        });
        await Occurrence.deleteMany({ gridId, id: { $in: drop } });
      }
    }

    if (keep.occ.identitySignature !== QUESTION_SIG) {
      signed++;
      if (!dryRun) await Occurrence.updateOne({ gridId, id: keep.occ.id }, { $set: { identitySignature: QUESTION_SIG } });
    }
    for (const c of keep.children) {
      if (!dryRun) await Occurrence.updateOne({ gridId, id: c.id }, { $set: { identitySignature: ANSWER_SIG } });
    }
  }

  log(`${collapsed} duplicate wrapper(s) removed, ${signed} signed${kept ? `, ${kept} kept (had text)` : ""}`);
}
