// services/importSource.js
//
// What a share imports as (IMPORT_TO_PAGE). Pure: a `$share` (services/shareIngress.prepareShare) in,
// an importPipeline source out, or null when the share holds nothing to make a page from.
//   link   the address the preview landed on, else the shared one, else a clipped page's own address
//   image  the stored picture's occurrence (ingress uploaded it into Files before any rule ran)
//   text   the shared text (or a page's selected text), titled by what the sender called it

const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

export function shareImportSource(share) {
  if (!share || typeof share !== "object") return null;
  const props = share.props || {};
  if (share.type === "link") {
    const url = [props.finalUrl, props.url, share.clip?.moduleFileRef].find(isHttp);
    return url ? { kind: "link", url } : null;
  }
  if (share.type === "image") {
    return props.occurrenceId ? { kind: "image", imageOccurrenceId: props.occurrenceId } : null;
  }
  if (share.type === "text" || share.type === "html") {
    const text = String(props.text || "").trim();
    // A text share has no title of its own; ingress named it by its first line (shareLabelFor).
    return text ? { kind: "text", text, title: props.title || share.label || null } : null;
  }
  return null;
}
