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

const MENU_W = 340;
const MENU_MAX_H = 380;
const DEBOUNCE_MS = 120;

// Split a string around the first match so the hit can be rendered bolded.
function highlight(text, term) {
  if (!term) return [text, "", ""];
  const at = text.toLowerCase().indexOf(term);
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), text.slice(at, at + term.length), text.slice(at + term.length)];
}

function Row({ hit, term, active, onPick, onHover }) {
  const { entry, why } = hit;
  const Icon = getModuleTypeIcon({ role: entry.role, kind: entry.kind });
  const [before, hitText, after] = highlight(entry.label || "Untitled", term);
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
          {before}{hitText && <mark>{hitText}</mark>}{after}
        </div>
        {entry.pathLabels.length > 0 && (
          <div className="occ-search-row-path">{entry.pathLabels.join(" › ")}</div>
        )}
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
  const hits = useMemo(() => {
    if (!debounced) return { results: [], total: 0 };
    const index = getSearchIndex({
      occurrencesById: getOccMap(),
      modulesById: getModMap(),
      fieldsById,
      gridId,
    });
    return searchOccurrences(index, debounced, { scopeRootId });
    // getOccMap/getModMap are stable getters — read at compute time, not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, fieldsById, gridId, scopeRootId]);

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
    if (e.key === "Enter") { e.preventDefault(); pick(hits.results[activeIdx]); }
  };

  const firstTerm = debounced.toLowerCase().split(/\s+/).filter(Boolean)[0] || "";

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
              term={firstTerm}
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
