// 0221 — Artist and Album boards, and the fields that link a song to them.
//
// User, 2026-08-24: *"add my spotify csv which is in screenshots to my artist,
// album, and song boards"* — and measuring found only ONE of the three exists.
// `Board Category` carries `song` (a Songs board, 5 rows) and has no `artist`
// and no `album`. So the boards are minted first, and `0222` fills them.
//
// ── EVERY SHAPE IS COPIED FROM THE SONGS PAIR AT RUN TIME ─────────────────
//
// A board is not one record. It is a `page/board` occurrence homed in a folder
// that LISTS a `container/board` occurrence carrying a `feed` on its own
// Board Category tag — the container itself has no parentId. Getting that
// wrong is `0158`, which minted a Medications board container nobody listed:
// the data was perfect, every read-back passed, and the board could not be
// opened. So this reads the Songs page/container/module/feed and mirrors it
// rather than restating a shape from memory.
//
// ── ONE SHARED MODULE PER KIND, NOT ONE PER ROW ───────────────────────────
//
// The existing 5 song rows each have their own module, which at 4,400 rows
// would mint 4,400 modules whose only difference is a label. `0218` has just
// finished collapsing 474 such modules onto 99. The resolver settles it:
// `optionsResolver.enrichedRecords` computes
// `label: occ.label ?? tpl?.label ?? tpl?.name`, so an occurrence label WINS
// and a dropdown renders it correctly; `ModuleInstance` prefers it the same
// way. Bindings belong on the module and are identical for every song, which
// is exactly what a shared module is for.
//
// ── THE FEED LIMIT IS RAISED, AND IT IS NOT COSMETIC ──────────────────────
//
// `resolveFeedItems` reads `limit > 0 ? limit : 50`. The Songs feed says 200.
// With 4,051 songs the board would materialise 200 and look complete — the
// same silent truncation that drew a third of the emotions wheel (2026-08-06
// (3)) and was only caught by counting. Raised to cover the real population.

export const id = "0221-artist-and-album-boards";
export const description = "Mint the Artist and Album boards beside Songs, plus the fields linking a song to them";

const SONG_TAG = "song";
export const NEW_TAGS = ["artist", "album"];

/** Board Category options live in one of two places depending on the grid. */
export function readTagOptions(field) {
  const src = field?.meta?.optionsSource;
  if (Array.isArray(src?.values)) return { path: "meta.optionsSource.values", values: src.values };
  if (Array.isArray(field?.meta?.options)) return { path: "meta.options", values: field.meta.options };
  return { path: "meta.optionsSource.values", values: [] };
}

