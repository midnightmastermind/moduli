// 0474 — drill down and up between boards with buttons (user, 2026-10-31: "a button … on all board occurrences that
// have extra children (meals to ingredients, tv shows to episodes, authors to books, artist to albums to songs) … the
// pertaining board with a filter applied … and then the opposite way" · "skippable ones too … albums and another one
// saying songs" · "this stuff shouldnt be hard coded, it should be an operation").
//
// All data, no app code: one BUTTON FIELD per destination board, bound on every kind of row that can go there, and
// one OPERATION listening to it. The operation reads the pressed row's Board Category and sets the destination
// board's local filter (the field the child rows carry), then switches the panel to that board's page. An up (◀)
// button clears the filters on the way out; ◀ Albums on a song shows that song's artist's albums. Pressed on a
// board's header (no row category), a ◀ button just clears and goes.
//   artist: Albums · Songs      album: Songs · ◀ Artists      song: ◀ Albums · ◀ Artists
//   author: Books               book: ◀ Authors
//   meal: Ingredients           ingredient: ◀ Meals
//   show: Seasons · Episodes    season: Episodes · ◀ TV Series    episode: ◀ Seasons · ◀ TV Series
// The music buttons and their four operations already existed (Music: Show Albums / Show Songs / Back to Albums /
// Back to Artists) — they are rewritten here into this shape, so the field ids, names and ops are kept.
// Meals name their ingredients, not the other way round, and a board filter can only match a field its own rows
// carry. So ingredients get a hidden list field "In Meals", filled from every meal now and kept by the operation
// "Meals: Link Ingredients" (a meal's Ingredient list changes -> each ingredient's In Meals follows).
import { randomUUID } from "node:crypto";

export const id = "0474-board-drill-buttons";
export const describe = "Buttons that drill between boards (artist↔album↔song, author↔book, show↔episode, meal↔ingredient), each an operation that filters the destination board and opens it; ingredients get an In Meals link kept by an operation.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const BC = "uew6sn6WWXin", ARTIST = "8wotshpcdlog", ALBUM = "9i0yaflshggo", AUTHOR = "d5nhkf8nvkw4", MEAL_INGREDIENT = "Ingredient";
export const BOARDS = {
  artists: { cont: "z0uq2xk0cs1h", page: "y9v2e9b50sf0", cat: "artist" },
  albums: { cont: "9u204s73cxy8", page: "fikhfl7ec8p0", cat: "album" },
  songs: { cont: "omK6EzlhYDoQ", page: "rWtZZdAV3dVH", cat: "song" },
  authors: { cont: "1mrwt3hindvx", page: "lgfpsotahwyt", cat: "bookAuthor" },
  books: { cont: "j0rmo0vsqbhq", page: "wayib4gtin3y", cat: "book" },
  shows: { cont: "4l9lpinrjgxp", page: "oo0m7u1ep4qp", cat: "series" },
  seasons: { cont: null, page: null, cat: "season" },     // read off the board (0473)
  episodes: { cont: null, page: null, cat: "episode" },   // read off the board (0472)
  meals: { cont: "VPp0e_uWoGjw", page: "rmIorYtmj7Ea", cat: "meal" },
  ingredients: { cont: "0JBLJFaWRmAc", page: "q-NGD-d-IYz4", cat: "ingredient" },
};

/**
 * The drills. `clear` = filters emptied on every press; `when` = per pressed-row category, filters set
 * ("row" = the pressed row, or a field of the pressed row). `field`: an existing button field id, or a new one's name.
 */
