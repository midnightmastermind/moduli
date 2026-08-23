// helpers/textmapEmbeds.js
//
// "Which occurrences does this body DRAW?"
//
// A doc renders its TEXTMAP, and the nodes in that textmap reference other
// occurrences by id — `moduleEmbed`, `instanceTextblock`, the inline variant.
// That is a THIRD way to reach an occurrence, alongside a parent's
// `occurrences[]` and a child's `parentId`, and it is the one every scan in this
// repo has forgotten at least once (2026-08-07 (8) mislabelled 213 live files as
// dead for exactly this reason).
//
// Measured on the live grid 2026-08-23: **474 embeds across 233 hosts are
// reachable ONLY through a textmap.** A consumer that walks the child list and
// stops — `PagePreviewApp` did — is missing them, and `ModuleEmbedNode` paints
// `embed: <uuid>` in a dashed box wherever it cannot resolve one.

/** Node types that name another occurrence. */
const EMBED_TYPES = /embed|textblock/i;

/**
 * Every occurrence id referenced by a textmap's nodes.
 * PURE, and tolerant: a textmap arrives as a TipTap doc, but a compressed or
 * malformed one must return nothing rather than throw inside a render.
 */
export function collectEmbeddedIds(textmap) {
  const out = new Set();
  if (!textmap || typeof textmap !== "object") return out;   // compressed string, null
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 60) return;
    if (EMBED_TYPES.test(String(node.type || ""))) {
      const id = node.attrs?.occurrenceId || node.attrs?.id;
      if (typeof id === "string" && id) out.add(id);
    }
    const kids = node.content;
    if (Array.isArray(kids)) for (const k of kids) walk(k, depth + 1);
  };
  walk(textmap, 0);
  return out;
}

/**
 * Grow `seen` with everything the seen occurrences' bodies draw, transitively —
 * an embedded doc can embed further docs.
 * Mutates and returns `seen`, matching how the caller's other passes work.
 */
export function expandByEmbeds(seen, occById) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const id of [...seen]) {
      const occ = occById[id];
      if (!occ) continue;
      for (const ref of collectEmbeddedIds(occ.textmap)) {
        // Only ids that resolve. An embed pointing at a deleted occurrence is
        // its own defect (`0205`) and adding a phantom id here would make the
        // preview's module lookup miss instead of simply not drawing it.
        if (!seen.has(ref) && occById[ref]) { seen.add(ref); changed = true; }
      }
    }
  }
  return seen;
}
