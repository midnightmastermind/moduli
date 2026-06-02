// client/src/ui/filterSummary.js
// Shared formatter for filter-selection summaries shown in the picker trigger,
// the header pill, and the arrow-nav label. Turns a day selection into an
// explicit listing of distinct days and contiguous ranges
// ("May 6, May 9–12, May 20") instead of a bare count ("3 selected").

function parseLocal(iso) {
  if (iso instanceof Date) return iso;
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return null;
}

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "May 6"
const md = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Group sorted/deduped ISO days into contiguous runs; format each as a single
// day ("May 6") or a range ("May 9–12" same month, "May 30–Jun 2" cross-month);
// join with ", ". Caps at maxSegments with a "+N more" tail.
export function summarizeDays(list, { maxSegments = 3 } = {}) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const keys = Array.from(
    new Set(list.map((s) => (typeof s === "string" ? s.slice(0, 10) : s instanceof Date ? localISO(s) : null))),
  )
    .filter(Boolean)
    .sort();
  const dates = keys.map(parseLocal).filter(Boolean);
  if (!dates.length) return null;

  const segs = [];
  let start = dates[0];
  let prev = dates[0];
  for (let i = 1; i < dates.length; i++) {
    const cur = dates[i];
    const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
    if (cur.getTime() === expected.getTime()) {
      prev = cur;
    } else {
      segs.push([start, prev]);
      start = cur;
      prev = cur;
    }
  }
  segs.push([start, prev]);

  const fmtSeg = ([a, b]) => {
    if (a.getTime() === b.getTime()) return md(a);
    // same month → "May 9–12"; cross-month → "May 30–Jun 2"
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return `${md(a)}–${b.getDate()}`;
    }
    return `${md(a)}–${md(b)}`;
  };

  const parts = segs.map(fmtSeg);
  if (parts.length <= maxSegments) return parts.join(", ");
  return `${parts.slice(0, maxSegments).join(", ")} +${parts.length - maxSegments} more`;
}

// Normalize a filter value shape { value, unit, span, kind, dates } into a
// human listing. Week/month/year render as their period label; day-based
// selections (single / range / multi) list their days and ranges.
export function summarizeSelection(shape, { maxSegments = 3 } = {}) {
  if (!shape) return null;
  const unit = shape.unit || "day";
  const anchor = parseLocal(shape.value);
  if (unit === "year") return anchor ? String(anchor.getFullYear()) : null;
  if (unit === "month") return anchor ? anchor.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null;
  if (unit === "week") return anchor ? `wk ${md(anchor)}` : null;

  // Day-based — assemble the full day list from whichever field carries it.
  let days = null;
  if (Array.isArray(shape.dates) && shape.dates.length) {
    days = shape.dates;
  } else if (shape.span > 1 && anchor) {
    days = [];
    for (let i = 0; i < shape.span; i++) {
      days.push(localISO(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i)));
    }
  } else if (shape.value) {
    days = [typeof shape.value === "string" ? shape.value.slice(0, 10) : anchor ? localISO(anchor) : null].filter(Boolean);
  }
  if (!days || !days.length) return null;
  return summarizeDays(days, { maxSegments });
}