export const drills = (f) => [
  { field: "3e98a62f-5b71-44ae-ac7e-c3788a98c601", op: "Music: Show Albums", to: "albums", on: ["artist"],
    when: { artist: [["albums", ARTIST, "row"]] } },
  { field: "a239a06a-25e8-4b97-ab1a-4876e118c6e3", op: "Music: Show Songs", to: "songs", on: ["artist", "album"],
    clear: [["songs", ARTIST], ["songs", ALBUM]],
    when: { artist: [["songs", ARTIST, "row"]], album: [["songs", ALBUM, "row"]] } },
  { field: "fdc3311f-a682-439a-af7e-94d20c819632", op: "Music: Back to Albums", to: "albums", on: ["song"], headers: ["songs"],
    clear: [["songs", ARTIST], ["songs", ALBUM]],
    when: { song: [["albums", ARTIST, `field:${ARTIST}`]] } },
  { field: "4011fc61-bb7e-47d7-9be7-0d877d72e98a", op: "Music: Back to Artists", to: "artists", on: ["album", "song"], headers: ["albums"],
    clear: [["albums", ARTIST], ["songs", ARTIST], ["songs", ALBUM]] },
  { field: { name: "Open Books", label: "Books" }, op: "Books: Show Books", to: "books", on: ["bookAuthor"],
    when: { bookAuthor: [["books", AUTHOR, "row"]] } },
  { field: { name: "◀ Authors", label: "◀ Authors" }, op: "Books: Back to Authors", to: "authors", on: ["book"], headers: ["books"],
    clear: [["books", AUTHOR]] },
  { field: { name: "Open Seasons", label: "Seasons" }, op: "TV: Show Seasons", to: "seasons", on: ["series"],
    when: { series: [["seasons", f.show, "row"]] } },
  { field: { name: "Open Episodes", label: "Episodes" }, op: "TV: Show Episodes", to: "episodes", on: ["series", "season"],
    clear: [["episodes", f.show], ["episodes", f.season]],
    when: { series: [["episodes", f.show, "row"]], season: [["episodes", f.season, "row"]] } },
  { field: { name: "◀ Seasons", label: "◀ Seasons" }, op: "TV: Back to Seasons", to: "seasons", on: ["episode"], headers: ["episodes"],
    clear: [["episodes", f.show], ["episodes", f.season]],
    when: { episode: [["seasons", f.show, `field:${f.show}`]] } },
  { field: { name: "◀ TV Series", label: "◀ TV Series" }, op: "TV: Back to Shows", to: "shows", on: ["season", "episode"], headers: ["seasons", "episodes"],
    clear: [["seasons", f.show], ["episodes", f.show], ["episodes", f.season]] },
  { field: { name: "Open Ingredients", label: "Ingredients" }, op: "Meals: Show Ingredients", to: "ingredients", on: ["meal"],
    when: { meal: [["ingredients", f.inMeals, "row"]] } },
  { field: { name: "◀ Meals", label: "◀ Meals" }, op: "Meals: Back to Meals", to: "meals", on: ["ingredient"], headers: ["ingredients"],
    clear: [["ingredients", f.inMeals]] },
];

const step = (config) => ({ id: randomUUID(), type: "action", config });
const ifStep = (rules, then) => ({ id: randomUUID(), type: "if", condition: { operator: "AND", rules: rules.map((r) => ({ id: randomUUID(), ...r })) }, then, else: [] });

/** One drill's pipeline. Pure. */
export function drillPipeline(d, boards) {
  const used = new Set([...(d.clear || []).map(([b]) => b), ...Object.values(d.when || {}).flat().map(([b]) => b)]);
  const v = (b) => `$${b}Board`;
  const value = (src) => (src === "row" ? "$trigger.occurrenceId" : `$row.fields.${src.slice(6)}.value`);
  const steps = [step({ type: "INIT_VAR", name: "$row", expr: "$allItemsById.${$trigger.occurrenceId}" })];
  for (const b of used) steps.push(step({ type: "INIT_VAR", name: v(b), expr: `$allItemsById.${boards[b].cont}` }));
  for (const [b, fid] of d.clear || []) steps.push(step({ type: "UPDATE", path: `${v(b)}.filterOverride.${fid}`, value: null }));
  for (const [cat, sets] of Object.entries(d.when || {})) {
    // A field-sourced set needs the value there: a board's header carries its category too, and has no artist.
    const need = sets.filter(([, , src]) => src !== "row").map(([, , src]) => ({ left: `$row.fields.${src.slice(6)}.value`, comparator: "IS_NOT_EMPTY", right: "" }));
    steps.push(ifStep([{ left: `$row.fields.${BC}.value`, comparator: "CONTAINS", right: cat }, ...need],
      sets.map(([b, fid, src]) => step({ type: "UPDATE", path: `${v(b)}.filterOverride.${fid}`, value: value(src) }))));
  }
  steps.push(step({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: boards[d.to].page }));
  return { sources: [], steps };
}

/** "Meals: Link Ingredients": a meal's Ingredient list -> each ingredient's In Meals (added or removed). Pure. */
export function linkIngredientsPipeline(ingredientFieldId, inMealsId) {
  const inMeal = { left: `$meal.fields.${ingredientFieldId}.value`, comparator: "ARRAY_INCLUDES", right: "$ing.id" };
  const listed = { left: `$ing.fields.${inMealsId}.value`, comparator: "ARRAY_INCLUDES", right: "$meal.id" };
  const notListed = { ...listed, comparator: "ARRAY_NOT_INCLUDES" };
  const notIn = { ...inMeal, comparator: "ARRAY_NOT_INCLUDES" };
  const load = step({ type: "INIT_VAR", name: "$ms", expr: `$ing.fields.${inMealsId}.value`, fallback: "json:[]" });
  const save = step({ type: "UPDATE", path: `$ing.fields.${inMealsId}.value`, value: "$ms" });
  return { sources: [], steps: [
    step({ type: "INIT_VAR", name: "$meal", expr: "$allItemsById.${$trigger.occurrenceId}" }),
    { id: randomUUID(), type: "loop", overExpr: "$allInstances", as: "$ing", body: [
      ifStep([{ left: `$ing.fields.${BC}.value`, comparator: "CONTAINS", right: "ingredient" }, { left: "$ing.meta.feedSourceId", comparator: "IS_EMPTY", right: "" }], [
        ifStep([inMeal, notListed], [load, step({ type: "PUSH_TO_VAR", name: "$ms", expr: "$meal.id" }), save]),
        ifStep([notIn, listed], [{ ...load, id: randomUUID() }, step({ type: "REMOVE_FROM_VAR", name: "$ms", value: "$meal.id" }), { ...save, id: randomUUID() }]),
      ]),
    ] },
  ] };
}