/** Which tags are missing. PURE, so the plan is checkable before any write. */
export function missingTags(existing, wanted = NEW_TAGS) {
  const have = new Set((existing || []).map((v) => (v && typeof v === "object" ? v.value : v)));
  return wanted.filter((t) => !have.has(t));
}

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export async function up({ models, gridId, dryRun, log }) {
  const { Module, Occurrence, Field } = models;
  const gid = String(gridId);

  // ── 1. the exemplar ─────────────────────────────────────────────────────
  const tagField = await Field.findOne({ gridId: gid, name: "Board Category" }).lean();
  if (!tagField) { log("no Board Category field — this grid has no boards"); return { minted: 0 }; }

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = new Map(mods.map((m) => [m.id, m]));
  const tagOf = (o) => {
    const v = o.fields?.[tagField.id]?.value;
    return Array.isArray(v) ? v : v ? [v] : [];
  };

  const songContainer = occs.find((o) => tagOf(o).includes(SONG_TAG) && o.feed?.enabled);
  if (!songContainer) { log("no Songs board container to copy — refusing to invent one"); return { minted: 0 }; }
  const songPage = occs.find((o) => (o.occurrences || []).includes(songContainer.id));
  if (!songPage) { log("the Songs container is listed by nobody — repair that first"); return { minted: 0 }; }
  const songPageMod = modById.get(songPage.moduleId);
  const songContMod = modById.get(songContainer.moduleId);
  log(`exemplar: page "${songPageMod?.label}" (${songPage.id}) in folder ${songPage.parentId}`);
  log(`          container ${songContainer.id}, feed limit ${songContainer.feed?.limit}`);

  // A song ROW, for the bindings a board row carries here.
  const songRow = occs.find((o) => o.parentId === songContainer.id && !o.meta?.feedSourceId)
    || occs.find((o) => (songContainer.occurrences || []).includes(o.id));
  const rowBindings = modById.get(songRow?.moduleId)?.fieldBindings || [];
  log(`          row bindings: ${rowBindings.map((b) => b.fieldId).join(", ") || "(none)"}`);

  // ── 2. the plan ─────────────────────────────────────────────────────────
  const { path: tagPath, values: tagValues } = readTagOptions(tagField);
  const needTags = missingTags(tagValues);
  const existingBoards = NEW_TAGS.filter((t) => occs.some((o) => tagOf(o).includes(t) && o.feed?.enabled));
  const needBoards = NEW_TAGS.filter((t) => !existingBoards.includes(t));
  // `Songs` is MULTI-select and lives on an ALBUM — user, 2026-08-24: *"theres
  // an album with the song in the songs field"*. It is a separate field from the
  // existing single-pick `Song`, which is a "which one song" control elsewhere on
  // the grid; widening that one would change every place it is already used.
  const wantFields = [["Artist", "artist"], ["Album", "album"], ["Songs", "song"]];
  const needFields = [];
  for (const [name, tag] of wantFields) {
    const f = await Field.findOne({ gridId: gid, name, type: "occurrence" }).lean();
    if (!f) needFields.push([name, tag]);
  }

  log(`tags to add    : ${needTags.join(", ") || "(none)"}`);
  log(`boards to mint : ${needBoards.join(", ") || "(none)"}`);
  log(`fields to mint : ${needFields.map((f) => f[0]).join(", ") || "(none)"}`);
  const songFeedLimit = songContainer.feed?.limit || 0;
  const raiseSongs = songFeedLimit > 0 && songFeedLimit < 5000;
  log(`Songs feed limit ${songFeedLimit} -> ${raiseSongs ? 5000 : "(unchanged)"}`);

  if (dryRun) return { tags: needTags.length, boards: needBoards.length, fields: needFields.length };
  if (!needTags.length && !needBoards.length && !needFields.length && !raiseSongs) {
    log("already in place — nothing to do");
    return { tags: 0, boards: 0, fields: 0 };
  }

  // ── 3. tags ─────────────────────────────────────────────────────────────
  if (needTags.length) {
    const objectStyle = tagValues.some((v) => v && typeof v === "object");
    const next = [...tagValues, ...needTags.map((t) => (objectStyle ? { value: t, label: t } : t))];
    await Field.updateOne({ id: tagField.id, gridId: gid }, { $set: { [tagPath]: next } });
  }

  // ── 4. the boards ───────────────────────────────────────────────────────
  const madeBoards = {};
  for (const tag of needBoards) {
    const label = tag === "artist" ? "Artists" : "Albums";
    const pageModId = uid(), pageOccId = uid(), contModId = uid(), contOccId = uid();

    await Module.create({ id: pageModId, userId: songPageMod.userId, gridId: gid,
      label, role: songPageMod.role, kind: songPageMod.kind, fieldBindings: [], meta: { ...(songPageMod.meta || {}) } });
    await Module.create({ id: contModId, userId: songContMod.userId, gridId: gid,
      label, role: songContMod.role, kind: songContMod.kind, fieldBindings: [], meta: { ...(songContMod.meta || {}) } });

    // The CONTAINER carries the tag and the feed; its parentId stays null,
    // exactly as the Songs container's does. The PAGE is what a folder homes
    // and what LISTS it — the pairing `0158` got wrong.
    await Occurrence.create({ id: contOccId, userId: songContainer.userId, gridId: gid,
      moduleId: contModId, parentId: null, occurrences: [],
      fields: { [tagField.id]: { value: [tag], flow: "in" } },
      // ARTIFACT, not instance — and this is a PERFORMANCE decision measured on
      // the real grid, not a taxonomy one. 34 of the 66 enabled operations
      // iterate `$allInstances`, so every row minted as an instance is scanned
      // by all of them on every sweep. Measured on the poms fixture with 8,428
      // music rows added:
      //
      //     role=instance   +5191ms per load sweep
      //     role=artifact   +1196ms                 <- what bookmarks already are
      //
      // The user asked the right question — *"i dont understand how the music
      // one blows up more than the bookmarks and the codex"* — and the answer is
      // exactly this: their 1,467 bookmarks are `artifact/bookmark` and their
      // codex is textblocks, so neither is visible to those 34 ops.
      //
      // It is also honest rather than a dodge: a bookmark is an artifact whose
      // `fileRef` is a URL, and a Spotify row is the same thing pointing at
      // open.spotify.com.
      feed: { enabled: true, conditions: [{ fieldId: tagField.id, comparator: "CONTAINS", value: tag }],
              roles: ["artifact"], sort: null, limit: 5000 },
      meta: {}, filterOverride: {},
    });
    await Occurrence.create({ id: pageOccId, userId: songPage.userId, gridId: gid,
      moduleId: pageModId, parentId: songPage.parentId, occurrences: [contOccId],
      fields: {}, meta: {}, filterOverride: songPage.filterOverride ?? {},
      filterNavConfig: songPage.filterNavConfig ?? {},
    });
    madeBoards[tag] = { pageOccId, contOccId, contModId };
    log(`  minted ${label}: page ${pageOccId} -> container ${contOccId}`);
  }

  // ── 5. the link fields ──────────────────────────────────────────────────
  // Scoped the way every other board dropdown on this grid is: find over
  // `$allInstances` where the row carries the tag AND is not a feed COPY.
  // Without that second rule the dropdown lists each row twice — the copy
  // carries its source's tag (2026-07-25).
  const madeFields = {};
  for (const [name, tag] of needFields) {
    const fid = uid();
    const boardOccId = madeBoards[tag]?.contOccId
      || occs.find((o) => tagOf(o).includes(tag) && o.feed?.enabled)?.id || null;
    await Field.create({
      id: fid, userId: tagField.userId, gridId: gid, name, type: "occurrence",
      inputEnabled: true, displayEnabled: false,
      meta: {
        // An album holds MANY songs; an artist/album link is one.
        multiSelect: name === "Songs",
        optionsSource: {
          // `$allOccurrences`, because the rows these offer are ARTIFACT-role
          // (see the feed above) and `$allInstances` would resolve to nothing —
          // the silent-empty-dropdown class this repo has shipped twice.
          mode: "find", over: "$allOccurrences",
          predicate: { operator: "AND", rules: [
            { id: uid(), left: `fields.${tagField.id}.value`, comparator: "CONTAINS", right: tag },
            { id: uid(), left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
          ]},
          valuePath: "id", labelPath: "label",
          ...(boardOccId ? { addNew: { parentOccurrenceId: boardOccId } } : null),
        },
      },
    });
    madeFields[tag] = fid;
    log(`  minted field ${name} (${fid}) scoped to "${tag}"`);
  }

  // ── 6. the Songs feed stops truncating ──────────────────────────────────
  if (raiseSongs) {
    await Occurrence.updateOne({ id: songContainer.id, gridId: gid }, { $set: { "feed.limit": 5000 } });
  }

  return { tags: needTags.length, boards: needBoards.length, fields: needFields.length,
           boardIds: madeBoards, fieldIds: madeFields };
}
