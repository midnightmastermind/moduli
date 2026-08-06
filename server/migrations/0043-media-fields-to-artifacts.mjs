// server/migrations/0043-media-fields-to-artifacts.mjs
//
// An occurrence's picture stops being a STRING on a field and becomes a real
// ARTIFACT it points at (2026-08-06). After this, a poster can be opened,
// captioned, dragged, replaced from the tree, and can sit beside a PDF — none
// of which a string can do — and `helpers/occurrenceMedia` has something real
// to resolve.
//
//   before   fields[poster].value = "https://…/inception.jpg"
//   after    fields[poster].value = "<artifact occurrence id>"
//            + that id appended to the owner's `Files` field
//
// MEASURED ON poms grid BEFORE WRITING THIS (the whole reason it looks like it
// does):
//   201 modules bind a media-role field · 213 string values · 0 already
//   converted · 11 empty. Every one is an IMAGE — movie posters (placehold.co),
//   book covers (covers.openlibrary.org), avatars (i.pravatar.cc) and
//   image-search results (*.bing.net).
//
// **178 of those 213 have NO recognizable file extension.** The bing/pravatar
// URLs end in an opaque token, so sniffing `kind` from the extension — which is
// what the plan originally called for — would have mis-typed the large majority
// of them. So the rule is inverted: a media-role binding IS the occurrence's
// picture, so the default is `image`, and an extension only OVERRIDES that when
// it is one we actually recognize. Guessing from a token is not sniffing.
//
// WHERE THE NEW ARTIFACTS LIVE: nowhere, deliberately — `parentId: null`. They
// are reached through the `Files` field that references them, which is what
// lets ONE artifact hang off several occurrences. That is safe against
// `sweepOrphans`, which only removes occurrences whose MODULE is missing; these
// have modules. The eventual home is the protected Artifacts folder scoped in
// `2026-08-06-intake-links-and-artifacts.md` — moving them there later is a
// re-parent, not a re-model.
//
// NOTHING IS DELETED. The URL is preserved verbatim as the artifact's
// `fileRef`, so `resolveFileRef` renders exactly the same bytes as before.
export const id = "0043-media-fields-to-artifacts";
export const describe =
  "Convert every media-role field STRING into a real artifact occurrence and point the field at it; " +
  "append each to the owner's Files field. Deletes nothing — the URL is preserved as the artifact's fileRef.";

// Extensions we actually recognize. Anything else keeps the default.
const EXT_KIND = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  pdf: "pdf",
};

/**
 * Pure: what `kind` an artifact minted from this ref should carry.
 * A media-role binding is the occurrence's PICTURE, so `image` is the default
 * and an extension only overrides it when recognized — see the header for why.
 */
export function kindForRef(ref) {
  if (typeof ref !== "string" || !ref) return "image";
  const path = ref.split(/[?#]/)[0];
  const ext = (path.split(".").pop() || "").toLowerCase();
  return EXT_KIND[ext] || "image";
}

/** Pure: absolute URLs are external (no bytes of ours to manage). */
export function isExternalRef(ref) {
  return /^(?:https?:|data:|blob:)/i.test(String(ref || ""));
}

/**
 * Pure planner. Exported so the rules are unit-tested without a database.
 *
 * @returns {{ conversions: Array, skipped: Array }}
 *   conversion = { ownerOccId, ownerModuleId, mediaFieldId, ref, kind, external, label }
 */
export function planMediaConversion({ occurrences = [], modules = [] }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));

  // Which field each module uses for its picture.
  const mediaFieldByModule = new Map();
  for (const m of modules) {
    const b = (m.fieldBindings || []).find((x) => x?.role === "media");
    if (b?.fieldId) mediaFieldByModule.set(m.id, b.fieldId);
  }

  const conversions = [];
  const skipped = [];

  for (const occ of occurrences) {
    const mediaFieldId = mediaFieldByModule.get(occ.moduleId);
    if (!mediaFieldId) continue;

    const raw = occ.fields?.[mediaFieldId];
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.value : raw;
    if (value == null || value === "") continue;
    if (typeof value !== "string") { skipped.push({ occId: occ.id, why: "value is not a string" }); continue; }

    // ALREADY CONVERTED — the value names an occurrence whose module is an
    // artifact. This is what makes a re-run a no-op.
    const target = occById.get(value);
    if (target && modById.get(target.moduleId)?.role === "artifact") {
      skipped.push({ occId: occ.id, why: "already an artifact id" });
      continue;
    }

    const ownerModule = modById.get(occ.moduleId);
    conversions.push({
      ownerOccId: occ.id,
      ownerModuleId: occ.moduleId,
      mediaFieldId,
      ref: value,
      kind: kindForRef(value),
      external: isExternalRef(value),
      // The artifact's own label — the owner's name reads better than a URL.
      label: occ.label || ownerModule?.label || "image",
    });
  }

  return { conversions, skipped };
}