const catsOf = (o) => { const v = o?.fields?.[BC]?.value; return Array.isArray(v) ? v : v ? [v] : []; };

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module, Occurrence, Operation, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const userId = String(grid.userId);
  const now = new Date();
  const fields = await Field.find({ gridId }).lean();
  const show = fields.find((f) => f.name === "TV Show" && f.type === "occurrence");
  const seasonLink = fields.find((f) => f.name === "TV Season" && f.type === "occurrence");
  const mealIngredient = fields.find((f) => f.name === MEAL_INGREDIENT && f.type === "occurrence");
  if (!show || !seasonLink || !mealIngredient) throw new Error("run 0472/0473 first (TV Show, TV Season) / no Ingredient field");
  const seasonBoard = await Occurrence.findOne({ gridId, identitySignature: "tv:seasons" }).lean();
  if (!seasonBoard) throw new Error("no Seasons board (0473)");
  const epBoard = await Occurrence.findOne({ gridId, identitySignature: "tv:episodes" }).lean();
  if (!epBoard) throw new Error("no Episodes board (0472)");
  const boards = { ...BOARDS, episodes: { ...BOARDS.episodes, cont: epBoard.id, page: epBoard.parentId },
    seasons: { ...BOARDS.seasons, cont: seasonBoard.id, page: seasonBoard.parentId } };
  const buttonFolder = fields.find((f) => f.id === "3e98a62f-5b71-44ae-ac7e-c3788a98c601")?.folderId || null;

  // fields: the new buttons + In Meals
  const created = [];
  const ensure = (name, type, meta, folderId) => fields.find((f) => f.name === name && f.type === type)
    || (() => { const f = { id: randomUUID(), userId, gridId, name, type, folderId, inputEnabled: true, displayEnabled: false, meta }; created.push(f); fields.push(f); return f; })();
  const inMeals = ensure("In Meals", "occurrence", { multiSelect: true, optionsSource: { mode: "find", over: "$allInstances",
    predicate: { operator: "AND", rules: [{ id: randomUUID(), left: `fields.${BC}.value`, comparator: "CONTAINS", right: "meal" }] },
    valuePath: "id", labelPath: "label" } }, mealIngredient.folderId || null);
  const list = drills({ show: show.id, season: seasonLink.id, inMeals: inMeals.id }).map((d) => ({ ...d,
    fieldId: typeof d.field === "string" ? d.field : ensure(d.field.name, "button", { buttonLabel: d.field.label }, buttonFolder).id }));

  // which modules carry each kind of row (its board's own rows, never feed copies)
  const allRows = {};
  for (const [key, b] of Object.entries(boards)) {
    const cont = await Occurrence.findOne({ gridId, id: b.cont }).lean();
    const kids = await Occurrence.find({ gridId, id: { $in: cont?.occurrences || [] }, "meta.feedSourceId": { $exists: false } }).lean();
    allRows[b.cat] = kids.filter((k) => catsOf(k).includes(b.cat));
    boards[key].modules = [...new Set(allRows[b.cat].map((k) => k.moduleId))];
    boards[key].headerModule = cont?.moduleId;
  }
  const byCat = Object.fromEntries(Object.values(boards).map((b) => [b.cat, b]));
  const bindPlan = new Map();   // moduleId -> [fieldIds]
  const addBind = (mid, fid) => { if (!mid) return; if (!bindPlan.has(mid)) bindPlan.set(mid, []); bindPlan.get(mid).push(fid); };
  for (const d of list) {
    for (const cat of d.on) for (const mid of byCat[cat].modules) addBind(mid, d.fieldId);
    for (const h of d.headers || []) addBind(boards[h].headerModule, d.fieldId);
  }
  // the board filters each drill writes (copied from the Albums board's Artist filter)
  const filterPlan = new Map();  // contId -> [fieldIds]
  for (const d of list) for (const [b, fid] of [...(d.clear || []), ...Object.values(d.when || {}).flat()]) {
    const c = boards[b].cont; if (!filterPlan.has(c)) filterPlan.set(c, new Set()); filterPlan.get(c).add(fid);
  }
  // In Meals now, from every meal's Ingredient list
  const meals = allRows.meal, ingRows = allRows.ingredient;
  const inMealsNow = new Map(ingRows.map((i) => [i.id, new Set()]));
  for (const m of meals) for (const iid of [].concat(m.fields?.[mealIngredient.id]?.value || [])) inMealsNow.get(iid)?.add(m.id);

  log(`  fields new: ${created.map((f) => f.name).join(", ") || "none"}`);
  for (const d of list) log(`  ${d.op}: button on ${d.on.join("/")}${d.headers ? ` + ${d.headers.join("/")} header` : ""} -> ${d.to} board`);
  log(`  bind buttons on ${bindPlan.size} modules · board filters: ${[...filterPlan].map(([c, s]) => `${c}:${s.size}`).join(" ")}`);
  log(`  In Meals: ${[...inMealsNow.values()].filter((s) => s.size).length} of ${ingRows.length} ingredients are in a meal (${meals.length} meals)`);
  if (dryRun) return;

  if (created.length) await Field.insertMany(created.map((f) => ({ ...f, createdAt: now, updatedAt: now })));
  for (const [mid, fids] of bindPlan) {
    const m = await Module.findOne({ gridId, id: mid }).lean();
    const have = new Set((m.fieldBindings || []).map((b) => b.fieldId));
    const add = [...new Set(fids)].filter((fid) => !have.has(fid)).map((fieldId, i) => ({ fieldId, role: "input", order: (m.fieldBindings || []).length + i }));
    if (add.length) await Module.updateOne({ gridId, id: mid }, { $push: { fieldBindings: { $each: add } }, $set: { updatedAt: now } });
  }
  // ingredient modules carry In Meals, hidden
  for (const mid of byCat.ingredient.modules) {
    const m = await Module.findOne({ gridId, id: mid }).lean();
    if (!(m.fieldBindings || []).some((b) => b.fieldId === inMeals.id)) await Module.updateOne({ gridId, id: mid }, { $push: { fieldBindings: { fieldId: inMeals.id, role: "input", hidden: true, order: (m.fieldBindings || []).length } } });
  }
  for (const [contId, fids] of filterPlan) {
    const c = await Occurrence.findOne({ gridId, id: contId }).lean();
    const have = new Set((c.filters || []).map((x) => x.fieldId));
    const add = [...fids].filter((fid) => !have.has(fid)).map((fieldId) => ({ id: randomUUID(), fieldId, active: true, showNav: false, comparator: fieldId === inMeals.id ? "CONTAINS" : "IS", hides: false, hideEmpty: true }));
    if (add.length) await Occurrence.updateOne({ gridId, id: contId }, { $push: { filters: { $each: add } }, $set: { updatedAt: now } });
  }
  for (const [iid, set] of inMealsNow) if (set.size) await Occurrence.updateOne({ gridId, id: iid }, { $set: { [`fields.${inMeals.id}`]: { value: [...set], flow: "in" }, updatedAt: now } });

  const ops = await Operation.find({ gridId }).lean();
  const opFolder = ops.find((o) => o.name === "Music: Show Albums")?.folderId || null;
  const upsert = async (name, description, pipeline, triggerObjects) => {
    const types = [...new Set(triggerObjects.map((t) => t.eventType))];
    const doc = { name, description, pipeline, triggerObjects, triggerTypes: types, triggerType: types[0], enabled: true, updatedAt: now };
    const hit = ops.find((o) => o.name === name);
    if (hit) await Operation.updateOne({ gridId, id: hit.id }, { $set: doc });
    else await Operation.create({ id: randomUUID(), userId, gridId, folderId: opFolder, ...doc });
  };
  for (const d of list) {
    await upsert(d.op, `The ${d.field.label || d.op} button: opens the ${d.to} board filtered to the row it was pressed on (0473).`,
      drillPipeline(d, boards), [{ eventType: "onButton", subjectType: "field", targetId: d.fieldId, priority: 5 }]);
  }
  await upsert("Meals: Link Ingredients", "Keeps each ingredient's In Meals in step with the meals' Ingredient lists, so the Ingredients button can filter by meal.",
    linkIngredientsPipeline(mealIngredient.id, inMeals.id),
    [{ eventType: "onChange", subjectType: "field", targetId: mealIngredient.id, ancestorId: boards.meals.page, priority: 4 }]);
  log("  applied. RESTART pm2.");
}
