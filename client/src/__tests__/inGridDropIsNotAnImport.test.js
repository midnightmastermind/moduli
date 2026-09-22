// __tests__/inGridDropIsNotAnImport.test.js
//
// EVERY in-grid drag that landed ALSO ran the external-text import path,
// minting a duplicate instance labelled with the dragged row's own text.
// Measured on prod 2026-09-22, one drag of "Wake Up" into another container,
// frames in order:
//
//   t=5758  create_occurrence                  <- the real drop (copy-link)
//   t=5784  native drop  text/plain="Wake Up"  <- the grid-frame listener
//   t=5788  create_module   "Wake Up"          <- the import path
//   t=5816  create_occurrence                  <- ...and its occurrence
//
// `DragProvider`'s grid-frame `onDrop` bails only on
// `if (!hasFiles && !html && !text) return;` — and Pragmatic DnD puts the
// dragged item's LABEL in `text/plain`, so `text` is never empty for an
// in-grid drag and the guard cannot fire. The drop was then handed to
// handleExternalDrop as if the row's label had been pasted in from another
// tab.
//
// Its SIBLING `onDragOver`, ten lines above, already guards this exact case
// twice over — `sessionRef.current.dragging` and `NATIVE_DND_MIME` — which is
// why the import PREVIEW never appeared during an in-grid drag while the drop
// still fired. `ui/Editor.jsx` carries the same NATIVE_DND_MIME guard. Only
// `onDrop` was missing it.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NATIVE_DND_MIME } from "../helpers/dragSystem";

const SRC = fs.readFileSync(path.join(__dirname, "../helpers/DragProvider.jsx"), "utf8");

/** The body of the grid-frame `onDrop` handler. */
function onDropBody() {
  const at = SRC.indexOf("const onDrop = (e) => {");
  expect(at, "grid-frame onDrop handler not found").toBeGreaterThan(-1);
  return SRC.slice(at, SRC.indexOf("\n    };", at));
}

describe("an in-grid drag is not treated as an external import", () => {
  it("onDrop bails on the app's own drag mime", () => {
    expect(onDropBody(), "onDrop must skip drops carrying NATIVE_DND_MIME")
      .toMatch(/NATIVE_DND_MIME/);
  });

  it("onDrop also bails while an internal drag session is active", () => {
    // Defense in depth, and the reason onDragOver carries BOTH: Pragmatic
    // writes its external dataTransfer lazily, so the mime can be absent on
    // the first events of a drag.
    expect(onDropBody(), "onDrop must skip while sessionRef reports a drag")
      .toMatch(/sessionRef\.current\??\.dragging/);
  });

  it("the sibling onDragOver still has both guards", () => {
    // The CONTROL. These two handlers must agree; the bug was the asymmetry.
    const at = SRC.indexOf("const onDragOver = (e) => {");
    const body = SRC.slice(at, SRC.indexOf("\n    };", at));
    expect(body).toMatch(/sessionRef\.current\??\.dragging/);
    expect(body).toMatch(/NATIVE_DND_MIME/);
  });

  it("still handles a real external drop — text with no app mime", () => {
    // The other CONTROL: "ignore in-grid drags" must not be satisfied by a
    // handler that ignores everything. The text/file branches must survive.
    const body = onDropBody();
    expect(body).toMatch(/hasFiles/);
    expect(body).toMatch(/text\/html/);
  });

  it("the mime is the one the drag actually sets", () => {
    // Pinning the constant rather than a literal: the measured drop carried
    // types ["text/plain", "application/vnd.pdnd", NATIVE_DND_MIME].
    expect(NATIVE_DND_MIME).toBe("application/x-daytracker-dnd");
  });
});
