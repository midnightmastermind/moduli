// server/migrations/0044-emotions-board.mjs
//
// The Emotions board — the 8-core Emotions Wheel as ordinary occurrences in the
// LIBRARY (user, 2026-08-06: "the feelings circle should pull from a board in
// library of feelings", then "lets call it emotion, not feeling").
//
// SHAPE COPIED FROM AN EXISTING BOARD (Movements), read off the live grid rather
// than invented, so this board works like the other 34:
//
//   page       role:"page"      kind:"board"   parentId = Library folder
//                               filterOverride {}  ← a board is not date-filtered
//     container  role:"container" kind:"board"  carries the boardCategory tag
//       128 option occurrences, parentId = the container
//
// THE HIERARCHY IS FIELDS, NOT NESTING (user: "we can use fields to drive it.
// like what level is what"). Every emotion is a SIBLING occurrence under one
// container — exactly like every other board here — and the wheel's 3 rings live
// in two new fields:
//
//   Emotion Level    select: core | secondary | tertiary
//   Parent Emotion   occurrence → another emotion on this board
//
// So the wheel's structure is editable in the app, and `graphData`'s
// `encoding.parent` builds the rings from it. Nothing about an emotion is known
// to the graph renderer.
//
// DELETES NOTHING. Purely additive: a page, a container, 128 occurrences, two
// fields, and one value appended to the boardCategory option list.
import { flattenEmotionWheel } from "../seed/emotionWheel.js";

export const id = "0044-emotions-board";
export const describe =
  "Add an Emotions board (the 8-core, 120-emotion wheel) to the Library, with Emotion Level and " +
  "Parent Emotion fields carrying the hierarchy. Deletes nothing.";

const TAG = "emotion";
const LEVELS = ["core", "secondary", "tertiary"];

