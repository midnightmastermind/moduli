// helpers/domAudit.js
//
// WHERE ARE THE 20,000 DOM NODES?
//
// Every remaining drag/scroll cost this file has failed to attribute lands on
// the same suspect and has never been measured: the document is ~20,000
// elements, and style/layout/paint scale with it. 2026-09-02 measured a settled
// drag with ZERO op sweeps and 136 renders still spending 5,756ms inside long
// tasks, and a 220ms lift timer arriving at 1213ms — starvation with nothing of
// ours running.
//
// "Reduce the DOM" is not actionable. "The schedule day column is 5,871 nodes,
// 29% of the page" is (2026-08-26 (5) measured exactly that, once, by hand).
// This makes that census repeatable and reachable from the device.
//
// IT COUNTS, IT DOES NOT JUDGE. Every threshold here would be a guess — what a
// row "should" cost depends on what it renders. So it reports totals, the
// heaviest subtrees, and the per-instance cost of each repeated structure, and
// leaves the decision to whoever reads it.

const TAG_LIMIT = 12;
const SUBTREE_LIMIT = 15;
const CLASS_LIMIT = 15;

/** A short, stable name for a subtree root: its most identifying class, else its tag. */
function labelOf(el) {
  const cls = (el.getAttribute?.("class") || "").split(/\s+/).filter(Boolean);
  // The app's own structural classes are the useful ones; utility classes
  // (Tailwind) are noise here and are far more numerous, so a known prefix wins.
  const structural = cls.find((c) => /^(container|instance|panel|page|module|artifact|doc|field|mobile|grid|insert)-/.test(c));
  const tag = el.tagName?.toLowerCase() || "?";
  // The bare-tag fallback is a SAFETY NET, not a live branch: every class in
  // the root list below carries one of the prefixes above, so today it never
  // fires. It is here so adding a root with a new prefix degrades to a usable
  // name instead of throwing, and it is not counted as covered.
  return structural ? `${tag}.${structural}` : tag;
}

/**
 * Census of the live document.
 *
 * `subtrees` is the honest core: for each repeated structure it reports how
 * many exist, the TOTAL nodes they account for, and the median cost of one —
 * which is what says whether the fix is "fewer rows" or "a lighter row".
 * Subtree totals OVERLAP by nesting and the report says so, because summing
 * them and comparing to the total is the obvious mistake.
 */
export function auditDom(root = document.body) {
  if (typeof document === "undefined" || !root) return null;
  const all = root.getElementsByTagName("*");
  const total = all.length;

  const byTag = new Map();
  const byClass = new Map();
  const bySubtree = new Map();   // label -> number[] of subtree sizes

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    byTag.set(tag, (byTag.get(tag) || 0) + 1);
    const cls = (el.getAttribute("class") || "").split(/\s+/);
    for (const c of cls) {
      if (!c) continue;
      byClass.set(c, (byClass.get(c) || 0) + 1);
    }
  }

  // Repeated structures: anything the app names structurally. Counting the
  // subtree of every element would be O(n^2); only these roots are measured.
  const roots = root.querySelectorAll(
    ".container-shell, .instance-wrap, .panel-shell, .artifact-card, " +
    ".doc-editor, .instance-fields, .container-list, .field-pill, .insert-gap"
  );
  for (const el of roots) {
    const label = labelOf(el);
    const size = el.getElementsByTagName("*").length + 1;
    if (!bySubtree.has(label)) bySubtree.set(label, []);
    bySubtree.get(label).push(size);
  }

  const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  const subtrees = [...bySubtree.entries()]
    .map(([label, sizes]) => ({
      label,
      count: sizes.length,
      nodes: sizes.reduce((a, b) => a + b, 0),
      median: median(sizes),
      max: Math.max(...sizes),
    }))
    .sort((a, b) => b.nodes - a.nodes)
    .slice(0, SUBTREE_LIMIT);

  return {
    total,
    depth: maxDepth(root),
    byTag: top(byTag, TAG_LIMIT).map(([k, v]) => ({ tag: k, n: v })),
    byClass: top(byClass, CLASS_LIMIT).map(([k, v]) => ({ cls: k, n: v })),
    subtrees,
    // OVERLAPPING BY CONSTRUCTION: an .instance-wrap is inside a
    // .container-shell, so these totals double-count by nesting. Summing them
    // against `total` is the obvious mistake and it would look like a bug.
    subtreesOverlap: true,
  };
}

function maxDepth(root) {
  let max = 0;
  const walk = (el, d) => {
    if (d > max) max = d;
    for (const c of el.children) walk(c, d + 1);
  };
  walk(root, 0);
  return max;
}

/** One line per row, ready to paste. Used by the probe and by the console. */
export function formatDomAudit(a) {
  if (!a) return "(no document)";
  const L = [];
  L.push(`DOM AUDIT — ${a.total} elements, max depth ${a.depth}`);
  L.push("");
  L.push("REPEATED STRUCTURES (subtree totals OVERLAP by nesting — do not sum)");
  L.push("  count   total   median   max   what");
  for (const s of a.subtrees) {
    L.push(`  ${String(s.count).padStart(5)}  ${String(s.nodes).padStart(6)}  ${String(s.median).padStart(7)}  ${String(s.max).padStart(4)}   ${s.label}`);
  }
  L.push("");
  L.push("BY TAG");
  L.push("  " + a.byTag.map((t) => `${t.tag}:${t.n}`).join("  "));
  L.push("");
  L.push("BY CLASS (top)");
  L.push("  " + a.byClass.map((c) => `${c.cls}:${c.n}`).join("  "));
  return L.join("\n");
}

if (typeof window !== "undefined") {
  window.__domAudit = (root) => {
    const a = auditDom(root);
    console.log(formatDomAudit(a));
    return a;
  };
}
