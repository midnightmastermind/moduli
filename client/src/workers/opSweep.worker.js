// workers/opSweep.worker.js — runs the LOAD sweep off the page (helpers/opSweepCore). The page streams the
// snapshot in pieces (so no single copy freezes it), then asks for the run; the worker answers once.
import { runSweepSnapshot } from "../helpers/opSweepCore";

let snap = null;
self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === "begin") { snap = { ...m.head, occurrences: [], modules: [] }; return; }
  if (!snap) return;
  if (m.type === "rows") { const list = snap[m.key]; for (const r of m.rows) list.push(r); return; }
  if (m.type === "run") {
    const t0 = performance.now();
    try {
      const out = runSweepSnapshot(snap);
      self.postMessage({ type: "done", ...out, ms: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: "failed", message: String(err?.message || err) });
    }
    snap = null;
  }
};
