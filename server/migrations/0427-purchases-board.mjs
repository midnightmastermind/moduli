/**
 * 0427 — one general Purchases board, and Purchase Item picks from it.
 *
 * User 2026-10-23: "we just need a general purchases board to send purchases to (which would be a board
 * occurrence query on the select as well). i think we use board category for it". Answer to the follow-up:
 * a board of the THINGS you buy. Purchase Item queried seven categories at once (grocery, wishlist,
 * ingredient, supplement, equipment, plant, gift) and its "+ Add new" offered seven boards to file into.
 *
 *  - Board Category (and Tags, which mirror a board's category) gain the option `purchase`.
 *  - A Purchases board in Boards/Money, copied from the Charities pair at run time (a page/board in the
 *    folder listing a container/board whose feed is `Board Category CONTAINS <tag>`), so nothing here
 *    restates a folder id or a page shape.
 *  - Purchase Item: `Board Category CONTAINS purchase` (feed copies excluded, as every board select does),
 *    and "+ Add new" files into the new board.
 *  - Items a Purchase Item value names that are BARE rows (only a Board Category — what "+ Add new" mints)
 *    move onto the Purchases board, retagged `purchase`, so the Spend rows keep their picks. Measured on
 *    poms: Uber Ride and Vr supplies, filed onto Wish List by the old "+ Add new". An item with data of
 *    its own (an ingredient with macros) stays where it is. A value naming nothing is cleared.
 *
 * Idempotent: the board is found by its feed condition; the field rewrite compares before writing.
 */
export const id = "0427-purchases-board";
export const describe = "A Purchases board (Board Category 'purchase') in Boards/Money; Purchase Item picks from it and adds to it.";
export const touches = ["occurrences", "modules", "fields"];

const TAG = "purchase";
const LABEL = "Purchases";
const EXEMPLAR = "Charities";

