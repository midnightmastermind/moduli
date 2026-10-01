// helpers/pastedImages.js — a picture pasted into a document becomes an image
// ARTIFACT, not a bare <img> node.
//
// User, 2026-10-01: *"the images in there arent artifacts … make sure all images
// are artifacts"*. Migration 0377 converted the 29 already in documents; this
// keeps new ones from arriving the old way. Pasting an article (or dropping its
// HTML) gave TipTap `image` nodes — invisible to the tree, search and covers.
// Each becomes a `moduleEmbed` of a freshly minted artifact, shaped as the
// importer makes one (role "artifact", kind "image", fileRef = the URL).

/** PURE: does this ProseMirror JSON contain an image node? */
export function hasImageNode(json) {
  if (!json || typeof json !== "object") return false;
  if (Array.isArray(json)) return json.some(hasImageNode);
  if (json.type === "image") return true;
  return hasImageNode(json.content);
}

/**
 * PURE: replace every image node in a JSON fragment with a moduleEmbed of the
 * occurrence `mint(src, alt)` returns. `mint` returning null leaves the image.
 */
export function imagesToEmbeds(json, mint) {
  const walk = (n) => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== "object") return n;
    if (n.type === "image" && n.attrs?.src) {
      const occId = mint(n.attrs.src, n.attrs.alt || "");
      return occId ? { type: "moduleEmbed", attrs: { occurrenceId: occId } } : n;
    }
    return Array.isArray(n.content) ? { ...n, content: walk(n.content) } : n;
  };
  return walk(json);
}

/** A meaningful caption, or none: a generic "Image" alt is not a name. */
export const imageLabel = (alt) => (alt && alt.trim() && alt.trim().toLowerCase() !== "image" ? alt.trim() : "");
