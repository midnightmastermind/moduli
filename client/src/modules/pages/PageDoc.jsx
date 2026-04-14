// modules/pages/PageDoc.jsx
// Doc page — full-width TipTap editor in a scroll wrapper.
import React from "react";
import { DocEditorShell } from "../DocContent.jsx";

export default function PageDoc({ occurrence, dispatch, socket, scrollAnchor }) {
  return (
    <div
      draggable={false}
      style={{
        flex: 1, minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
      }}
    >
      <DocEditorShell
        occurrence={occurrence}
        dispatch={dispatch}
        socket={socket}
        scrollAnchor={scrollAnchor}
      />
    </div>
  );
}
