// ui/PlaceMedia.jsx — a <video> / <audio> that remembers where it was left (hooks/useMediaPlace).
// `moduleId` is the FILE's module; without one it is a plain element.
import React from "react";
import useMediaPlace from "../hooks/useMediaPlace";

export default function PlaceMedia({ as = "video", moduleId, ...props }) {
  const ref = useMediaPlace(moduleId);
  const Tag = as === "audio" ? "audio" : "video";
  return <Tag ref={ref} {...props} />;
}
