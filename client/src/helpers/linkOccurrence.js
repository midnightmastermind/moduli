// helpers/linkOccurrence.js
//
// Task 5 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// the `link → chip` shape. PURE: no React, no writes, no socket.
//
// ── THE ONE RULE THIS FILE EXISTS TO KEEP ───────────────────────────────────
//
// The plan says it outright: **do not mint a second link representation.** A
// link chip already has an authoritative shape — `buildInlineLink` inside
// `server/services/markdownImporter.js`, which every imported page's prose
// links are built from, and which `TextblockCard` / `InstanceTextblockInlineNode`
// already know how to render. A drop must produce THAT, byte for byte, or the
// app ends up with two kinds of link that look alike and behave differently
// (and Task 6's relink would only ever find one of them).
//
// So this is the **client twin of `buildInlineLink`** — the same relationship
// `helpers/alarmOps.buildAlarmOperation` has with `utils/liveSystemBuilders
// .makeAlarmOp`. **The twins must be kept in sync**; the shape is pinned by
// `__tests__/linkOccurrence.test.js` so a divergence fails loudly.
//
// ── THE ONE THING THAT IS NOT COPIED: `kind` ────────────────────────────────
//
// The importer only ever builds `kind: "inline"` chips, because it is always
// writing INTO a paragraph. A drop is not: dropped on a board it becomes a row,
// dropped in a doc body it flows in the sentence. `inline` is therefore a
// parameter rather than a constant — see `linkOccurrenceShape`.

/**
 * A dropped URL carries no link text, so the label has to come from the URL.
 *
 * Mirrors the importer's `deriveLinkLabel`: prefer the given text, else the
 * last meaningful path segment (for `/wiki/X` the slug IS the article name),
 * else the host. A chip labelled with a raw URL is exactly the outcome the
 * intake audit called out as the thing to replace.
 */
export function deriveLinkLabel(label, url) {
  const t = String(label || "").trim();
  if (t) return t;
  const u = String(url || "").trim();
  if (!u) return "Link";

  // Strip the scheme and host FIRST. Matching a "last path segment" against the
  // whole URL picks up the HOST on a bare domain (`https://www.example.com` →
  // "www.example.com"), which is a worse label than the host itself and reads
  // like a bug to anyone who sees it.
  const path = u.replace(/^https?:\/\/[^/?#]*/i, "").replace(/[?#].*$/, "");
  const m = path.match(/\/wiki\/([^/]+)\/?$/) || path.match(/\/([^/]+)\/?$/);
  if (m && m[1]) {
    let seg = m[1];
    try { seg = decodeURIComponent(seg); } catch { /* a malformed escape is not worth failing over */ }
    seg = seg.replace(/_/g, " ").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
    if (seg) return seg;
  }
  return hostOf(u) || u;
}

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./i, "") : "";
}

/**
 * What makes a textblock a LINK CHIP — the fields `buildInlineLink` sets,
 * and nothing else.
 *
 * **It deliberately mints no ids and no parentage.** `CommitHelpers
 * .createTextblockInContainer` already owns that, and it also stamps the
 * destination's filter values onto the new row — without which a link dropped
 * on today's column is born with no date and is invisible to the filter (the
 * class this repo fixed for artifacts on 2026-08-07). A parallel mint path here
 * would silently skip it.
 *
 * `meta.link` is returned for BOTH the module and the occurrence, exactly as
 * the importer writes it. That is not redundancy to tidy up: the module carries
 * it so a fresh PLACEMENT of the same chip still resolves, the occurrence
 * carries it so one placement can be re-pointed (`InstanceForm`'s Link section
 * writes the occurrence's copy) without touching every other use.
 *
 * @param {{ url: string, label?: string, inline?: boolean }} args
 * @returns {{ kind: string, label: string, meta: object, textmap: object }}
 */
export function linkChipShape({ url, label = "", inline = false }) {
  const link = { kind: "url", url: String(url || "") };
  const display = deriveLinkLabel(label, url);
  return {
    // A doc body wants a chip that flows in the sentence; a board row wants a
    // card. Same data either way — only the renderer differs.
    //
    // **The non-inline kind is `"doc"`, not `"block"`.** `TextblockCard` asks
    // `module.kind === "inline"` and treats everything else as the card form,
    // and every other textblock minted in this app (`Editor`'s make-mini-block,
    // `convertOccurrence`, `createTextblockInContainer`) uses `"doc"`.
    // Inventing a third value would render fine — right up until something
    // switched on the kind.
    kind: inline ? "inline" : "doc",
    label: display,
    meta: { link },
    textmap: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: display }] }],
    },
  };
}
