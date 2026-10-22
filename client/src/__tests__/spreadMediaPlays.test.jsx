// AUDIO AND VIDEO IN THE VIEWER PLAY WHERE THEY ARE.
// User, 2026-10-17: "i needed to click twice when the video was in the viewer for it to play (opens it
// up in another popup)" · the audio should have the waveform "like when you view the file in panel and
// also center it". In the viewer a video tile is a player with controls (no full-screen step) and an
// audio tile is the waveform; outside the viewer both stay thumbnails.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const STATE = {
  dispatch: vi.fn(), grid: {}, state: { grid: {} }, socket: {},
  getOcc: (id) => ({ id }), getOccMap: () => ({}), foldersById: {}, modulesById: {}, viewsById: {},
  occurrencesById: {}, fieldsById: {}, getState: () => ({ grid: {} }), getViewMap: () => ({}),
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));
vi.mock("../modules/AudioWaveform.jsx", () => ({
  default: (props) => React.createElement("div", { "data-testid": "waveform", "data-src": props.src }),
}));
const openArtifactSpread = vi.fn();
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: (...a) => openArtifactSpread(...a) }));

import ArtifactCard from "../modules/ArtifactCard";
import { InSpreadContext } from "../helpers/spreadDock";

const video = { id: "m-v", role: "artifact", kind: "video", label: "clip.mp4", fileRef: "gdrive:c:v" };
const audio = { id: "m-a", role: "artifact", kind: "audio", label: "ep.mp3", fileRef: "gdrive:c:a" };
const occ = (id) => ({ id, moduleId: id });
const inSpread = (ui) => render(<InSpreadContext.Provider value={true}>{ui}</InSpreadContext.Provider>);

describe("viewer media tiles", () => {
  it("a video in the viewer is a player with controls, and a click does not open the full-screen card", () => {
    const { container } = inSpread(<ArtifactCard module={video} occurrence={occ("o-v")} />);
    const v = container.querySelector("video");
    expect(v).toBeTruthy();
    expect(v.hasAttribute("controls")).toBe(true);
    expect(v.muted).toBe(false);
    fireEvent.click(v);
    expect(container.querySelector(".artifact-card--expanded")).toBeNull();
    expect(document.querySelector(".artifact-card--expanded")).toBeNull();
  });

  it("an audio file in the viewer shows the waveform", () => {
    const { getByTestId } = inSpread(<ArtifactCard module={audio} occurrence={occ("o-a")} />);
    expect(getByTestId("waveform").dataset.src).toContain("/files/c/a");
  });

  // INVERTED 2026-10-22. This said a video outside the viewer stays a muted, control-less frame whose
  // click opens the viewer. User: "i just would like to embed a video that plays right there" — so a video
  // card on a doc or board is a player now, like the audio card always was. Audio still gets no waveform.
  it("outside the viewer a video plays in place; audio gets no waveform", () => {
    const { container, queryByTestId } = render(<ArtifactCard module={video} occurrence={occ("o-v")} />);
    const v = container.querySelector("video");
    expect(v.hasAttribute("controls")).toBe(true);
    expect(v.muted).toBe(false);
    fireEvent.click(v);
    expect(openArtifactSpread).not.toHaveBeenCalled();
    const a = render(<ArtifactCard module={audio} occurrence={occ("o-a")} />);
    expect(a.queryByTestId("waveform")).toBeNull();
    expect(queryByTestId("waveform")).toBeNull();
  });

  // Control: the folder-page preview card shares the thumbnail code and must stay a still frame — a click
  // there opens the item, and a player would swallow it.
  it("the folder-page preview face stays a still frame", async () => {
    const { ArtifactThumbnail } = await import("../modules/ArtifactCard");
    const { container } = render(<ArtifactThumbnail module={video} occurrence={occ("o-v")} />);
    expect(container.querySelector("video").hasAttribute("controls")).toBe(false);
  });
});
