// ui/DeferredTile.jsx — a board tile that enters during a scroll draws its picture and name, and becomes the real row when
// the scroll settles (helpers/tileScheduler). It is the row's own box: the same class, the same id attributes, as a direct
// child of the list, so the wrap CSS, line measuring and a search jump all still find it.
import React, { useEffect, useRef, useState } from "react";
import { isScrollingNow, isTileWanted, scheduleTile } from "../helpers/tileScheduler";
import { resolveFileRef } from "../helpers/fileRef";
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel";
import { rememberDecoded, isDecoded } from "./LoadingImage";
import { tileImageSrc } from "../helpers/tileImage";
import { coverAppliesTo } from "../helpers/artifactCover";
import { primaryMediaOf } from "../helpers/occurrenceMedia";

/** The picture the real tile will show, so nothing changes when it swaps. `maps` reaches a poster held in a media field. */
function pictureOf(occurrence, module, maps) {
  if (occurrence?.meta?.cover) return resolveFileRef(occurrence.meta.cover);
  if (module?.kind === "image") {
    const ref = module.meta?.thumb256 || module.meta?.thumb1024 || module.fileRef; // what the card shows
    return ref ? resolveFileRef(ref) : null;
  }
  if (module?.meta?.cover && coverAppliesTo(module.kind, module.meta.cover)) return resolveFileRef(module.meta.cover);
  if (!maps || !occurrence) return null;
  const media = primaryMediaOf({ ...occurrence, moduleId: occurrence.moduleId ?? module?.id }, maps);
  return media?.kind === "image" ? media.src || null : null;
}

export function lightTilePicture(occurrence, module, maps = null) {
  return tileImageSrc(pictureOf(occurrence, module, maps));
}

// A tile the scroll is only passing asks for nothing, so the pictures of the tiles you stop on are not queued behind it.
export const LIGHT_PICTURE_DELAY_MS = 120;

function LightPicture({ src }) {
  const [show, setShow] = useState(() => isDecoded(src));
  useEffect(() => {
    if (show) return undefined;
    const t = setTimeout(() => setShow(true), LIGHT_PICTURE_DELAY_MS);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return <img className="instance-light-picture" src={src} alt="" decoding="async" onLoad={() => rememberDecoded(src)} />;
}

// One observer for every waiting tile: the ones on screen are built first.
const onScreen = new WeakSet();
let observer = null;
function watch(el) {
  if (typeof IntersectionObserver === "undefined" || !el) return () => {};
  if (!observer) observer = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target); }
  });
  observer.observe(el);
  return () => observer.unobserve(el);
}

export default function DeferredTile({ occurrence, module, height, getMaps, onReady, children }) {
  const [ready, setReady] = useState(() => !isScrollingNow() || isTileWanted(occurrence?.id));
  const ref = useRef(null);
  useEffect(() => {
    if (ready) return undefined;
    const unwatch = watch(ref.current);
    const cancel = scheduleTile(() => { setReady(true); onReady?.(); }, () => (ref.current ? onScreen.has(ref.current) : false), occurrence?.id);
    return () => { unwatch(); cancel(); };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ready) return children;
  const src = lightTilePicture(occurrence, module, getMaps?.() || null);
  return (
    <div
      ref={ref}
      data-instance-id={module?.id}
      data-occurrence-id={occurrence?.id}
      data-testid="instance-wrap"
      className="instance-wrap instance-wrap--light"
      style={height ? { minHeight: `${height}px` } : undefined}
    >
      <div className="instance-row">
        {src && <LightPicture src={src} />}
        <div className="instance-light-label">{occurrenceDisplayLabel(occurrence, module, "")}</div>
      </div>
    </div>
  );
}
