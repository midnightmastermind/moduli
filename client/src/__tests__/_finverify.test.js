import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here,"fixtures","pomsGrid.json.br"))).toString());
describe("financial after a real load sweep", () => {
  it("the op runs and leaves Financial alone", () => {
    const operations = fx.operations.filter(o => o.enabled !== false);
    const occurrencesById = Object.fromEntries(fx.occurrences.map(o=>[o.id,structuredClone(o)]));
    const modulesById = Object.fromEntries(fx.modules.map(m=>[m.id,m]));
    const fieldsById = Object.fromEntries(fx.fields.map(f=>[f.id,f]));
    const operationsById = Object.fromEntries(operations.map(o=>[o.id,o]));
    const state = { grid: fx.grid, gridId: fx.grid._id, fields: Object.values(fieldsById),
      modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById, operations };
    const ctx = { state, fieldsById, operationsById, occurrencesById, modulesById };
    const ups = runMatchingOperations(operations, null, null, ctx, {});
    applyEffectsToLiveOccs(occurrencesById, ups);

    const lbl = o => o?.label || modulesById[o?.moduleId]?.label;
    const TD = Object.values(fieldsById).find(f=>f.name==="Tracker Date" && f.displayEnabled).id;
    const trk = Object.values(occurrencesById).find(o=>modulesById[o.moduleId]?.label==="Trackers" && modulesById[o.moduleId]?.role==="page");
    const conts = (trk.occurrences||[]).map(i=>occurrencesById[i]).filter(Boolean);
    const fin = conts.find(c=>/Financial/i.test(lbl(c)));
    const other = conts.filter(c=>!/Financial/i.test(lbl(c)));
    const tiles = (fin.occurrences||[]).map(i=>occurrencesById[i]).filter(Boolean);
    const dated = tiles.filter(t=>t.fields?.[TD]?.value!=null).map(t=>lbl(t));
    console.log("FINANCIAL label after sweep :", JSON.stringify(fin.label), "->", lbl(fin));
    console.log("tiles still date-stamped    :", dated.join(", ")||"(none)");
    console.log("OTHER containers (control)  :", other.slice(0,3).map(c=>lbl(c)).join(" | "));
    // The control: every OTHER container must still get its date prefix, or the
    // guard is not narrow, it is just off.
    expect(other.some(c=>/^Today's /.test(lbl(c)||""))).toBe(true);
    expect(lbl(fin)).toBe("Financial");
    expect(dated.sort()).toEqual(["Income","Spent"]);
  });
});
