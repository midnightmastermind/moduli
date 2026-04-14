// modules/pages/PageDisplay.jsx
// Display page — artifact viewer (markdown, image, PDF, audio, video, code, etc.)
import React from "react";
import Artifact from "../Artifact.jsx";

export default function PageDisplay({ occurrence, pageView, dispatch, socket }) {
  return (
    <Artifact
      occurrence={occurrence}
      viewType={pageView?.viewType ?? "display"}
      artifactType={pageView?.artifactType ?? null}
      dispatch={dispatch}
      socket={socket}
      view={pageView}
    />
  );
}
