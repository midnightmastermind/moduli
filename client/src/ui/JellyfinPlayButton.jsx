// ui/JellyfinPlayButton.jsx — the Play button on a Jellyfin-linked card (movie / episode / documentary).
// Renders nothing on an instance the sync never linked (no meta.jellyfinId). Stops the click so the card's
// own viewer / drag handling never starts from it.
import React from "react";
import { Play } from "lucide-react";
import { isPlayableRow } from "../helpers/jellyfinPlay";

export function JellyfinPlayButton({ occurrence, onPlay }) {
  if (!isPlayableRow(occurrence)) return null;
  const stop = (e) => e.stopPropagation();
  return (
    <button
      type="button"
      aria-label="Play"
      title="Play"
      className="jellyfin-play-btn"
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onClick={(e) => { e.stopPropagation(); onPlay?.(); }}
    >
      <Play size={14} />
      <span>Play</span>
    </button>
  );
}

export default JellyfinPlayButton;
