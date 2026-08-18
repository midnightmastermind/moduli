// ui/HeadingLevelPicker.jsx
// ============================================================
// The `#`s on a container header, made into a control.
//
// User, 2026-08-18: "right now, i cant edit how many ## hashtags there are for a
// header. it shows them when i click on the header but i cant edit them in any
// way … we should maybe have the grayed out hashtags be a button to select how
// many … that dropdown button should always show up when i click on a header at
// all (even when selecting the question)."
//
// THE AUDIT BEHIND IT: `meta.headingLevel` had FOUR readers in ModuleContainer
// (font size, weight, the hash repeat, the layout branch) and NOT ONE writer
// anywhere in the client. Only migrations and the markdown importer ever set it.
// The hashes were decoration — no click handler, revealed on hover — so the
// level was, in practice, unreachable to the person whose document it is.
//
// WHY A BUTTON RATHER THAN TYPING ALONE. Typing markdown is the obvious answer
// and it cannot work everywhere: a bound header (the Daily Question) is a native
// `<select>` with a text layer over it — there is nothing to type INTO. The user
// spotted that themselves. A button sits in the header row, outside whichever
// control renders the label, so it works the same for both.
//
// It renders through `MenuSurface` like every other floating menu here, which is
// what makes it a bottom drawer on a phone rather than a dropdown under a thumb.
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import MenuSurface from "./MenuSurface";

// 1-6 mirrors markdown, and this header IS a markdown heading in everything but
// storage. "None" is the absence of the key, which is how a plain container
// header is stored today — offering it keeps the control able to express every
// state the data already has, rather than trapping a container at a heading.
export const LEVELS = [1, 2, 3, 4, 5, 6];

export default function HeadingLevelPicker({ level, onPick, fontSize, fontWeight, color }) {
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);

  const open = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const r = btnRef.current?.getBoundingClientRect();
    setAnchor(r ? { top: Math.round(r.bottom + 2), left: Math.round(r.left) } : { top: 0, left: 0 });
  }, []);
  const close = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    if (!anchor) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [anchor, close]);

  const shown = Number(level) > 0 ? Number(level) : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="embedded-hash embedded-hash-btn"
        // The header row is a drag handle and the label is editable; without
        // this the press starts a drag or lands a caret instead of opening.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={open}
        title="Heading level"
        aria-label={shown ? `Heading level ${shown}` : "Set heading level"}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        style={{ fontSize, fontWeight, color, fontFamily: "var(--font-mono)" }}
      >
        {shown ? "#".repeat(shown) : "#"}
      </button>
      {anchor && (
        <MenuSurface position={anchor} onClose={close} style={{ width: 132, padding: 4 }}>
          {LEVELS.map((n) => (
            <button
              key={n}
              type="button"
              className={`heading-level-item${n === shown ? " is-current" : ""}`}
              onClick={(e) => { e.stopPropagation(); onPick?.(n); close(); }}
            >
              <span className="heading-level-hash">{"#".repeat(n)}</span>
              <span className="heading-level-name">Heading {n}</span>
            </button>
          ))}
          <button
            type="button"
            className={`heading-level-item${shown === 0 ? " is-current" : ""}`}
            onClick={(e) => { e.stopPropagation(); onPick?.(null); close(); }}
          >
            <span className="heading-level-hash">—</span>
            <span className="heading-level-name">Not a heading</span>
          </button>
        </MenuSurface>
      )}
    </>
  );
}

/**
 * Markdown typing, kept working alongside the button (user: "we should still be
 * able to type and it converts it to the button when in the header").
 *
 * Returns `{ level, label }` when the text starts with 1-6 hashes and a space,
 * else null. Pure so it can be tested without a contentEditable — the DOM half
 * of a header edit is exactly the part that is painful to drive in jsdom.
 *
 * SEVEN OR MORE HASHES IS NOT A HEADING, the same as markdown: it stays in the
 * label rather than silently clamping to 6, because clamping would eat text the
 * user typed on purpose.
 */
export function parseHeadingPrefix(text) {
  const m = /^(#{1,6})\s+(.*)$/.exec(String(text ?? ""));
  if (!m) return null;
  const label = m[2].trim();
  if (!label) return null;   // "## " alone is someone mid-thought, not a rename
  return { level: m[1].length, label };
}