function uuid() {
  return (globalThis.crypto?.randomUUID?.())
    || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Grid } = models;

  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);

  const { conversions, skipped } = planMediaConversion({ occurrences, modules });

  const alreadyDone = skipped.filter((s) => s.why === "already an artifact id").length;
  log(`${conversions.length} media value(s) to convert · ${alreadyDone} already converted · ${skipped.length - alreadyDone} skipped for other reasons`);
  if (conversions.length === 0) { log("nothing to do"); return; }

  const byKind = conversions.reduce((a, c) => ({ ...a, [c.kind]: (a[c.kind] || 0) + 1 }), {});
  log(`kinds: ${JSON.stringify(byKind)} · external: ${conversions.filter((c) => c.external).length}`);
  for (const c of conversions.slice(0, 5)) {
    log(`  · ${String(c.label).slice(0, 30)} → ${String(c.ref).slice(0, 64)}`);
  }

  // The shared Files field — ONE field bound wherever attachments are wanted,
  // the pattern Tags already uses. It does not exist on any grid yet, so the
  // migration is what creates it. Found BY NAME because that is the only handle
  // a fresh grid has; the unique-field-name rule makes that unambiguous.
  const existingFiles = await Field.findOne({ gridId, name: /^files$/i }).lean();
  const filesFieldId = existingFiles?.id || uuid();
  if (existingFiles) log(`Files field exists: ${filesFieldId}`);
  else log(`Files field MISSING — will create ${filesFieldId}`);

  const owners = new Set(conversions.map((c) => c.ownerModuleId));
  log(`${owners.size} module(s) will gain a role:"files" binding`);

  if (dryRun) { log("dry run — no writes"); return; }

  const grid = await Grid.findOne({ _id: gridId }).lean().catch(() => null);
  const userId = grid?.userId || occurrences[0]?.userId;

  if (!existingFiles) {
    await Field.create({
      id: filesFieldId, userId, gridId,
      name: "Files",
      type: "occurrence",
      inputEnabled: true,
      meta: {
        multiSelect: true,
        // Options are every artifact on the grid — attachment is an ordinary
        // occurrence dropdown, which is what buys this feature off machinery
        // already in use (MultiSelectWithAdd / optionsResolver / resolveOccCard).
        optionsSource: {
          mode: "find",
          collection: "$allItems",
          predicate: { conjunction: "AND", rules: [{ left: "role", comparator: "IS", right: "artifact" }] },
        },
      },
    });
    log(`created Files field ${filesFieldId}`);
  }

  let mintedModules = 0, mintedOccs = 0, patchedOwners = 0, boundModules = 0;

  for (const c of conversions) {
    const artModuleId = uuid();
    const artOccId = uuid();

    await Module.create({
      id: artModuleId, userId, gridId,
      role: "artifact",
      kind: c.kind,
      label: c.label,
      fileRef: c.ref,
      defaultDragMode: "copy",
      meta: { external: c.external, convertedBy: id },
    });
    mintedModules += 1;

    await Occurrence.create({
      id: artOccId, userId, gridId,
      moduleId: artModuleId,
      // Reached through the Files field that references it — see the header.
      parentId: null,
      fields: {},
      meta: { convertedBy: id },
    });
    mintedOccs += 1;

    // Point the media field at the artifact, and append it to Files as a SET
    // UNION so a partial re-run cannot duplicate the entry.
    const owner = await Occurrence.findOne({ gridId, id: c.ownerOccId }).lean();
    const prevFiles = owner?.fields?.[filesFieldId]?.value;
    const fileIds = Array.isArray(prevFiles) ? prevFiles.slice() : (typeof prevFiles === "string" && prevFiles ? [prevFiles] : []);
    if (!fileIds.includes(artOccId)) fileIds.push(artOccId);

    await Occurrence.updateOne(
      { gridId, id: c.ownerOccId },
      {
        $set: {
          [`fields.${c.mediaFieldId}`]: { value: artOccId, flow: "replace" },
          [`fields.${filesFieldId}`]: { value: fileIds, flow: "replace" },
        },
      }
    );
    patchedOwners += 1;
  }

  // Bind Files on every owning module so the picks render. Idempotent by
  // construction — the update only runs when the binding is absent.
  for (const moduleId of owners) {
    const mod = await Module.findOne({ gridId, id: moduleId }).lean();
    const bindings = Array.isArray(mod?.fieldBindings) ? mod.fieldBindings : [];
    if (bindings.some((b) => b?.fieldId === filesFieldId)) continue;
    await Module.updateOne(
      { gridId, id: moduleId },
      {
        $set: {
          fieldBindings: [
            ...bindings,
            // HIDDEN on purpose: a Files pill on every row would be noise, and
            // it keeps the field out of the way of trackers that loop
            // occurrence-array fields (a "number of files" total is not a
            // metric anybody asked for).
            { fieldId: filesFieldId, role: "files", hidden: true, order: 98 },
          ],
        },
      }
    );
    boundModules += 1;
  }

  log(`minted ${mintedModules} artifact module(s) + ${mintedOccs} occurrence(s)`);
  log(`patched ${patchedOwners} owner occurrence(s); bound Files on ${boundModules} module(s)`);
}
