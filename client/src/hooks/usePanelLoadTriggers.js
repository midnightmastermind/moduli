// hooks/usePanelLoadTriggers.js — fires onLoadInPanel / onUnloadFromPanel.
//
// What is "in a panel" comes from helpers/panelPresence (the pages the panels
// show and everything they hold). Each trigger's query is matched against that
// set after every change (debounced), and the pure `planPanelFire` decides what
// fires. The "inView" mode is the one DOM-based case: an IntersectionObserver
// over the rows the query names, firing each time one scrolls into view.
//
// Runs the op directly (like useScheduler), so the transaction matcher never
// sees these trigger types. Writes are derived (not undo steps — nobody did them).
import { isPassiveWindow } from "../helpers/passiveWindow.js";
import { useEffect, useMemo, useRef } from "react";
import { executePipeline, opRunsOnGrid } from "../helpers/operationExecutor";
import { runDerived } from "../helpers/actionScope";
import { setComputedValuesAction } from "../state/actions";
import { operationsBridge } from "../state/bindSocketToStore";
import { isSnapshotMode } from "../state/snapshotMode.js";
import { presentInPanels, matchedIds, matchesQuery, planPanelFire } from "../helpers/panelPresence.js";

const SETTLE_MS = 300;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;

export function triggerQuery(t) {
  return { occurrenceIds: t?.occurrenceIds || [], moduleIds: t?.moduleIds || [] };
}

export function usePanelLoadTriggers({ state, dispatch, fieldsById, operationsById, occurrencesById, modulesById, viewsById }) {
  const ops = useMemo(() => Object.values(operationsById || {}).filter((op) =>
    op?.enabled && opRunsOnGrid(op, state) &&
    (op.triggerObjects || []).some((t) => t?.eventType === "onLoadInPanel" || t?.eventType === "onUnloadFromPanel"),
  ), [operationsById, state?.grid]);

  const prevRef = useRef(new Map());     // `${opId}:${i}` -> Set of matched ids
  const onceRef = useRef(new Set());     // keys that fired their "once"
  const firesRef = useRef(new Map());    // opId -> recent fire times
  const ctxRef = useRef(null);
  ctxRef.current = { state, fieldsById, occurrencesById, operationsById, modulesById, viewsById, dispatch };

  const runOp = (op, tx) => {
    const now = Date.now();
    const recent = (firesRef.current.get(op.id) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      console.warn(`[panel-trigger] "${op.name}" fired ${RATE_MAX} times in ${RATE_WINDOW_MS / 1000}s — skipped (does it change what is on screen?)`);
      return;
    }
    recent.push(now);
    firesRef.current.set(op.id, recent);
    const c = ctxRef.current;
    const updates = executePipeline(op, { state: c.state, fieldsById: c.fieldsById, occurrencesById: c.occurrencesById, operationsById: c.operationsById, modulesById: c.modulesById }, tx) || [];
    const display = updates.filter((u) => !u._effect);
    const effects = updates.filter((u) => u._effect);
    if (display.length) c.dispatch(setComputedValuesAction(display));
    if (effects.length && typeof operationsBridge.applyEffect === "function") {
      runDerived(() => { for (const eff of effects) operationsBridge.applyEffect(eff); });
    }
  };

  const txFor = (type, ids) => {
    const occ = ctxRef.current.occurrencesById?.[ids[0]] || null;
    return { type, occurrenceIds: ids, occurrenceId: ids[0] || null, occurrence: occ, at: new Date().toISOString() };
  };

  // ── data presence: appear / once / unload ──────────────────────────────
  useEffect(() => {
    if (!ops.length) return;
    const timer = setTimeout(() => {
      if (isSnapshotMode()) return;
      if (isPassiveWindow()) return; // the headset's control panel (helpers/passiveWindow)
      const present = presentInPanels({ grid: state?.grid, occurrencesById, viewsById, modulesById });
      for (const op of ops) {
        (op.triggerObjects || []).forEach((t, i) => {
          if (t?.eventType !== "onLoadInPanel" && t?.eventType !== "onUnloadFromPanel") return;
          const key = `${op.id}:${i}`;
          const next = matchedIds(present, triggerQuery(t), occurrencesById);
          const prev = prevRef.current.get(key);
          prevRef.current.set(key, next);
          const plan = planPanelFire({ eventType: t.eventType, mode: t.mode || "appear", prev, next, firedOnce: onceRef.current.has(key) });
          if (!plan.fire) return;
          if ((t.mode || "appear") === "once") onceRef.current.add(key);
          runOp(op, txFor(t.eventType === "onUnloadFromPanel" ? "PanelUnloadOp" : "PanelLoadOp", plan.ids));
        });
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ops, state?.grid, occurrencesById, viewsById, modulesById]);

  // ── in view: an IntersectionObserver over the rows the queries name ──────
  const inViewTriggers = useMemo(() => {
    const out = [];
    for (const op of ops) (op.triggerObjects || []).forEach((t) => {
      if (t?.eventType === "onLoadInPanel" && t.mode === "inView") out.push({ op, query: triggerQuery(t) });
    });
    return out;
  }, [ops]);

  useEffect(() => {
    if (!inViewTriggers.length || typeof IntersectionObserver === "undefined") return;
    const seen = new Map(); // element -> true while intersecting
    const io = new IntersectionObserver((entries) => {
      if (isSnapshotMode()) return;
      if (isPassiveWindow()) return; // the headset's control panel (helpers/passiveWindow)
      for (const e of entries) {
        const id = e.target.getAttribute("data-occ-id") || e.target.getAttribute("data-occurrence-id");
        if (!e.isIntersecting) { seen.delete(e.target); continue; }
        if (seen.get(e.target)) continue;
        seen.set(e.target, true);
        const occ = ctxRef.current.occurrencesById?.[id];
        for (const { op, query } of inViewTriggers) if (matchesQuery(occ, query)) runOp(op, txFor("PanelLoadOp", [id]));
      }
    });
    const observed = new Set();
    const scan = () => {
      const occs = ctxRef.current.occurrencesById || {};
      for (const el of document.querySelectorAll("[data-occ-id],[data-occurrence-id]")) {
        if (observed.has(el)) continue;
        const occ = occs[el.getAttribute("data-occ-id") || el.getAttribute("data-occurrence-id")];
        if (!inViewTriggers.some(({ query }) => matchesQuery(occ, query))) continue;
        observed.add(el);
        io.observe(el);
      }
    };
    let pending = null;
    const mo = new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(scan, 400); });
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { clearTimeout(pending); mo.disconnect(); io.disconnect(); };
  }, [inViewTriggers]);
}