function uuid() {
  return (globalThis.crypto?.randomUUID?.())
    || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Pure: the rows to mint, parent-resolved by LABEL -> planned id. */
export function planEmotionRows(makeId = uuid) {
  const flat = flattenEmotionWheel();
  const idByLabel = new Map();
  for (const f of flat) idByLabel.set(f.label, makeId());
  return flat.map((f) => ({
    occurrenceId: idByLabel.get(f.label),
    label: f.label,
    level: LEVELS[f.depth],
    parentOccurrenceId: f.parent ? idByLabel.get(f.parent) : null,
  }));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Folder, Grid } = models;

  const library = await Folder.findOne({ gridId, name: /^library$/i }).lean();
  if (!library) { log("no Library folder on this grid — refusing to guess a home"); return; }

  const boardCategory = await Field.findOne({ gridId, name: /^board category$/i }).lean();
  if (!boardCategory) { log("no 'Board Category' field — this grid does not use the board pattern"); return; }

  // IDEMPOTENT: an Emotions page already here means this ran.
  const existingPage = await Module.findOne({ gridId, role: "page", label: "Emotions" }).lean();
  if (existingPage) { log("Emotions board already exists — nothing to do"); return; }

  const rows = planEmotionRows();
  log(`Library folder: ${library.id}`);
  log(`will mint ${rows.length} emotions — ` +
      `${rows.filter(r => r.level === "core").length} core, ` +
      `${rows.filter(r => r.level === "secondary").length} secondary, ` +
      `${rows.filter(r => r.level === "tertiary").length} tertiary`);
  log(`sample: ${rows.slice(0, 3).map(r => `${r.label}[${r.level}]`).join(", ")} …`);

  const existingLevel = await Field.findOne({ gridId, name: /^emotion level$/i }).lean();
  const existingParent = await Field.findOne({ gridId, name: /^parent emotion$/i }).lean();
  log(`Emotion Level field : ${existingLevel ? "exists" : "will create"}`);
  log(`Parent Emotion field: ${existingParent ? "exists" : "will create"}`);

  // boardCategory keeps its values in ONE of two places depending on the grid.
  // Appending to the wrong one leaves a stray list on a field whose real options
  // live elsewhere — the trap migration 0005 recorded. Detect, don't assume.
  const usesOptionsSource = Array.isArray(boardCategory.meta?.optionsSource?.values);
  const tagList = usesOptionsSource ? boardCategory.meta.optionsSource.values : (boardCategory.meta?.options || []);
  const hasTag = tagList.some((v) => (typeof v === "string" ? v : v?.value) === TAG);
  log(`boardCategory tag "${TAG}": ${hasTag ? "already present" : "will append"} ` +
      `(list lives in meta.${usesOptionsSource ? "optionsSource.values" : "options"}, ${tagList.length} values)`);

  if (dryRun) { log("dry run — no writes"); return; }

  const grid = await Grid.findOne({ _id: gridId }).lean().catch(() => null);
  const userId = grid?.userId || (await Occurrence.findOne({ gridId }).lean())?.userId;

  const levelFieldId = existingLevel?.id || uuid();
  if (!existingLevel) {
    await Field.create({
      id: levelFieldId, userId, gridId,
      name: "Emotion Level", type: "select", inputEnabled: true,
      meta: { options: LEVELS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    });
  }

  const parentFieldId = existingParent?.id || uuid();
  if (!existingParent) {
    await Field.create({
      id: parentFieldId, userId, gridId,
      name: "Parent Emotion", type: "occurrence", inputEnabled: true,
      meta: {
        optionsSource: {
          mode: "find",
          collection: "$allInstances",
          predicate: { conjunction: "AND", rules: [
            { left: `fields.${boardCategory.id}.value`, comparator: "CONTAINS", right: TAG },
            // Feed copies inherit their source's tag and would double-list.
            { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: null },
          ]},
        },
      },
    });
  }

  if (!hasTag) {
    const next = [...tagList, usesOptionsSource ? TAG : { value: TAG, label: "Emotion" }];
    await Field.updateOne({ gridId, id: boardCategory.id }, {
      $set: usesOptionsSource ? { "meta.optionsSource.values": next } : { "meta.options": next },
    });
  }

  const tagValue = { value: [TAG], flow: "in" };
  const pageModId = uuid(), pageOccId = uuid();
  const contModId = uuid(), contOccId = uuid();

  await Module.create({ id: pageModId, userId, gridId, role: "page", kind: "board", label: "Emotions", meta: {} });
  await Module.create({ id: contModId, userId, gridId, role: "container", kind: "board", label: "Emotions", meta: {} });

  const bindings = [
    { fieldId: levelFieldId, role: "input", order: 0 },
    { fieldId: parentFieldId, role: "input", order: 1 },
    { fieldId: boardCategory.id, role: "input", hidden: true, order: 99 },
  ];

  for (const r of rows) {
    await Module.create({
      id: `m-${r.occurrenceId}`, userId, gridId,
      role: "instance", label: r.label, fieldBindings: bindings, meta: {},
    });
    await Occurrence.create({
      id: r.occurrenceId, userId, gridId, moduleId: `m-${r.occurrenceId}`,
      parentId: contOccId,
      fields: {
        [levelFieldId]: { value: r.level, flow: "replace" },
        [boardCategory.id]: tagValue,
        ...(r.parentOccurrenceId ? { [parentFieldId]: { value: r.parentOccurrenceId, flow: "replace" } } : {}),
      },
      meta: { createdBy: id },
    });
  }

  await Occurrence.create({
    id: contOccId, userId, gridId, moduleId: contModId,
    parentId: null,
    fields: { [boardCategory.id]: tagValue },
    occurrences: rows.map((r) => r.occurrenceId),
    meta: { createdBy: id },
  });
  await Occurrence.create({
    id: pageOccId, userId, gridId, moduleId: pageModId,
    parentId: library.id,
    filterOverride: {},   // a library of options is not a dated log
    fields: {},
    occurrences: [contOccId],
    meta: { createdBy: id },
  });

  log(`minted ${rows.length} emotion occurrence(s) under an Emotions board in the Library`);
  log(`page ${pageOccId} → container ${contOccId}`);
  log(`fields: level=${levelFieldId} parent=${parentFieldId}`);
}
