// modules/TextblockCard.jsx
// Renderer for role:"textblock" modules in a container.
// Wraps the existing <Editor> on occurrence.textmap. Saves are debounced through
// Editor's existing onChange → updateOccurrence path (same as DocContent).
import React, { useContext } from "react";
import Editor from "../ui/Editor.jsx";
import { GridActionsContext } from "../GridActionsContext";

export default function TextblockCard({ occurrence }) {
  const { dispatch, socket } = useContext(GridActionsContext);
  return (
    <div className="textblock-card">
      <Editor
        occurrence={occurrence}
        content={occurrence?.textmap && typeof occurrence.textmap === "object" ? occurrence.textmap : null}
        dispatch={dispatch}
        socket={socket}
        placeholder="Type…"
      />
    </div>
  );
}
