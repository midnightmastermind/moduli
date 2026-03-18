export const NATIVE_DND_MIME = "application/x-daytracker-dnd";

let _ghostEl = null;

function ensureGhost() {
  if (_ghostEl) return _ghostEl;
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-10000px";
  el.style.top = "-10000px";
  el.style.pointerEvents = "none";
  el.style.padding = "6px 10px";
  el.style.borderRadius = "8px";
  el.style.fontSize = "12px";
  el.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
  el.style.background = "rgba(20,20,20,0.9)";
  el.style.color = "white";
  el.style.border = "1px solid var(--border-default)";
  document.body.appendChild(el);
  _ghostEl = el;
  return el;
}

export function setNativeDragImage(e, label) {
  try {
    const el = ensureGhost();
    el.textContent = label || "Dragging…";
    // offset so cursor isn’t dead center
    e.dataTransfer?.setDragImage?.(el, 12, 12);
  } catch {
    // ignore
  }
}

export function setNativePayload(e, payload) {
  try {
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData(NATIVE_DND_MIME, JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", payload?.meta?.label || "");
  } catch {
    // ignore
  }
}
