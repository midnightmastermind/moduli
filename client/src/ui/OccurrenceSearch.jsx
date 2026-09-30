// ui/OccurrenceSearch.jsx
//
// Live occurrence search. Collapsed it is a magnifying-glass button; clicking
// expands it into an input in place, and the results dropdown opens on the
// first keystroke. Mounted twice:
//   - panel header  — whole grid; picking opens the result's page in that panel
//   - page header   — scopeRootId = that page; picking just scrolls to it
//
// The occurrence/module maps are read through the NON-SUBSCRIBING getters at
// query time, so this component doesn't re-render on every occurrence write
// (it is mounted once per panel and once per page).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { useGridActionsSelector } from "../GridActionsContext.js";
import { getSearchIndex, searchOccurrences } from "../helpers/occurrenceSearch";
import { getModuleTypeIcon } from "../helpers/moduleIcons";
import { clickedInsidePortalLayer } from "../helpers/outsideClick";
import { highlightSegments } from "../helpers/searchHighlight";

const MENU_W = 340;
const MENU_MAX_H = 380;
const DEBOUNCE_MS = 120;

function Row({ hit, term, active, onPick, onHover }) {
  const { entry, why } = hit;
  const Icon = getModuleTypeIcon({ role: entry.role, kind: entry.kind });
  // The WHOLE query, not its first word — `helpers/searchHighlight`.
  const segments = highlightSegments(entry.label || "Untitled", term);
  return (
    <div
      role="option"
      aria-selected={active}
      className={`occ-search-row${active ? " occ-search-row--active" : ""}`}
      onMouseEnter={onHover}
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
    >
      <Icon size={12} className="occ-search-row-icon" />
      <div className="occ-search-row-text">
        <div className="occ-search-row-label">
          {segments.map((seg, i) => (seg.hit ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>))}
        </div>
        {entry.pathLabels.length > 0 ? (
          <div className="occ-search-row-path">{entry.pathLabels.join(" › ")}</div>
        ) : !entry.pageOccId ? (
          // SAY IT IN THE LIST, not only after the click. Picking one of these
          // goes nowhere and answers "That item isn't on a page yet" — which is
          // the right message in the wrong place: you had to spend a click to
          // learn that this row is the one you cannot open.
          <div className="occ-search-row-path occ-search-row-path--orphan">not on a page</div>
        ) : null}
        {why && why.text && <div className="occ-search-row-why">{why.text}</div>}
      </div>
    </div>
  );
}

export default function OccurrenceSearch({
  scopeRootId = null,
  onPick,
  title = "Search occurrences",
  placeholder = "Search occurrences…",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchorRect, setAnchorRect] = useState(null);
  const wrapRef = useRef(null);

  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const getModMap = useGridActionsSelector(s => s.getModMap || (() => s.modulesById || {}));
  const fieldsById = useGridActionsSelector(s => s.fieldsById);
  const gridId = useGridActionsSelector(s => s.grid?._id || s.state?.grid?._id || null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Nothing is indexed until the user actually types.
  const runSearch = useCallback((q) => {
    const term = String(q || "").trim();
    if (!term) return { results: [], total: 0 };
    const index = getSearchIndex({
      occurrencesById: getOccMap(),
      modulesById: getModMap(),
      fieldsById,
      gridId,
    });
    return searchOccurrences(index, term, { scopeRootId });
    // getOccMap/getModMap are stable getters — read at compute time, not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsById, gridId, scopeRootId]);

  const hits = useMemo(() => runSearch(debounced), [runSearch, debounced]);

  useEffect(() => { setActiveIdx(0); }, [debounced]);

  const close = useCallback(() => { setOpen(false); setQuery(""); setDebounced(""); }, []);

  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (el) setAnchorRect(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    // Reposition rather than close — the 2026-06-09 QuickAddMenu lesson: closing
    // on scroll fires on the menu's own internal scrolling.
    const onScroll = () => reposition();
    const onDown = (e) => {
      if (clickedInsidePortalLayer(e.target)) return;
      if (!wrapRef.current?.contains(e.target)) close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, reposition, close]);

  const pick = useCallback((hit) => {
    if (!hit) return;
    onPick?.(hit.entry.occId, hit.entry);
    close();
  }, [onPick, close]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, hits.results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      // ENTER MUST NOT FALL INTO THE DEBOUNCE WINDOW. The list waits 120ms
      // before it searches at all, and Enter inside that window read
      // `hits.results` for a query that had not run yet — an empty list, so it
      // picked nothing and did nothing, silently. Measured on prod: Enter at
      // 0ms and 60ms after the last keystroke did nothing; at 130ms it
      // navigated. That is the whole of "the first time i do a search and press
      // enter, it doesnt work, after that it works fine" — by the second try
      // the results are already on screen.
      //
      // Pressing Enter IS the decision, so a stale query is run right now
      // rather than dropped. Index 0 with it: the highlighted row belongs to
      // the list on screen, which is not the list this query produces.
      const term = query.trim();
      if (!term) return;
      const fresh = term !== debounced;
      const live = fresh ? runSearch(term) : hits;
      pick(live.results[fresh ? 0 : activeIdx]);
    }
  };



  const menu = open && debounced ? createPortal(
    <div
      role="listbox"
      className="occ-search-menu"
      style={{
        position: "fixed",
        top: anchorRect ? Math.min(anchorRect.bottom + 4, Math.max(8, window.innerHeight - MENU_MAX_H - 8)) : 8,
        left: anchorRect ? Math.max(8, Math.min(anchorRect.left, window.innerWidth - MENU_W - 8)) : 8,
        width: MENU_W,
        maxHeight: MENU_MAX_H,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {hits.results.length === 0 ? (
        <div className="occ-search-empty">No matches</div>
      ) : (
        <>
          {hits.results.map((hit, i) => (
            <Row
              key={hit.entry.occId}
              hit={hit}
              term={debounced}
              active={i === activeIdx}
              onHover={() => setActiveIdx(i)}
              onPick={() => pick(hit)}
            />
          ))}
          {hits.total > hits.results.length && (
            <div className="occ-search-more">+{hits.total - hits.results.length} more</div>
          )}
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={`occ-search${open ? " occ-search--open" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {open ? (
        <div className="occ-search-field">
          <Search size={11} className="occ-search-field-icon" />
          <input
            autoFocus
            type="text"
            className="occ-search-input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="occ-search-clear"
            title="Close search"
            aria-label="Close search"
            onClick={close}
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="occ-search-trigger"
          title={title}
          aria-label={title}
          onClick={() => { setOpen(true); requestAnimationFrame(reposition); }}
        >
          <Search size={11} />
        </button>
      )}
      {menu}
    </div>
  );
}
