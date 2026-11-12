// helpers/carriedBody.js — a copy of a row shows the row's own notes.
//
// A row's notes drawer draws the row's textmap (textblocks embedded in it). A copy (copy-link drag, feed copy, an
// operation's COPY_LINK) was minted with NO textmap, so the CPS Class rows the Schedule shows had empty notes while
// the original in Tasks › Appointments held the meeting links — and saving an empty copy fanned its empty body over
// the original (server/socketHandlers/occurrences.textmapFansTo now refuses that). The copy embeds the SAME
// textblocks, so an edit in either place is one edit.
//
// Only for a copy with no children of its own: a container's body embeds its children, and its copy gets NEW
// children, so the source's embeds would point at the wrong rows.

const hasContent = (n) => {
  if (!n || typeof n !== "object") return false;
  if (n.type === "text") return !!(n.text && n.text.trim());
  if (n.type && n.type !== "doc" && n.type !== "paragraph" && n.type !== "hardBreak") return true;
  return (n.content || []).some(hasContent);
};

/** `{ textmap }` to spread onto a copy of `src`, or `{}`. */
export function carriedBody(src, { copiesChildren = false } = {}) {
  if (!src || copiesChildren) return {};
  const tm = src.textmap;
  if (!tm || typeof tm !== "object" || tm.type !== "doc" || !hasContent(tm)) return {};
  return { textmap: JSON.parse(JSON.stringify(tm)) };
}
