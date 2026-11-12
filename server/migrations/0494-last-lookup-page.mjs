// 0494 — the last stray "Lookup" page (Bookmarks folder) held one word, "UAPs". User 2026-11-12: move it into the
// organized Lookup's Miscellaneous section, then delete the page and its container. The word becomes a textblock note
// with an annotation quote, built like 0492's.
export const id = "0494-last-lookup-page";
export const describe = "The stray Lookup page's one note (UAPs) moves into Miscellaneous; the page is deleted.";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { annotationText } from "./0492-lookup-annotations.mjs";

const PAGE = "b7d92860-3b74-46ee-8d12-d52eae38f84d";
const CONTAINER = "1abeb148-e0ff-4c22-b4c5-0eee4cbce5b0";
const plain = (n) => !n ? "" : n.type === "text" ? n.text : (n.content || []).map(plain).join("");

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Module, Occurrence } = models;
  const G = String(gridId);
  const page = await Occurrence.findOne({ gridId: G, id: PAGE }).lean();
  const box = await Occurrence.findOne({ gridId: G, id: CONTAINER }).lean();
  if (!page && !box) { log("  already gone"); return {}; }
  if (!page || !box || box.parentId !== PAGE || (box.occurrences || []).length) throw new Error("0494: the stray Lookup page is not in the shape measured");
  const text = plain(decompressTextmap(box.textmap)).trim();
  if (text !== "UAPs") throw new Error(`0494: expected the container to hold "UAPs", found ${JSON.stringify(text)}`);
  const miscMod = await Module.findOne({ gridId: G, label: "Miscellaneous", "meta.fromLookupBoard": true }).lean();
  const misc = miscMod && await Occurrence.findOne({ gridId: G, moduleId: miscMod.id }).lean();
  if (!misc) throw new Error("0494: Miscellaneous (0493) not found");
  log(`  "UAPs" -> Miscellaneous ${misc.id}; delete page ${PAGE} + container ${CONTAINER}`);
  if (dryRun) return {};

  const userId = String((await Grid.findById(gridId).select("userId").lean())?.userId || misc.userId);
  const tbMod = randomUUID(), tbOcc = randomUUID(), qMod = randomUUID(), qOcc = randomUUID();
  const quote = annotationText("Unidentified Anomalous Phenomena: the US government's current name for UFOs, studied by NASA and the Pentagon's AARO office.", ["w:Unidentified anomalous phenomena"]);
  await Module.create({ id: qMod, userId, gridId: G, role: "artifact", kind: "quote", label: quote.replace(/\*\*\[annotation\]\*\* /, "").slice(0, 60),
    fieldBindings: [], meta: { quote, attribution: "", codexAnnotation: "annotation", lookupAnnotation: true } });
  await Occurrence.create({ id: qOcc, userId, gridId: G, moduleId: qMod, parentId: tbOcc, occurrences: [], fields: {}, meta: {} });
  await Module.create({ id: tbMod, userId, gridId: G, role: "textblock", kind: "doc", label: "", fieldBindings: [], meta: {} });
  await Occurrence.create({ id: tbOcc, userId, gridId: G, moduleId: tbMod, parentId: misc.id, occurrences: [qOcc], fields: {}, meta: {},
    textmap: compressTextmap({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "UAPs" }] }, { type: "moduleEmbed", attrs: { occurrenceId: qOcc, align: "full" } }] }) });
  const doc = decompressTextmap(misc.textmap);
  doc.content = [...(doc.content || []), { type: "moduleEmbed", attrs: { occurrenceId: tbOcc } }];
  await Occurrence.updateOne({ gridId: G, id: misc.id }, { $set: { textmap: compressTextmap(doc), updatedAt: new Date() }, $addToSet: { occurrences: tbOcc } });

  await Occurrence.updateMany({ gridId: G, occurrences: { $in: [PAGE, CONTAINER] } }, { $pull: { occurrences: { $in: [PAGE, CONTAINER] } } });
  await Occurrence.deleteMany({ gridId: G, id: { $in: [PAGE, CONTAINER] } });
  for (const m of [page.moduleId, box.moduleId]) if (!(await Occurrence.countDocuments({ gridId: G, moduleId: m }))) await Module.deleteOne({ gridId: G, id: m });
  return {};
}
