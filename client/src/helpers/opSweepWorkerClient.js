// helpers/opSweepWorkerClient.js — the page side of the op-sweep worker (workers/opSweep.worker.js).
//
// Streams the load snapshot to a fresh worker in CHUNKS, yielding a frame between them: posting the whole
// grid at once is one structured clone measured at ~0.75s on a phone-speed CPU (26k occurrences, 36MB),
// which would freeze the very scroll this exists to keep smooth. Resolves to the sweep's result, or null
// when the worker is unavailable or failed — the caller then runs the sweep on the page as before.
import { yieldToBrowser } from "./sliceWork";

const CHUNK = 1500;

/** Experiment switch (2026-10-14): on unless localStorage `moduli-sweepWorker` is "0". */
export function sweepWorkerEnabled() {
  try { if (typeof Worker === "undefined") return false; return localStorage.getItem("moduli-sweepWorker") !== "0"; } catch { return typeof Worker !== "undefined"; }
}

export async function runSweepInWorker({ occurrences, modules, fields, operations, grid, gridId, folders }, { timeoutMs = 60000 } = {}) {
  let worker;
  try { worker = new Worker(new URL("../workers/opSweep.worker.js", import.meta.url), { type: "module" }); } catch { return null; }
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    worker.onmessage = (e) => { if (e.data?.type === "done" || e.data?.type === "failed") { clearTimeout(timer); resolve(e.data.type === "done" ? e.data : null); } };
    worker.onerror = () => { clearTimeout(timer); resolve(null); };
  });
  try {
    worker.postMessage({ type: "begin", head: { fields, operations, grid, gridId, folders } });
    for (const [key, list] of [["modules", modules || []], ["occurrences", occurrences || []]]) {
      for (let i = 0; i < list.length; i += CHUNK) {
        worker.postMessage({ type: "rows", key, rows: list.slice(i, i + CHUNK) });
        await yieldToBrowser();
      }
    }
    worker.postMessage({ type: "run" });
    return await done;
  } catch {
    return null;
  } finally {
    worker.terminate();
  }
}
