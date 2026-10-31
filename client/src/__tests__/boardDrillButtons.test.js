// 0474 — drill buttons are operations: the pressed row's category picks the filter the destination board gets.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { drillPipeline, drills, linkIngredientsPipeline } from "../../../server/migrations/0474-board-drill-buttons.mjs";

const BC = "uew6sn6WWXin", ARTIST = "8wotshpcdlog", ALBUM = "9i0yaflshggo";
const boards = { artists: { cont: "cA", page: "pA" }, albums: { cont: "cAl", page: "pAl" }, songs: { cont: "cS", page: "pS" },
  authors: { cont: "x", page: "x" }, books: { cont: "x", page: "x" }, shows: { cont: "x", page: "x" }, episodes: { cont: "x", page: "x" },
  meals: { cont: "x", page: "x" }, ingredients: { cont: "cI", page: "pI" } };
const list = drills({ show: "fShow", season: "fSeason", inMeals: "fIn" });
const byOp = (n) => list.find((d) => d.op === n);
const occ = {
  art: { id: "art", moduleId: "m", fields: { [BC]: { value: ["artist"] } } },
  alb: { id: "alb", moduleId: "m", fields: { [BC]: { value: ["album"] }, [ARTIST]: { value: "art" } } },
  song: { id: "song", moduleId: "m", fields: { [BC]: { value: ["song"] }, [ARTIST]: { value: "art" }, [ALBUM]: { value: "alb" } } },
  cS: { id: "cS", moduleId: "m", fields: { [BC]: { value: ["song"] } } }, cAl: { id: "cAl", moduleId: "m" }, cA: { id: "cA", moduleId: "m" },
};
function press(opName, rowId) {
  const op = { id: "op", name: opName, enabled: true, pipeline: drillPipeline(byOp(opName), boards) };
  const r = executePipeline(op, { state: { modules: [{ id: "m" }] }, occurrencesById: occ, fieldsById: {}, operationsById: {} },
    { type: "ButtonOp", occurrenceId: rowId, panelViewId: "view1" });
  const updates = r.updates || r;
  const filters = {}; let page = null;
  for (const u of updates) {
    if (u._effect === "UPDATE_ITEM_FILTER_OVERRIDE") filters[`${u.itemId}.${u.fieldId}`] = u.value;
    if (u._effect === "UPDATE_VIEW") page = u.patch?.activeOccurrenceId;
  }
  return { filters, page, updates };
}

describe("drill buttons", () => {
  it("Songs on an ARTIST skips the album level: songs filtered by artist, album filter cleared", () => {
    const r = press("Music: Show Songs", "art");
    expect(r.page).toBe("pS");
    expect(r.filters[`cS.${ARTIST}`]).toBe("art");
    expect(r.filters[`cS.${ALBUM}`] ?? null).toBe(null);
  });
  it("Songs on an ALBUM: by album, artist filter cleared", () => {
    const r = press("Music: Show Songs", "alb");
    expect(r.filters[`cS.${ALBUM}`]).toBe("alb");
    expect(r.filters[`cS.${ARTIST}`] ?? null).toBe(null);
  });
  it("◀ Albums on a song shows that song's artist's albums", () => {
    const r = press("Music: Back to Albums", "song");
    expect(r.page).toBe("pAl");
    expect(r.filters[`cAl.${ARTIST}`]).toBe("art");
  });
  it("◀ Albums on the Songs board header only clears and goes", () => {
    const r = press("Music: Back to Albums", "cS");
    expect(r.page).toBe("pAl");
    expect(`cAl.${ARTIST}` in r.filters).toBe(false);
  });
  it("◀ Artists clears every music filter", () => {
    const r = press("Music: Back to Artists", "song");
    expect(r.page).toBe("pA");
    expect(Object.keys(r.filters).sort()).toEqual([`cAl.${ARTIST}`, `cS.${ALBUM}`, `cS.${ARTIST}`].sort());
  });
});

describe("Meals: Link Ingredients", () => {
  const run = (mealIngredients, ingIn) => {
    const o = {
      meal: { id: "meal", moduleId: "m", fields: { [BC]: { value: ["meal"] }, fIng: { value: mealIngredients } } },
      i1: { id: "i1", moduleId: "m", fields: { [BC]: { value: ["ingredient"] }, fIn: ingIn.i1 ? { value: ingIn.i1 } : undefined } },
      i2: { id: "i2", moduleId: "m", fields: { [BC]: { value: ["ingredient"] }, fIn: ingIn.i2 ? { value: ingIn.i2 } : undefined } },
    };
    const r = executePipeline({ id: "op", name: "x", enabled: true, pipeline: linkIngredientsPipeline("fIng", "fIn") },
      { state: { modules: [{ id: "m", role: "instance" }] }, occurrencesById: o, fieldsById: {}, operationsById: {} },
      { type: "MeasureOp", occurrenceId: "meal" });
    const out = {};
    for (const u of r.updates || r) if (u._effect === "UPDATE_ITEM_FIELD") out[u.itemId] = u.value;
    return out;
  };
  it("adds the meal to a new ingredient and takes it off a removed one", () => {
    expect(run(["i1"], { i2: ["meal"] })).toEqual({ i1: ["meal"], i2: [] });
  });
  it("writes nothing when they already agree", () => {
    expect(run(["i1"], { i1: ["meal"] })).toEqual({});
  });
});
