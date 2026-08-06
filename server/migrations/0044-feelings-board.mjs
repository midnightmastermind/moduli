// server/migrations/0044-feelings-board.mjs
//
// The Feelings board — the Willcox Feeling Wheel as ordinary occurrences in the
// LIBRARY (user, 2026-08-06: "the feelings circle should pull from a board in
// library of feelings").
//
// SHAPE COPIED FROM AN EXISTING BOARD (Movements), read from the live grid
// rather than invented, so this board works like the other 34:
//
//   page       role:"page"      kind:"board"   parentId = Library folder
//                               filterOverride {}  ← a board is not date-filtered
//     container  role:"container" kind:"board"  carries the boardCategory tag
//       78 option occurrences, parentId = the container
//
// THE HIERARCHY IS FIELDS, NOT NESTING (user: "we can use fields to drive it.
// like what level is what"). Every feeling is a SIBLING occurrence under one
// container — exactly like every other board here — and the wheel's 3 layers
// live in two new fields:
//
//   Feeling Level   select: core | secondary | tertiary
//   Parent Feeling  occurrence → another feeling on this board
//
// So the wheel's structure is editable in the app, and `graphData`'s
// `encoding.parent` builds the rings from it. Nothing about a feeling is known
// to the graph renderer.
//
// DELETES NOTHING. Purely additive: a new page, a new container, 78 new
// occurrences, two new fields, and one new value appended to the boardCategory
// option list.
import { FEELING_WHEEL, flattenFeelingWheel } from "../seed/feelingWheel.js";

export const id = "0044-feelings-board";
export const describe =
  "Add a Feelings board (the 72-feeling Willcox wheel) to the Library, with Feeling Level and " +
  "Parent Feeling fields carrying the hierarchy. Deletes nothing.";

const TAG = "feeling";
const LEVELS = ["core", "secondary", "tertiary"];
const LEVEL_OF = ["core", "secondary", "tertiary"];

function uuid() {
  return (globalThis.crypto?.randomUUID?.())
    || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Pure: the rows to mint, parent-resolved by LABEL → planned id.
 * Exported so the shape is unit-tested without a database.
 */
export function planFeelingRows(makeId = uuid) {
  const flat = flattenFeelingWheel();
  const idByLabel = new Map();
  for (const f of flat) idByLabel.set(f.label, makeId());
  return flat.map((f) => ({
    occurrenceId: idByLabel.get(f.label),
    label: f.label,
    level: LEVEL_OF[f.depth],
    parentOccurrenceId: f.parent ? idByLabel.get(f.parent) : null,
  }));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Folder, Grid } = models;

  // ── Preconditions, all named rather than assumed ────────────────────────
  const library = await Folder.findOne({ gridId, name: /^library$/i }).lean();
  if (!library) { log("no Library folder on this grid — refusing to guess a home"); return; }

  const boardCategory = await Field.findOne({ gridId, name: /^board category$/i }).lean();
  if (!boardCategory) { log("no 'Board Category' field — this grid does not use the board pattern"); return; }

  // IDEMPOTENT: a Feelings page already here means this ran.
  const existingPage = await Module.findOne({ gridId, role: "page", label: "Feelings" }).lean();
  if (existingPage) { log("Feelings board already exists — nothing to do"); return; }

  const rows = planFeelingRows();
  const cores = rows.filter((r) => r.level === "core").length;
  log(`Library folder: ${library.id}`);
  log(`will mint ${rows.length} feelings — ${cores} core, ` +
      `${rows.filter(r => r.level === "secondary").length} secondary, ` +
      `${rows.filter(r => r.level === "tertiary").length} tertiary`);
  log(`sample: ${rows.slice(0, 3).map(r => `${r.label}[${r.level}]`).join(", ")} …`);

  // The two fields the hierarchy lives in.
  const existingLevel = await Field.findOne({ gridId, name: /^feeling level$/i }).lean();
  const existingParent = await Field.findOne({ gridId, name: /^parent feeling$/i }).lean();
  log(`Feeling Level field : ${existingLevel ? "exists" : "will create"}`);
  log(`Parent Feeling field: ${existingParent ? "exists" : "will create"}`);

  // boardCategory stores its values in ONE of two places depending on the grid
  // (manual mode uses meta.optionsSource.values; the seed uses meta.options).
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

  // ── Fields ──────────────────────────────────────────────────────────────
  const levelFieldId = existingLevel?.id || uuid();
  if (!existingLevel) {
    await Field.create({
      id: levelFieldId, userId, gridId,
      name: "Feeling Level", type: "select", inputEnabled: true,
      meta: { options: LEVELS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    });
  }

  const parentFieldId = existingParent?.id || uuid();
  if (!existingParent) {
    await Field.create({
      id: parentFieldId, userId, gridId,
      name: "Parent Feeling", type: "occurrence", inputEnabled: true,
      meta: {
        // Scoped to this board by the same tag every other board dropdown uses,
        // and excluding feed copies (which inherit their source's tag and would
        // otherwise double-list) — the established predicate on this grid.
        optionsSource: {
          mode: "find",
          collection: "$allInstances",
          predicate: { conjunction: "AND", rules: [
            { left: `fields.${boardCategory.id}.value`, comparator: "CONTAINS", right: TAG },
            { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: null },
          ]},
        },
      },
    });
  }

  // ── boardCategory gains the tag ─────────────────────────────────────────
  if (!hasTag) {
    const next = [...tagList, usesOptionsSource ? TAG : { value: TAG, label: "Feeling" }];
    await Field.updateOne({ gridId, id: boardCategory.id }, {
      $set: usesOptionsSource ? { "meta.optionsSource.values": next } : { "meta.options": next },
    });
  }

  // ── The board: page → container → 78 feelings ───────────────────────────
  const tagValue = { value: [TAG], flow: "in" };
  const pageModId = uuid(), pageOccId = uuid();
  const contModId = uuid(), contOccId = uuid();

  await Module.create({ id: pageModId, userId, gridId, role: "page", kind: "board", label: "Feelings", meta: {} });
  await Module.create({ id: contModId, userId, gridId, role: "container", kind: "board", label: "Feelings", meta: {} });

  const bindings = [
    { fieldId: levelFieldId, role: "input", order: 0 },
    { fieldId: parentFieldId, role: "input", order: 1 },
    { fieldId: boardCategory.id, role: "input", hidden: true, order: 99 },
  ];

  let minted = 0;
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
    minted += 1;
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
    // A board is a library of options, not a dated log — it opts out of the
    // date filter exactly as every other board page does.
    filterOverride: {},
    fields: {},
    occurrences: [contOccId],
    meta: { createdBy: id },
  });

  log(`minted ${minted} feeling occurrence(s) under a Feelings board in the Library`);
  log(`page ${pageOccId} → container ${contOccId}`);
  log(`fields: level=${levelFieldId} parent=${parentFieldId}`);
}
