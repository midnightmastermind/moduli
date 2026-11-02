// ui/JellyfinPlayButton.jsx — the Play button on a Jellyfin-linked card (movie / episode / documentary).
// Renders nothing on an instance the sync never linked (no meta.jellyfinId). Stops the click so the card's
// own viewer / drag handling never starts from it.
import React from "react";
import { Play, SkipForward } from "lucide-react";
import { isPlayableRow } from "../helpers/jellyfinPlay";
import { isShowOrSeasonRow } from "../helpers/nextUnwatched";

// On a TV Series / Season row (Board Category series / season) the button is "Play next" — the first unwatched
// episode (helpers/nextUnwatched) — when the caller passes `onPlayNext` and the grid's `fieldsById`.
export function JellyfinPlayButton({ occurrence, onPlay, onPlayNext, fieldsById }) {
  if (!isPlayableRow(occurrence)) return null;
  const next = !!onPlayNext && isShowOrSeasonRow(occurrence, fieldsById);
  const stop = (e) => e.stopPropagation();
  return (
    <button
      type="button"
      aria-label={next ? "Play next unwatched" : "Play"}
      title={next ? "Play next unwatched" : "Play"}
      className="jellyfin-play-btn"
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onClick={(e) => { e.stopPropagation(); (next ? onPlayNext : onPlay)?.(e.currentTarget); }}
    >
      {next ? <SkipForward size={14} /> : <Play size={14} />}
      <span>{next ? "Play next" : "Play"}</span>
    </button>
  );
}

export default JellyfinPlayButton;