export function purchaseItemSource(prev, bcFieldId, boardOccId) {
  return {
    ...prev,
    mode: "find",
    over: "$allInstances",
    predicate: { operator: "AND", rules: [
      { left: `fields.${bcFieldId}.value`, comparator: "CONTAINS", right: TAG },
      { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
    ] },
    valuePath: prev?.valuePath || "id",
    labelPath: prev?.labelPath || "label",
    addNew: { ...(prev?.addNew || {}), targets: [boardOccId] },
  };
}

const withValue = (values, v) => (values.includes(v) ? values : [...values, v]);

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const oById = new Map(occs.map((o) => [o.id, o]));
  const roleKind = (o) => { const m = mById.get(o.moduleId); return `${m?.role}/${m?.kind}`; };
  const lbl = (o) => o.label || mById.get(o.moduleId)?.label || "";
  const byName = (n) => { const hits = fields.filter((f) => f.name === n); if (hits.length !== 1) throw new Error(`expected one "${n}" field, found ${hits.length}`); return hits[0]; };
  const bc = byName("Board Category"), tags = byName("Tags"), item = byName("Purchase Item");

  // ---- the exemplar pair -----------------------------------------------------
  const exBoard = occs.find((o) => roleKind(o) === "container/board" && lbl(o) === EXEMPLAR && o.feed?.enabled);
  const exPage = exBoard && occs.find((o) => roleKind(o) === "page/board" && (o.occurrences || []).includes(exBoard.id));
  if (!exBoard || !exPage) throw new Error(`REFUSING: no "${EXEMPLAR}" page + board pair to copy`);

  const isPurchaseBoard = (o) => roleKind(o) === "container/board" &&
    (o.feed?.conditions || []).some((c) => c.fieldId === bc.id && c.value === TAG);
  let board = occs.find(isPurchaseBoard);
  const idsOf = (o) => { const v = o.fields?.[item.id]?.value; return Array.isArray(v) ? v : v ? [v] : []; };
  const dangling = occs.filter((o) => { const ids = idsOf(o); return ids.length && ids.every((x) => !oById.has(x)); });
  const picked = [...new Set(occs.flatMap(idsOf))].map((x) => oById.get(x)).filter(Boolean);
  const toMove = picked.filter((o) => !o.meta?.feedSourceId &&
    Object.keys(o.fields || {}).every((k) => k === bc.id || k === tags.id) &&
    !(o.fields?.[bc.id]?.value || []).includes(TAG));

  log(`  exemplar "${EXEMPLAR}": page ${exPage.id} in folder ${exPage.parentId}`);
  log(`  Purchases board: ${board ? `exists (${board.id})` : "will be created"}`);
  log(`  Board Category option "${TAG}": ${bc.meta.optionsSource.values.includes(TAG) ? "present" : "will be added"}; Tags: ${(tags.meta.optionsSource.values || []).includes(TAG) ? "present" : "will be added"}`);
  log(`  bought items to move onto Purchases: ${toMove.length} (${toMove.map(lbl).join(", ")})`);
  log(`  dangling Purchase Item values to clear: ${dangling.length} (${dangling.map(lbl).join(", ")})`);
  if (dryRun) return;

  // ---- options ----------------------------------------------------------------
  await Field.updateOne({ gridId, id: bc.id }, { $set: { "meta.optionsSource.values": withValue(bc.meta.optionsSource.values, TAG) } });
  await Field.updateOne({ gridId, id: tags.id }, { $set: { "meta.optionsSource.values": withValue(tags.meta.optionsSource.values || [], TAG) } });

  // ---- the board ----------------------------------------------------------------
  if (!board) {
    const uid = () => Math.random().toString(36).slice(2, 14);
    const now = new Date();
    const contModId = uid(), contOccId = uid(), pageModId = uid(), pageOccId = uid();
    await Module.create({ ...stripId(mById.get(exBoard.moduleId)), id: contModId, label: LABEL });
    await Occurrence.create({
      id: contOccId, userId: exBoard.userId, gridId, moduleId: contModId, parentId: null,
      occurrences: [], filterOverride: exBoard.filterOverride ?? null, filters: [],
      feed: { ...exBoard.feed, conditions: [{ fieldId: bc.id, comparator: "CONTAINS", value: TAG }] },
      fields: { [bc.id]: { value: [TAG], flow: "in", timestamp: now }, [tags.id]: { value: [TAG], flow: "in" } },
      sortOrder: 0,
    });
    await Module.create({ ...stripId(mById.get(exPage.moduleId)), id: pageModId, label: LABEL });
    const siblings = occs.filter((o) => o.parentId === exPage.parentId && roleKind(o) === "page/board");
    await Occurrence.create({
      id: pageOccId, userId: exPage.userId, gridId, moduleId: pageModId, parentId: exPage.parentId,
      occurrences: [contOccId], filterOverride: exPage.filterOverride ?? {},
      filterNavConfig: exPage.filterNavConfig ?? {}, fields: {},
      sortOrder: Math.max(0, ...siblings.map((o) => o.sortOrder ?? 0)) + 1,
    });
    board = { id: contOccId };
    log(`  created page ${pageOccId} listing board ${contOccId}`);
  }

  // ---- the select ---------------------------------------------------------------
  await Field.updateOne({ gridId, id: item.id }, { $set: { "meta.optionsSource": purchaseItemSource(item.meta.optionsSource, bc.id, board.id) } });
  for (const o of toMove) {
    if (o.parentId) await Occurrence.updateOne({ gridId, id: o.parentId }, { $pull: { occurrences: o.id } });
    await Occurrence.updateMany({ gridId, occurrences: o.id }, { $pull: { occurrences: o.id } });
    await Occurrence.updateOne({ gridId, id: o.id }, { $set: {
      parentId: board.id, [`fields.${bc.id}`]: { value: [TAG], flow: "in", timestamp: new Date() },
      ...(o.fields?.[tags.id] ? { [`fields.${tags.id}`]: { value: [TAG], flow: "in" } } : {}),
    } });
    await Occurrence.updateOne({ gridId, id: board.id, occurrences: { $ne: o.id } }, { $push: { occurrences: o.id } });
  }
  for (const o of dangling) {
    await Occurrence.updateOne({ gridId, id: o.id }, { $unset: { [`fields.${item.id}`]: "" } });
  }

  // ---- read back -----------------------------------------------------------------
  const after = await Field.findOne({ gridId, id: item.id }).lean();
  const pageAfter = await Occurrence.findOne({ gridId, occurrences: board.id }).lean();
  const ok = JSON.stringify(after.meta.optionsSource.predicate).includes(`"right":"${TAG}"`) &&
    after.meta.optionsSource.addNew.targets[0] === board.id && pageAfter?.parentId === exPage.parentId;
  const boardAfter = await Occurrence.findOne({ gridId, id: board.id }).lean();
  if (!toMove.every((o) => boardAfter.occurrences.includes(o.id))) throw new Error("readback: a bought item is not on the Purchases board");
  if (!ok) throw new Error("readback: Purchase Item / Purchases page not as written");
  log("  applied and read back — RESTART pm2.");
}

function stripId(doc) {
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  if (Array.isArray(rest.fieldBindings)) rest.fieldBindings = rest.fieldBindings.map(({ _id: _d, ...b }) => b);
  return rest;
}
