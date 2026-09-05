// CAN THE LOAD SWEEP RUN BEFORE THE ARTIFACT CATALOGUE ARRIVES?
//
// The sweep currently waits for the deferred half. Measured on the device, that
// wait is most of a 30-second load tail: a drag begun 18s after load reads
// `fps=4`, 82% blocked, with `opBy=[load:1x2861ms/236fx]` — the sweep still
// running. `ops:start` is 4.6s on the probe and ~15s on the tablet.
//
// `splitFullState`'s own header says why it waits: "the 19 operations that walk
// `$allItems` over every row see exactly what they saw before — the client
// simply waits for the second message before running its load sweep." So the
// question is not an opinion about those ops. It is whether the sweep EMITS THE
// SAME EFFECTS without the catalogue, and that is decidable by running it both
// ways over the live grid's own 71 pipelines and diffing.
//
// THIS IMPORTS THE REAL SERVER SPLIT rather than filtering by role here — a
// local reimplementation would test a rule the wire does not use, and the whole
// point is to measure exactly what ships.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { stripDayColumns } from "./freshDay";

let strippedColumns = 0;
import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { splitFullState } from "../../../server/utils/splitFullState.js";

vi.setConfig({ testTimeout: 180000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let fx, operations, split;

beforeAll(() => {
  fx = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString("utf8"));
  operations = fx.operations.filter((o) => o.enabled !== false);
  split = splitFullState(fx.occurrences, fx.modules);
});

/** A FRESH context per run — `_parentByChildId` and `_allItemsCache` memoise
 *  onto the object, so sharing one lets the first run seed the second. */
function buildCtx(occList, modList) {
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const modulesById = Object.fromEntries(modList.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(occList.map((o) => [o.id, structuredClone(o)]));
  // THE SWEEP MUST HAVE A DAY TO BUILD. Without this every assertion below
  // about what the sweep CREATES — and about it consulting the pinned
  // `Math.random` — depends on whether the fixture happened to be exported
  // before that morning's build ran. It did not on 2026-09-05, and three
  // assertions went red that were passing by accident. See ./freshDay.
  strippedColumns = stripDayColumns(occurrencesById, Object.values(fieldsById));
  const operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  const state = {
    grid: fx.grid, gridId: fx.grid?._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  };
  return { state, fieldsById, operationsById, occurrencesById, modulesById };
}

/** THE NO-OP GUARD, MIRRORED FROM ITS ONLY IMPLEMENTATION.
 *
 *  `bindSocketToStore`'s UPDATE_ITEM_FIELD case skips the write entirely when
 *  the value already stored equals the one being written (its own comment: a
 *  tracker re-computing the same sum every fire would otherwise re-emit a
 *  MeasureOp and cascade). That guard is why "265 effects" and "265 writes" are
 *  different numbers, and the difference is the whole case for running the
 *  sweep twice: a pass whose effects all no-op costs its pipeline evaluation
 *  and NOTHING of the render fan-out that follows — which is the expensive half
 *  (`ops:end -> effects:end` is 2,904ms against the sweep's own 824ms).
 *
 *  Anything that is not a same-value field write is counted as a real write,
 *  which is the conservative direction: it can only overstate pass 2's cost. */
function realWrites(world, effects) {
  // SEQUENTIALLY, because that is how the guards run: a field written twice in
  // one sweep changes on the first write and no-ops on the second.
  //
  // TWO KINDS ARE GUARDED IN `bindSocketToStore` AND THE REST ARE NOT.
  // UPDATE_ITEM_FIELD skips an identical value (its own comment: otherwise a
  // tracker recomputing the same sum re-emits a MeasureOp and can cascade), and
  // UPDATE_ITEM_LABEL does the same. Modelling only the field guard counted all
  // 48 of a settled load's label writes as real when the shipped guard already
  // suppresses every one — so the guarded set has to match the code, or this
  // number overstates what a second pass costs.
  const fseen = new Map(), lseen = new Map();
  const eq = (a, b) => { if (a === b) return true; if (a == null && b == null) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
  const byKind = {}, byOp = new Map();
  let n = 0;
  const bump = (eff) => {
    n++;
    byKind[eff._effect] = (byKind[eff._effect] || 0) + 1;
    const nm = operations.find((o) => o.id === eff._sourceOpId)?.name || "?";
    byOp.set(nm, (byOp.get(nm) || 0) + 1);
  };
  for (const eff of effects) {
    if (!eff?._effect) continue;
    if (eff._effect === "UPDATE_ITEM_FIELD" && eff.subKind !== "flow") {
      const k = eff.itemId + "\u0000" + eff.fieldId;
      const before = fseen.has(k) ? fseen.get(k) : world[eff.itemId]?.fields?.[eff.fieldId]?.value;
      fseen.set(k, eff.value);
      if (!eq(before, eff.value)) bump(eff);
      continue;
    }
    if (eff._effect === "UPDATE_ITEM_LABEL") {
      const before = lseen.has(eff.itemId) ? lseen.get(eff.itemId) : (world[eff.itemId]?.label ?? null);
      const next = eff.label ?? null;
      lseen.set(eff.itemId, next);
      if (!eq(before, next)) bump(eff);
      continue;
    }
    bump(eff);
  }
  return { n, byOp, byKind };
}

/** The kinds `applyEffectsToLiveOccs` does not model but the real applier does.
 *  Returns a histogram of what is STILL unmodelled, so a silent gap cannot pass
 *  for a faithful simulation. */
function applyExtraEffects(world, effects) {
  const left = {};
  for (const eff of effects) {
    if (!eff?._effect) continue;
    const occ = world[eff.itemId];
    switch (eff._effect) {
      case "UPDATE_ITEM_LABEL":
        if (occ) world[eff.itemId] = { ...occ, label: eff.value ?? eff.label ?? null };
        break;
      case "UPDATE_ITEM_OWN_STYLE":
        // PARTIAL MERGE ON `styleKey`, exactly as the real applier does — an
        // earlier version of this helper assigned `eff.value` (one style VALUE)
        // over the whole `ownStyle` OBJECT, so every later read of
        // `ownStyle[styleKey]` came back undefined and reported 0 of 21 writes
        // as redundant. The probe, not the app.
        if (occ && eff.styleKey) world[eff.itemId] = { ...occ, ownStyle: { ...(occ.ownStyle || {}), [eff.styleKey]: eff.value } };
        break;
      case "UPDATE_OCCURRENCE":
        if (occ) world[eff.itemId] = { ...occ, ...(eff.patch || eff.occurrence || {}) };
        break;
      case "SET_FILTER": case "SCROLL_TO":
        break; // presentation only — nothing an op reads back
      default:
        if (!_LIVEOCCS_MODELLED.has(eff._effect)) left[eff._effect] = (left[eff._effect] || 0) + 1;
    }
  }
  return left;
}
const _LIVEOCCS_MODELLED = new Set([
  "CREATE_ITEM", "UPDATE_ITEM_FIELD", "UPDATE_ITEM_PARENT", "UPDATE_ITEM_META",
  "UPDATE_ITEM_TEXTMAP", "UPDATE_ITEM_FILTER_OVERRIDE", "UPDATE_ITEM_FIELD_VISIBILITY",
  "DELETE_ITEM", "REMOVE_OCCURRENCE", "LINK_OCCURRENCE_TO_PARENT",
]);

/** Replace every generated id with a token, numbered by first appearance —
 *  stronger than stripping, because a minted id later referenced as a
 *  `parentId` maps to the same token in both runs. */
function tokenise(updates) {
  const GENERATED = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{13}-[a-z0-9]{9,}\b/g;
  const seen = new Map();
  return JSON.stringify(updates).replace(GENERATED, (id) => {
    if (!seen.has(id)) seen.set(id, `«gen${seen.size}»`);
    return seen.get(id);
  });
}

describe("the sweep with and without the artifact catalogue", () => {
  let full, core, fullEmit, coreEmit, rnd;

  it("the split actually holds a catalogue back — the control", () => {
    // Without this the comparison is between two identical inputs and every
    // assertion below is vacuously true.
    expect(split.deferred.length).toBeGreaterThan(1000);
    expect(split.core.length).toBeGreaterThan(1000);
    expect(split.core.length + split.deferred.length).toBe(fx.occurrences.length);
  });

  it("both runs actually run the grid's operations — the control", () => {
    // THE SWEEP IS NOT DETERMINISTIC ON ITS OWN: `Daily Question Rotator` picks
    // at random, so two runs of the SAME input disagree there too. The pin is
    // what separates "the sweep is random" from "the catalogue changed the
    // answer", and it is asserted to be CONSULTED so it cannot go decorative.
    rnd = vi.spyOn(Math, "random").mockReturnValue(0.42);
    fullEmit = []; coreEmit = [];
    full = runMatchingOperations(operations, null, null, buildCtx(fx.occurrences, fx.modules),
      { onSuccess: (name, e) => fullEmit.push(`${name}:${e.length}`) });
    core = runMatchingOperations(operations, null, null, buildCtx(split.core, split.coreModules),
      { onSuccess: (name, e) => coreEmit.push(`${name}:${e.length}`) });
    expect(fullEmit.length).toBeGreaterThan(20);
    expect(coreEmit.length).toBeGreaterThan(20);
    expect(strippedColumns, "no day column was stripped — the fixture shape changed").toBeGreaterThan(0);
    expect(rnd.mock.calls.length).toBeGreaterThan(0);
    rnd.mockRestore();
  });

  it("REPORT: which operations emit differently without the catalogue", () => {
    const a = new Map(fullEmit.map((s) => [s.split(":")[0], s]));
    const b = new Map(coreEmit.map((s) => [s.split(":")[0], s]));
    const differing = [];
    for (const [name, s] of a) if (b.get(name) !== s) differing.push(`${s}  ->  ${b.get(name) ?? "(did not emit)"}`);
    for (const [name, s] of b) if (!a.has(name)) differing.push(`(did not emit)  ->  ${s}`);
    // Reported, not asserted — this test exists to ANSWER the question, and a
    // list of names is the answer whichever way it comes out.
    // Effect-by-effect, so "they differ" becomes "THESE differ" — the only
    // form of the answer that says what to do next.
    const tok = (u) => tokenise([u]);
    const diffs = [];
    for (let i = 0; i < Math.max(full.length, core.length); i++) {
      if (tok(full[i]) === tok(core[i])) continue;
      const f = full[i] || {}, c = core[i] || {};
      const opName = operations.find((o) => o.id === (f._sourceOpId || c._sourceOpId))?.name || "?";
      diffs.push(`${opName} · ${f._effect || c._effect} · field=${(f.fieldId || c.fieldId || "").slice(0, 8)} · item=${(f.itemId || c.itemId || "").slice(0, 8)}\n        full=${JSON.stringify(f.value)}\n        core=${JSON.stringify(c.value)}`);
    }
    const report = [
      `ops emitting: full=${fullEmit.length} core=${coreEmit.length}`,
      `effects: full=${full.length} core=${core.length}`,
      `tokenised equal: ${tokenise(full) === tokenise(core)}`,
      differing.length ? `DIFFERING EMITTERS (${differing.length}):\n  ` + differing.join("\n  ") : "NONE — identical emitters",
      `DIFFERING EFFECTS (${diffs.length} of ${full.length}):\n  ` + diffs.slice(0, 25).join("\n  "),
    ].join("\n");
    writeFileSync("/tmp/sweep-equiv.txt", report);
    console.log(report);
    expect(true).toBe(true);
  });

  // THE GATE ON RUNNING IT TWICE.
  //
  // If the sweep can run on the core state and then AGAIN once the catalogue
  // lands, the wait disappears. That is only safe if the second pass is a
  // no-op — otherwise every load would double-create. This applies the first
  // sweep's effects to the world and re-runs, which is the convergence guard
  // 2026-08-31 (2) built after a day column re-copied itself on every load.
  it("CONVERGES: applying the sweep's effects and re-running creates nothing new", () => {
    const rnd2 = vi.spyOn(Math, "random").mockReturnValue(0.42);
    const ctx = buildCtx(fx.occurrences, fx.modules);
    const first = runMatchingOperations(operations, null, null, ctx, {});
    // The executor's own overlay applier — the same one bindSocketToStore uses
    // so the second pass sees exactly what a real second pass would.
    // `(liveOccs, effects)` — and getting it BACKWARDS is how this test was
    // vacuous on its first run: nothing was applied, pass 2 saw an unchanged
    // world, re-created all 103, and the `<=` assertion passed on equality.
    applyEffectsToLiveOccs(ctx.occurrencesById, first);
    // THE OVERLAY APPLIER IS NOT THE ONE THE LOAD PATH USES. `bindSocketToStore`
    // applies effects with `applyOperationEffect`, which writes labels, styles
    // and whole-occurrence patches to the store; `applyEffectsToLiveOccs` is the
    // executor's IN-SWEEP overlay and handles a narrower set. Leaving the gap
    // unmodelled makes the second pass read stale labels and look like a
    // convergence failure that the real app does not have — so the kinds this
    // test needs are applied here, and `applyExtraEffects` returns what it could
    // NOT model so the gap is reported rather than assumed empty.
    const unmodelled = applyExtraEffects(ctx.occurrencesById, first);
    const second = runMatchingOperations(operations, null, null, ctx, {});
    const creates = (list) => list.filter((u) => u._effect === "CREATE_ITEM").length;
    // CONVERGENCE IS ABOUT VALUES TOO, NOT ONLY CREATES. A second pass that
    // rebuilds nothing can still OVERWRITE what the first pass wrote, and on a
    // real load that is a visible regression rather than wasted work.
    const rwSecond = realWrites(ctx.occurrencesById, second);
    // A THIRD PASS SEPARATES A ONE-TIME SETTLE FROM AN OSCILLATION, and they
    // mean opposite things. Pass 1 runs against a world where today has not
    // been built yet, so SOME churn on pass 2 is the build settling. If pass 3
    // is quiet the sweep is stable from pass 2 onward; if pass 3 rewrites the
    // same fields, the two ops flip-flop and every load would fight the last.
    applyEffectsToLiveOccs(ctx.occurrencesById, second);
    applyExtraEffects(ctx.occurrencesById, second);
    const third = runMatchingOperations(operations, null, null, ctx, {});
    const rwThird = realWrites(ctx.occurrencesById, third);
    const byOpThird = [...rwThird.byOp.entries()].sort((a, b) => b[1] - a[1])
      .map(([nm, c]) => `${c}x ${nm}`).join("\n      ");
    const byOpSecond = [...rwSecond.byOp.entries()].sort((a, b) => b[1] - a[1])
      .map(([nm, c]) => `${c}x ${nm}`).join("\n      ");
    const HANDLED = new Set(["CREATE_ITEM","UPDATE_ITEM_FIELD","UPDATE_ITEM_PARENT","UPDATE_ITEM_META","UPDATE_ITEM_TEXTMAP","UPDATE_ITEM_FILTER_OVERRIDE","UPDATE_ITEM_FIELD_VISIBILITY","DELETE_ITEM","REMOVE_OCCURRENCE","LINK_OCCURRENCE_TO_PARENT"]);
    const dropped = first.reduce((a, u) => { if (u._effect && !HANDLED.has(u._effect)) a[u._effect] = (a[u._effect] || 0) + 1; return a; }, {});
    const report2 = [
      `pass 1: ${first.length} effects, ${creates(first)} creates`,
      `pass 2: ${second.length} effects, ${creates(second)} creates, ${rwSecond.n} REAL writes`,
      `pass 2 value changes BY OP:\n      ${byOpSecond || "(none)"}`,
      `pass 1 effects the OVERLAY APPLIER DROPS: ${JSON.stringify(dropped)}`,
      (() => {
        // ONLY `UPDATE_ITEM_FIELD` HAS A NO-OP GUARD (bindSocketToStore's own
        // comment: skip when the new value is identical to what is stored).
        // Labels and styles have none, so if they re-write what is already
        // there, every load pays a store write and its render fan-out for
        // nothing. This counts how many of pass 1's are redundant against the
        // UNTOUCHED fixture — i.e. what a settled grid re-writes on load.
        const w0 = buildCtx(fx.occurrences, fx.modules).occurrencesById;
        const tally = { label: [0, 0], ownStyle: [0, 0] };
        for (const u of first) {
          if (u._effect === "UPDATE_ITEM_LABEL") {
            const cur = w0[u.itemId]?.label;
            tally.label[JSON.stringify(cur) === JSON.stringify(u.value ?? u.label ?? null) ? 0 : 1]++;
          } else if (u._effect === "UPDATE_ITEM_OWN_STYLE") {
            const cur = w0[u.itemId]?.ownStyle;
            tally.ownStyle[JSON.stringify(cur) === JSON.stringify(u.value ?? u.ownStyle ?? null) ? 0 : 1]++;
          }
        }
        return `UNGUARDED effect kinds on a settled load — [redundant, real]:\n      label=${JSON.stringify(tally.label)} ownStyle=${JSON.stringify(tally.ownStyle)}`;
      })(),
      `still UNMODELLED after the top-up: ${JSON.stringify(unmodelled)}`,
      `pass 3: ${third.length} effects, ${creates(third)} creates, ${rwThird.n} REAL writes`,
      `pass 3 value changes BY OP:\n      ${byOpThird || "(none)"}`,
      (() => {
        // A 2-CYCLE IS THE CLAIM, so it is checked rather than inferred from
        // two equal counts: the LAST value each pass writes to a given field
        // must match pass 1 on the odd passes and pass 2 on the even ones.
        const last = (list) => { const m = new Map(); for (const u of list) if (u._effect === "UPDATE_ITEM_FIELD" && u.subKind !== "flow") m.set(u.itemId + "\u0000" + u.fieldId, u.value); return m; };
        const [a, b, c] = [last(first), last(second), last(third)];
        let cycles = 0, stable = 0, other = 0;
        for (const [k, v1] of a) {
          const v2 = b.get(k), v3 = c.get(k);
          if (JSON.stringify(v1) === JSON.stringify(v2)) { stable++; continue; }
          if (JSON.stringify(v1) === JSON.stringify(v3)) cycles++;
          else other++;
        }
        return `fields written in BOTH passes: same=${stable} two-cycle=${cycles} other=${other}`;
      })(),
    ].join("\n");
    writeFileSync("/tmp/sweep-converge.txt", report2);
    console.log(report2);
    rnd2.mockRestore();
    // Growth BETWEEN the passes, not an absolute — the sweep is date-dependent
    // and pass 1 legitimately builds a day column on a fresh day.
    // Convergence is ZERO new creates, not "no growth" — equality passes the
    // weaker form while the grid doubles on every load.
    expect(creates(second)).toBe(0);
  });

  // THE ACTUAL PROPOSED SEQUENCE, not an approximation of it.
  //
  // pass 1 runs on the CORE state the moment it lands; its effects go into the
  // overlay exactly as `applyOperationEffect` puts them there; pass 2 runs when
  // the catalogue arrives, over the payload UNION the overlay — which is what
  // `mergedOccsOverlay` hands the executor today.
  //
  // The failure this guards is precise and this codebase has been damaged by
  // it: if pass 2 cannot see pass 1's creates it re-creates them, and every
  // load doubles the day column. My first attempt at the test above got
  // `applyEffectsToLiveOccs`'s argument order backwards and reported exactly
  // that shape — 103 creates in both passes — while still passing, which is why
  // this one asserts ZERO and prints the count.
  it("TWO-PASS: core first, then the catalogue — the second pass creates nothing", () => {
    const rnd3 = vi.spyOn(Math, "random").mockReturnValue(0.42);

    // pass 1 — core only, exactly what arrives in the first message.
    const ctx1 = buildCtx(split.core, split.coreModules);
    const pass1 = runMatchingOperations(operations, null, null, ctx1, {});

    // The overlay after pass 1: the core world with pass 1's effects applied.
    const overlay = ctx1.occurrencesById;
    applyEffectsToLiveOccs(overlay, pass1);
    // …AND the kinds that applier does not model (labels / styles / whole-
    // occurrence patches). Without this, pass 2 reads a world that never
    // received pass 1's style writes and re-counts all 21 as new work.
    applyExtraEffects(overlay, pass1);

    // pass 2 — the catalogue has landed. World = the full payload, with the
    // overlay winning, which is `mergedOccsOverlay`'s own rule (local wins).
    const ctx2 = buildCtx(fx.occurrences, fx.modules);
    ctx2.occurrencesById = Object.assign({}, ctx2.occurrencesById, overlay);
    ctx2.state.occurrencesById = ctx2.occurrencesById;
    const pass2 = runMatchingOperations(operations, null, null, ctx2, {});

    const creates = (l) => l.filter((u) => u._effect === "CREATE_ITEM").length;
    // The world each pass writes INTO, before that pass's own effects land.
    const w1 = buildCtx(split.core, split.coreModules).occurrencesById;
    const rw1 = realWrites(w1, pass1);
    const rw2 = realWrites(ctx2.occurrencesById, pass2);
    const writes1 = rw1.n, writes2 = rw2.n;
    const byOp2 = [...rw2.byOp.entries()].sort((a, b) => b[1] - a[1])
      .map(([nm, c]) => `${c}x ${nm}`).join("\n      ");
    const report3 = [
      `pass 1 (core):      ${pass1.length} effects, ${creates(pass1)} creates, ${writes1} REAL writes`,
      `pass 2 (catalogue): ${pass2.length} effects, ${creates(pass2)} creates, ${writes2} REAL writes`,
      `media counters in pass 2: ${pass2.filter((u) => operations.find((o) => o.id === u._sourceOpId)?.name === "Trackers: Media Owned").length}`,
      `pass 2 real writes BY OP:\n      ${byOp2 || "(none)"}`,
      `pass 1 real writes BY KIND: ${JSON.stringify(rw1.byKind)}`,
      `pass 2 real writes BY KIND: ${JSON.stringify(rw2.byKind)}`,
      (() => {
        // `UPDATE_ITEM_OWN_STYLE` HAS NO NO-OP GUARD (bindSocketToStore writes
        // it unconditionally), so this asks the question a guard would: is the
        // value already there? Measured against the world AFTER pass 1, which
        // is the world pass 2 actually writes into.
        let same = 0, diff = 0;
        for (const u of pass2) {
          if (u._effect !== "UPDATE_ITEM_OWN_STYLE" || !u.styleKey) continue;
          const cur = overlay[u.itemId]?.ownStyle?.[u.styleKey];
          if (JSON.stringify(cur) === JSON.stringify(u.value)) same++; else diff++;
        }
        return `pass 2 ownStyle writes — redundant=${same} real=${diff}`;
      })(),
      `pass 2 effect TYPES: ${JSON.stringify(pass2.reduce((a, u) => { if (u._effect) a[u._effect] = (a[u._effect] || 0) + 1; return a; }, {}))}`,
    ].join("\n");
    writeFileSync("/tmp/sweep-twopass.txt", report3);
    console.log(report3);
    rnd3.mockRestore();

    expect(creates(pass1)).toBeGreaterThan(0);   // control: pass 1 really built
    expect(creates(pass2)).toBe(0);              // and pass 2 rebuilds nothing

    // AND PASS 2 IS NEARLY FREE TO APPLY, which is what makes running the sweep
    // twice a trade rather than a doubling. `writes1 > writes2` is asserted as
    // a RATIO rather than a constant because the numbers are data-dependent; a
    // constant here would be re-tuned on the next fixture refresh and stop
    // meaning anything. The control is `writes1` being large — without it a
    // counter that returns 0 for everything passes.
    expect(writes1).toBeGreaterThan(20);
    expect(writes2 * 4).toBeLessThan(writes1);
  });
});
