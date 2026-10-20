// modules/FileBody.jsx
//
// A file occurrence's BODY (user, 2026-10-17): a little doc under the file, like an instance's body,
// opened from the row's chevron (a drawer under it) — and, when the file is OPEN (its page in a
// panel, or its tile in the viewer), from a Notes button that puts it NEXT TO the file.
//
// The body is the file occurrence's own `textmap`, exactly as an instance's body is (DocContent on
// the occurrence), so typing in it makes textblocks under the doc rules. A file whose text already IS
// its content (a markdown note, a quote card) has no body: it would show the same text twice — the
// same reason a textblock has none.
import React from "react";
import { NotebookPen, X } from "lucide-react";
import { DocContent } from "./DocContent.jsx";

const TEXT_KINDS = new Set(["markdown", "quote"]);

/** Does this module's occurrence carry a separate body? Files only, and not the text-only kinds. */
export function fileHasBody(module) {
  return module?.role === "artifact" && !TEXT_KINDS.has(module?.kind);
}

/** The body itself, in the same recessed pocket an instance's open body sits in. */
/** The × in a notes section's corner: closes it, the same as pressing its toggle again
 *  (user 2026-10-20: "we need an x button on that notes section so it closes the drawer"). */
export function NotesCloseButton({ onClose }) {
  if (!onClose) return null;
  return (
    <button
      type="button"
      className="notes-close-btn"
      aria-label="Close notes"
      title="Close notes"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <X style={{ width: 12, height: 12 }} />
    </button>
  );
}

export function FileNotesEditor({ occurrence, dispatch, socket, className = "", onClose = null }) {
  if (!occurrence) return null;
  return (
    <div className={`instance-doc-body file-notes-body ${className}`.trim()} data-testid="file-notes-body">
      <NotesCloseButton onClose={onClose} />
      <DocContent occurrence={occurrence} dispatch={dispatch} socket={socket} hideToolbar={true} />
    </div>
  );
}

/** The header button that shows the body beside an open file. */
export function FileNotesToggle({ open, onToggle, className = "", style }) {
  return (
    <button
      type="button"
      className={`file-notes-toggle ${className}`.trim()}
      aria-pressed={!!open}
      aria-label={open ? "Hide notes" : "Show notes"}
      title={open ? "Hide notes" : "Notes beside the file"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
      style={style}
    >
      <NotebookPen style={{ width: 13, height: 13 }} />
    </button>
  );
}
