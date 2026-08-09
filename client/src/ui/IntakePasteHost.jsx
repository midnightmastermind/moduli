// ui/IntakePasteHost.jsx
//
// Task 3 Step 4 — Ctrl+V goes through the SAME classifier, sheet and router a
// drop does (user, 2026-08-07: "yes use control v"). Pasting a screenshot and
// dropping one now produce the same thing and ask the same question.
//
// ── WHY A HOST COMPONENT RATHER THAN A HANDLER SOMEWHERE ────────────────────
// Paste has no drop target: it is a document-level event with no pointer of its
// own. So something has to own the listener and resolve a destination, and the
// existing per-surface handlers are the wrong place — there are five of them and
// none is focused when you press Ctrl+V. Same reason `IntakeSheetHost` and
// `ImagePickerHost` exist.
//
// ── DESTINATION: THE MODEL THE CLIPBOARD ALREADY USES ───────────────────────
// `ClipboardDropOverlay` resolves a paste target by looking at what is under the
// POINTER (`elementsFromPoint`, container wins over page). A keyboard paste
// reuses that exact resolution against the last place the pointer was, which is
// in practice the surface the user is looking at. Deliberately NOT a second
// model: two different answers to "where does this land?" is how the drop path
// and the typed path drifted apart before.
//
// If nothing resolves — pointer over chrome, or never moved — the paste falls
// through to today's homeless-import behaviour rather than guessing at a page.
//
// ── WHAT THIS DOES NOT TOUCH ────────────────────────────────────────────────
// Anything editable. `shouldIgnorePaste` fails safe, and doc bodies keep
// ProseMirror's own paste handling by design: it understands its own schema, and
// routing it through intake would be a second, drifting copy of that.
import { useEffect } from "react";
import { toast } from "sonner";
import { useGridActions } from "../GridActionsContext";
import { classifyIntake } from "../helpers/intake";
import { applyIntakeShape, filterToImplemented } from "../helpers/intakeApply";
import { openIntakeSheet } from "./IntakeSheet";
import { shouldIgnorePaste, readClipboardPayload, hasIntakeContent } from "../helpers/intakePaste";

/** Last place the pointer was seen — the anchor a keyboard paste lands against. */
const pointer = { x: null, y: null };

/**
 * The clipboard overlay's resolution, reused verbatim: container beats page.
 * Exported for the browser probe; not part of the module's contract.
 */
export function resolvePasteTarget(x, y) {
  if (typeof document === "undefined" || !document.elementsFromPoint) return null;
  if (x == null || y == null) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el || el.nodeType !== 1) continue;
    const containerEl = el.closest("[data-occ-id][data-container-id]");
    if (containerEl) return { kind: "container", occId: containerEl.getAttribute("data-occ-id") };
    const pageEl = el.closest("[data-page-occ-id]");
    if (pageEl) return { kind: "page", occId: pageEl.getAttribute("data-page-occ-id") };
  }
  return null;
}

export default function IntakePasteHost() {
  const ctx = useGridActions();

  useEffect(() => {
    const onPointerMove = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const onPaste = (e) => {
      // Opt-in `[paste]` diagnostics, same posture as gapDiag/caretDiag: a
      // silent early return is indistinguishable from "no listener", which cost
      // one probe round already.
      const diag = typeof window !== "undefined" && window.__pasteDiag === true;
      const bail = (why, extra) => { if (diag) console.log(`[paste] skip why:${why}`, extra ?? ""); };

      if (shouldIgnorePaste(e.target)) return bail("editable-target");
      const payload = readClipboardPayload(e.clipboardData);
      if (!hasIntakeContent(payload)) return bail("empty-clipboard");

      const dest = resolvePasteTarget(pointer.x, pointer.y);
      const state = ctx?.getState?.() || ctx?.state || {};
      const gridId = state?.gridId || state?.grid?._id || null;
      const userId = state?.userId || null;
      if (!gridId || !userId) {
        return bail("no-grid-or-user", {
          hasGetState: typeof ctx?.getState === "function",
          hasStateKey: !!ctx?.state,
          stateKeys: Object.keys(state || {}).slice(0, 12),
        });
      }
      if (diag) console.log(`[paste] go`, { files: payload.files.length, dest });

      const occurrencesById = ctx?.getOccMap?.() || {};
      const destOcc = dest?.occId ? occurrencesById[dest.occId] : null;

      const classification = filterToImplemented(
        classifyIntake(
          { files: payload.files, text: payload.text, html: payload.html, url: payload.url },
          { kind: dest?.kind === "container" ? "board" : null, occurrenceId: dest?.occId || null },
        ),
      );

      const intakeCtx = {
        files: payload.files,
        payload: classification.payload,
        gridId, userId,
        dispatch: ctx?.dispatch, socket: ctx?.socket,
        destination: { parentId: dest?.occId || null },
        destinationOccurrence: destOcc,
        // Needed by TEXT_DOC_PAGE: the page mint flips the parent module's
        // `allowChildContainers`, writing its whole `meta` — passing the module
        // is what stops that write clobbering the rest of it.
        destinationModule: destOcc ? (ctx?.getModMap?.()?.[destOcc.moduleId] || null) : null,
        // A pasted import owns its own write (there is no `onImportText` here),
        // so without this a failed import is completely silent.
        onImportResult: (res) => {
          if (res?.ok) toast.success("Imported");
          else if (res) toast.error(`Import failed: ${res.error || "unknown error"}`);
        },
        // Same gap as the two drop sites: without this the OCR shapes report
        // nothing at all, and OCR is the slowest thing intake can do.
        onIntakeResult: (res) => {
          if (res?.ok) {
            const what = res.count ? `Read ${res.count} item${res.count === 1 ? "" : "s"}` : "Read the text";
            toast.success(res.note ? `${what} · ${res.note}` : what);
          } else if (res) {
            toast.error(res.error || "Could not read that");
          }
        },
        occExtra: () => (dest?.occId ? { parentId: dest.occId } : {}),
        persist: () => (dest?.occId ? { parentId: dest.occId } : null),
        containerOccurrenceId: dest?.kind === "container" ? dest.occId : null,
        // Placement stays with the host for the same reason it stays with the
        // drop handler: the router dispatches, the caller places.
        onPlaceholders: (placeholders) => {
          if (!destOcc) return;
          ctx?.dispatch && import("../helpers/CommitHelpers").then((CH) => {
            CH.updateOccurrence({
              dispatch: ctx.dispatch, socket: ctx.socket,
              occurrence: {
                id: destOcc.id,
                occurrences: [...(destOcc.occurrences || []), ...placeholders.map((p) => p.occurrenceId)],
              },
              emit: true,
            });
          });
        },
      };

      // Only now is the paste ours — claiming it earlier would swallow pastes we
      // then decline to handle.
      e.preventDefault();

      const opened = openIntakeSheet({
        classification,
        position: { top: (pointer.y ?? 80) + 8, left: (pointer.x ?? 80) + 8 },
        onPick: (shapeId) => applyIntakeShape(shapeId, intakeCtx),
        onCancel: () => {},
      });
      // No host mounted (a preview iframe, a harness) — do today's thing rather
      // than swallowing the paste.
      if (!opened) applyIntakeShape(classification.preselected, intakeCtx);
    };

    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("paste", onPaste);
    };
  }, [ctx]);

  return null;
}
