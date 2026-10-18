// 0421 — Jonah's notes: a "Jonah" folder at the root holding three doc pages
// (About you · How Moduli works · Remembered) that Jonah reads with the
// jonah_notes tool and appends to with jonah_remember (services/jonahNotes.js).
//
// User, 2026-10-18: notes Jonah looks up only when he needs them, including how
// Moduli works. They are the user's to edit, so a note that already exists
// (found by identitySignature, not label) is NEVER rewritten — a re-run only
// creates what is missing.

import { compressTextmap } from "../utils/textmapCompression.js";
import { markdownToReaderDoc } from "../services/markdownImporter.js";
import {
  JONAH_FOLDER_NAME, NOTE_SIGNATURES, NOTE_TITLES, ABOUT_MD, MODULI_MD, MEMORY_MD,
} from "../services/jonahNotes.js";

export const id = "0421-jonah-notes";
export const describe = "Jonah folder + three note pages (About you, How Moduli works, Remembered); creates only what is missing.";
export const touches = ["folders", "modules", "occurrences"];

const uid = () => (globalThis.crypto?.randomUUID?.() || `o-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const NOTE_MD = { about: ABOUT_MD, moduli: MODULI_MD, memory: MEMORY_MD };

// The TipTap doc a note page starts with (its leading H1 is the page label).
export function noteDoc(md) {
  const { content } = markdownToReaderDoc(md);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Manifest, Folder, Module, Occurrence } = models;
  const manifest = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!manifest?.rootFolderId) throw new Error(`0421: grid ${gridId} has no user manifest root`);
  const userId = manifest.userId;

  let folder = await Folder.findOne({ gridId, userId, parentId: manifest.rootFolderId, name: JONAH_FOLDER_NAME }).lean();
  if (!folder) {
    log(`+ folder "${JONAH_FOLDER_NAME}" at the root`);
    folder = { id: uid() };
    if (!dryRun) await Folder.create({ id: folder.id, userId, gridId, parentId: manifest.rootFolderId,
      name: JONAH_FOLDER_NAME, folderType: "normal", sortOrder: 60 });
  } else log(`folder "${JONAH_FOLDER_NAME}" exists (${folder.id})`);

  for (const [i, which] of ["about", "moduli", "memory"].entries()) {
    const sig = NOTE_SIGNATURES[which];
    const have = await Occurrence.findOne({ gridId, identitySignature: sig }).lean();
    if (have) { log(`note "${NOTE_TITLES[which]}" exists (${have.id}) — left as the user has it`); continue; }
    const doc = noteDoc(NOTE_MD[which]);
    log(`+ note page "${NOTE_TITLES[which]}" (${JSON.stringify(doc).length} chars)`);
    if (dryRun) continue;
    const modId = uid();
    await Module.create({ id: modId, userId, gridId, role: "page", kind: "doc", label: NOTE_TITLES[which], fieldBindings: [] });
    await Occurrence.create({ id: uid(), userId, gridId, moduleId: modId, parentId: folder.id, occurrences: [],
      fields: {}, filterOverride: {}, filterNavConfig: { filter_daily: { visible: false } }, sortOrder: i,
      identitySignature: sig, textmap: compressTextmap(doc) });
  }

  if (!dryRun) {
    const n = await Occurrence.countDocuments({ gridId, identitySignature: { $in: Object.values(NOTE_SIGNATURES) } });
    if (n !== 3) throw new Error(`0421: expected 3 note pages after the write, found ${n}`);
  }
  log(dryRun ? "DRY RUN — nothing written" : "applied");
}
