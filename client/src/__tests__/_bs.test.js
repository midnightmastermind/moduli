import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 120000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs, getOpRunHistory } from "../helpers/operationExecutor";
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here,"fixtures","pomsGrid.json.br"))).toString());
const FMT="vQ0ELZP_zxnx";
describe("Build Schedule", () => {
  it("how many slots does one load actually create", () => {
    const operations = fx.operations.filter(o => o.enabled !== false);
    const occurrencesById = Object.fromEntries(fx.occurrences.map(o=>[o.id,structuredClone(o)]));
    const modulesById = Object.fromEntries(fx.modules.map(m=>[m.id,m]));
    const fieldsById = Object.fromEntries(fx.fields.map(f=>[f.id,f]));
    const operationsById = Object.fromEntries(operations.map(o=>[o.id,o]));
    const state = { grid: fx.grid, gridId: fx.grid._id, fields: Object.values(fieldsById),
      modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById, operations };
    const before = Object.values(occurrencesById).find(o=>o.fields?.[FMT]?.value==="day-col");
    console.log("BEFORE listed:", (before.occurrences||[]).length);
    const errs=[], per={};
    const ups = runMatchingOperations(operations, null, null,
      { state, fieldsById, operationsById, occurrencesById, modulesById },
      { onError:(n,e)=>errs.push(`${n}: ${e?.message||e}`), onSuccess:(n,r)=>{per[n]=(per[n]||0)+r.length;} });
    applyEffectsToLiveOccs(occurrencesById, ups);
    const after = Object.values(occurrencesById).find(o=>o.fields?.[FMT]?.value==="day-col");
    console.log("AFTER  listed:", (after.occurrences||[]).length);
    console.log("Build Schedule effects:", per["Schedule: Build Schedule"] ?? 0);
    console.log("Place Cycle Day effects:", per["Schedule: Place Cycle Day"] ?? 0);
    const kinds={};
    for(const u of ups){ const k=u?.type||u?._effect||"?"; kinds[k]=(kinds[k]||0)+1; }
    console.log("effect kinds:", JSON.stringify(kinds).slice(0,300));
    console.log("errors:", errs.slice(0,5));
    const op = operations.find(o=>o.name==="Schedule: Build Schedule");
    const h=getOpRunHistory?.(op.id)||[]; const last=h[h.length-1];
    const loops=(last?.entries||[]).filter(e=>e.kind==="loop");
    console.log("loops:", loops.map(l=>`${l.over}:${l.itemCount}`).join(", "));
    const err=(last?.entries||[]).find(e=>e.kind==="error");
    console.log("op error entry:", err?JSON.stringify(err).slice(0,300):"none");
    expect(true).toBe(true);
  });
});
