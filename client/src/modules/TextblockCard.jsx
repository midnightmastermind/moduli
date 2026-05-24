// modules/TextblockCard.jsx
// Renderer for role:"textblock" modules in a container.
// Wraps the existing <Editor> on occurrence.textmap. Saves are debounced through
// Editor's existing onChange → updateOccurrence path (same as DocContent).
//
// `kind:"inline"` variant (task #6.6 / LT1 — 2026-05-24): textblock-inline
// renders WITHOUT card chrome — no border, no margin, no padding. The Editor
// shell stays but its block-handle + drag-grip affordances are suppressed
// (via `mode="inline"`) so the block flows seamlessly inline with surrounding
// text. Created via QuickAddMenu's textblock entry when kind:"inline" is
// picked, or via right-click "convert highlight to inline-textblock".
import React, { useContext } from "react";
import Editor from "../ui/Editor.jsx";
import { GridActionsContext } from "../GridActionsContext";

export default function TextblockCard({ occurrence, module }) {
  const { dispatch, socket } = useContext(GridActionsContext);
  const isInline = module?.kind === "inline";
  return (
    <div className={isInline ? "textblock-card textblock-card--inline" : "textblock-card"}>
      <Editor
        occurrence={occurrence}
        content={occurrence?.textmap && typeof occurrence.textmap === "object" ? occurrence.textmap : null}
        dispatch={dispatch}
        socket={socket}
        placeholder="Type…"
        mode={isInline ? "inline" : "doc"}
      />
    </div>
  );
}
