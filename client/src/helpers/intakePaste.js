// helpers/intakePaste.js
//
// Task 3 Step 4 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// PASTE. Ctrl+V goes through the same classifier, sheet and router a drop does,
// so pasting a screenshot and dropping one produce the same thing and ask the
// same question (user, 2026-08-07: "yes use control v").
//
// This file is the PURE half: read a ClipboardEvent into the payload shape
// `classifyIntake` already takes, and decide whether the paste is ours at all.
// No React, no DOM writes, no store — so both decisions are testable without a
// browser, which matters because the second one is a veto over a key the user
// presses constantly.
//
// ── WHY THE VETO IS THE IMPORTANT HALF ──────────────────────────────────────
// There is no OS-clipboard paste handler anywhere in this app today (the
// existing "paste" is entirely the internal multi-select clipboard). So this
// introduces a document-level listener on a key that ALREADY works everywhere
// text is edited. Getting `shouldIgnorePaste` wrong does not lose a feature —
// it breaks typing. It therefore fails SAFE: anything remotely editable, and
// anything inside a ProseMirror, is not ours.
//
// ProseMirror keeps its own paste handling for doc bodies by design (the plan
// says so explicitly): it understands its own schema, and re-implementing that
// through the intake router would be a second, drifting copy of it.

/** Elements whose own paste behaviour must always win. */
const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);

/**
 * Is this paste someone else's? Fails SAFE — when in doubt, not ours.
 *
 * @param {EventTarget|null} target  the paste event's target
 * @returns {boolean} true when intake must keep its hands off
 */
export function shouldIgnorePaste(target) {
  // Not an element (document, window, null) — nothing claims it, so it is ours.
  if (!target || target.nodeType !== 1) return false;

  const el = /** @type {Element} */ (target);
  const tag = (el.tagName || "").toLowerCase();
  if (EDITABLE_TAGS.has(tag)) return true;

  // ── THE RULE IS "EDITABLE TEXT", NOT "INSIDE AN EDITOR" ────────────────────
  // The obvious version of this — `closest(".ProseMirror, .doc-editor")` —
  // was written first and was WRONG, and the browser said so immediately: it
  // vetoed EVERY paste on the grid. In this app a doc container renders its
  // body as a ProseMirror and embeds occurrence cards as NODE VIEWS, so most
  // of the visible grid is inside an editor's DOM subtree. Vetoing that
  // surface leaves paste working almost nowhere.
  //
  // ProseMirror already draws the line for us: an atom node view is
  // `contenteditable="false"` inside an otherwise editable doc. So walk up and
  // take the NEAREST explicit answer — "true" means the caret can be here and
  // the editor owns the paste; "false" means this is a card, and it is ours.
  let node = el;
  while (node && node.nodeType === 1) {
    const attr = node.getAttribute?.("contenteditable");
    if (attr === "true" || attr === "") return true;   // editable text → not ours
    if (attr === "false") return false;                // a node view → ours
    node = node.parentElement;
  }
  return false;
}

/**
 * Read a ClipboardEvent's DataTransfer into `normalizeIntakePayload`'s shape.
 *
 * Files win over text, and that ordering is not cosmetic: pasting a screenshot
 * puts BOTH an image file and a stray `text/html` `<img>` tag on the clipboard,
 * and reading the text first would import the markup instead of the picture.
 *
 * @param {DataTransfer|null} dt
 * @returns {{files: File[], text: string, html: string, url: string}}
 */
export function readClipboardPayload(dt) {
  const empty = { files: [], text: "", html: "", url: "" };
  if (!dt) return empty;

  let files = [];
  try {
    // `dt.files` is empty for a pasted screenshot in some browsers while
    // `dt.items` carries it, so read both and prefer whichever has content.
    if (dt.files && dt.files.length) files = Array.from(dt.files);
    else if (dt.items && dt.items.length) {
      files = Array.from(dt.items)
        .filter((i) => i && i.kind === "file")
        .map((i) => (typeof i.getAsFile === "function" ? i.getAsFile() : null))
        .filter(Boolean);
    }
  } catch { files = []; }

  const get = (type) => {
    try { return dt.getData?.(type) || ""; } catch { return ""; }
  };
  const text = get("text/plain");
  const html = get("text/html");
  const url = get("text/uri-list") || "";

  return { files, text, html, url };
}

/**
 * Does this clipboard hold anything intake could act on?
 *
 * Guards the listener so an empty or unreadable clipboard never opens a sheet
 * asking about nothing — the paste just falls through as it does today.
 */
export function hasIntakeContent(payload) {
  if (!payload) return false;
  if (payload.files?.length) return true;
  return !!(payload.url?.trim() || payload.text?.trim() || payload.html?.trim());
}
