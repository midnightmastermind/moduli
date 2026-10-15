// helpers/stepClipboard.js
// Copy / Paste for operation pipeline steps. The step editor reorders only
// within one list, so an existing block could not be moved INTO an IF/loop, nor
// reused in another operation. A copied step lives in memory and in
// localStorage (so it survives switching ops and reloading); a paste is the same
// step with FRESH ids on every step and every condition rule/group, because
// steps and rules are addressed by id (reorder, drill, data-step-id) and two
// copies sharing ids would edit each other.
const KEY = "moduli-step-clipboard";
const EVENT = "moduli:step-clipboard";
let mem = null;

const freshId = () => Math.random().toString(36).slice(2, 9);

function reId(x) {
  if (Array.isArray(x)) return x.map(reId);
  if (!x || typeof x !== "object") return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) out[k] = k === "id" ? freshId() : reId(v);
  return out;
}

export function copyStep(step) {
  if (!step) return;
  mem = JSON.parse(JSON.stringify(step));
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* private window: memory only */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

export function readCopiedStep() {
  if (mem) return mem;
  try { const s = localStorage.getItem(KEY); if (s) mem = JSON.parse(s); } catch { mem = null; }
  return mem;
}

/** The copied step, ready to insert: fresh ids throughout. */
export function pasteableStep() {
  const s = readCopiedStep();
  return s ? reId(s) : null;
}

export function clearCopiedStep() {
  mem = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* ignore */ }
}

export const STEP_CLIPBOARD_EVENT = EVENT;
