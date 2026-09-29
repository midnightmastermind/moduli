// client/src/helpers/sharePlacement.js
//
// Form state → the body `POST /share` receives, for the share placement window.
//
// Pure, and separate from the window, because this is where a wrong answer is
// INVISIBLE: the screen would look correct and write the wrong row.
import { resolveMapping } from "./shareMapping.js";
import { KIND_TILE } from "./kindTiles.js";

// The override list — what a clip can be when it is NOT like its neighbours.
// Labels come from the + menu's own table so the two vocabularies cannot drift;
// "bookmark" is the one the menu has no tile for (you cannot quick-add a
// bookmark, only clip one). `fileFrom` names which clip URL the row IS.
export const CLIP_KINDS = [
  { value: "bookmark",  role: "artifact",  kind: "bookmark", fileFrom: "url",      label: "Bookmark",  desc: "A saved link" },
  { value: "textblock", role: "textblock", kind: "doc",      fileFrom: null,       label: KIND_TILE.textblock.label, desc: KIND_TILE.textblock.desc },
  { value: "image",     role: "artifact",  kind: "image",    fileFrom: "imageUrl", label: KIND_TILE.image.label,     desc: KIND_TILE.image.desc },
];

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * The staged payload → the clip the mapping sources read.
 *
 * The extension stages its GESTURE: `url` is the page for a page clip, the
 * link for a link clip, the image for an image clip — and the page it was on
 * rides along as `clip.meta.clippedFrom`. The sources ("page URL", "link URL",
 * "image source") need those told apart, or "page URL" on a link clip would
 * read the link.
 */
export function clipFromStage(payload = {}) {
  const shape = payload.shape || null;
  const url = payload.url || "";
  const page = payload.clip?.meta?.clippedFrom || url;
  // The TITLE is the tab's for a page clip — and only for a page clip. On a
  // link, image or selection the tab is the page it was clicked ON, so its
  // title names the wrong thing; the extension's record carries the label it
  // derived for the clicked item (the link's text, the image's alt).
  const title = shape && shape !== "page"
    ? (payload.clip?.label || payload.label || payload.title || "")
    : (payload.title || payload.label || payload.clip?.label || "");
  return {
    shape,
    title,
    url: page,
    linkUrl: shape === "link" ? url : "",
    imageUrl: shape === "image" ? url : "",
    selection: payload.text || "",
    siteName: hostOf(page),
    description: payload.description || "",
  };
}

/**
 * The shape a new row takes in this destination: the one its rows already
 * have, read by the server off the destination's own children
 * (`destination.shape`). This is what the app's own `+` does —
 * `siblingFieldBindings` pre-ticks whatever the siblings bind — and it is why
 * "add it as a movie" works at all: a movie is `artifact/movie` with six
 * bindings, not a primitive anyone could have picked from a list.
 */
export function shapeFromDestination(destination) {
  const s = destination?.shape;
  if (!s) return { role: "instance", kind: null, bindingsLike: null, bindFields: [], autoFields: {}, fileFrom: null };
  return {
    role: s.role || "instance",
    kind: s.kind || null,
    bindingsLike: s.moduleId || null,
    bindFields: Array.isArray(s.bindFields) ? s.bindFields : [],
    autoFields: s.autoFields || {},
    fileFrom: null,
  };
}

/** A CLIP_KINDS entry → a shape. The override drops the siblings' bindings. */
export function shapeFromKind(value) {
  const k = CLIP_KINDS.find((c) => c.value === value);
  if (!k) return null;
  return { role: k.role, kind: k.kind, bindingsLike: null, bindFields: [], autoFields: {}, fileFrom: k.fileFrom };
}

/**
 * The rows the shape implies, marked `auto`. `raw` keeps the stored type (a
 * multi-select holds `["movie"]`), so the row writes what its siblings hold
 * rather than the string the box displays.
 */
export function autoMappings(shape) {
  const out = {};
  for (const [fieldId, raw] of Object.entries(shape?.autoFields || {})) {
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    out[fieldId] = { source: "literal", value, raw, auto: true };
  }
  return out;
}

/** What one row will write: the edited box, else a typed auto value, else the resolved string. */
export function mappingValue(clip, mapping) {
  if (!mapping) return "";
  if (mapping.override != null) return String(mapping.override);
  if (mapping.raw !== undefined && mapping.source === "literal") return mapping.raw;
  return resolveMapping(clip, mapping);
}

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

/**
 * The whole request body. Throws rather than sending a manual share nowhere.
 *
 * NO CONTENT KEYS: the window commits through its stage key, and the server
 * reads the clip's content from the STAGE — the body only chooses where it
 * goes and what it becomes.
 */
export function buildSharePayload({ gridId, mode, stageId, stageKey, destination, shape, mappings, labelMapping, clip }) {
  const base = { mode, stageId, stageKey, ...(gridId ? { gridId } : null) };
  if (mode !== "manual") return base;
  if (!destination?.id) throw new Error("a manual placement needs a destination");
  const fields = {};
  for (const [fieldId, m] of Object.entries(mappings || {})) {
    const v = mappingValue(clip, m);
    if (!isEmpty(v)) fields[fieldId] = v;
  }
  const label = labelMapping ? String(mappingValue(clip, labelMapping) || "") : "";
  const fileRef = shape?.fileFrom ? clip?.[shape.fileFrom] || null : null;
  // Bound but empty still binds: that is how a row reaches an op that gates on
  // `_boundFieldIds` rather than on a value.
  const bindFields = [...new Set([...(shape?.bindFields || []), ...Object.keys(mappings || {})])];
  return {
    ...base,
    placement: {
      parentId: destination.id,
      role: shape?.role || "instance",
      kind: shape?.kind || null,
      ...(label ? { label } : null),
      ...(fileRef ? { fileRef } : null),
      ...(shape?.bindingsLike ? { bindingsLike: shape.bindingsLike } : null),
      ...(bindFields.length ? { bindFields } : null),
      fields,
    },
  };
}
