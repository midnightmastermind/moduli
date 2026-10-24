// docs/LiveMarkdownExtension.js — the line you are on shows its markdown (Obsidian-style live preview).
//
// User, 2026-10-24: "markdown needs to resolve inside of a textblock" · "can delete the stars for bolding after
// applied, they dont show again" · pasted text came in with "border boxes" (inline code) — "keep it … we just need
// to see the characters when editing between them" · "### … only resolves to 2" (the old CSS prefix drew `##` on a
// level-3 heading and `#` on a level-2: off by one, and not deletable).
//
// The document stays formatted (bold is a mark, a heading is a heading) — nothing is rewritten, so saving, syncing
// and every other reader are untouched. On the line holding the caret, while the editor has focus, the syntax is
// drawn as widgets: `### ` before a heading, `**` `*` `` ` `` `~~` around marked text, `> ` in a quote. And it is
// EDITABLE the way characters are:
//   Backspace right after a closing marker     removes that mark from the run (unbold)
//   Delete right before an opening marker      the same
//   Backspace at the start of a heading        one level down (a level-1 heading becomes a paragraph)
//   `#` at the start of a heading              one level up (to 6)
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice as SliceCtor, Fragment as FragmentCtor } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { resolveBlocks } from "./resolveMarkdown.js";

export const liveMarkdownKey = new PluginKey("liveMarkdown");

/** The markdown each mark is written with (outermost first when several cover one run). */
export const MARK_SYNTAX = { bold: "**", italic: "*", strike: "~~", code: "`" };
export const MAX_HEADING = 6;

function syntaxWidget(text, cls) {
  return () => {
    const s = document.createElement("span");
    s.className = `md-syntax ${cls || ""}`.trim();
    s.textContent = text;
    s.setAttribute("contenteditable", "false");
    return s;
  };
}

/**
 * The runs of each syntax mark inside a textblock node starting at `start` (the position of its first child):
 * [{ mark, from, to }] — a run is the longest stretch of consecutive inline children carrying that mark. Pure.
 */
export function markRuns(block, start) {
  const runs = [];
  const open = {};
  let pos = start;
  block.forEach((child) => {
    const here = new Set(child.marks.map((m) => m.type.name).filter((n) => MARK_SYNTAX[n]));
    for (const name of Object.keys(open)) {
      if (!here.has(name)) { runs.push({ mark: name, from: open[name], to: pos }); delete open[name]; }
    }
    for (const name of here) if (open[name] === undefined) open[name] = pos;
    pos += child.nodeSize;
  });
  for (const name of Object.keys(open)) runs.push({ mark: name, from: open[name], to: pos });
  return runs;
}

/** The textblock holding the caret and where its content starts, or null. */
function caretBlock(state) {
  const $h = state.selection.$head;
  if (!$h.parent.isTextblock) return null;
  return { node: $h.parent, start: $h.start(), depth: $h.depth, $h };
}

export function decorationsFor(state) {
  const cb = caretBlock(state);
  if (!cb) return DecorationSet.empty;
  const { node, start, depth, $h } = cb;
  const decos = [];
  if (node.type.name === "heading") {
    const level = node.attrs.level || 1;
    decos.push(Decoration.widget(start, syntaxWidget("#".repeat(level) + " ", "md-syntax-heading"), { side: -1, key: `h${level}` }));
  }
  for (let d = depth - 1; d > 0; d--) {
    if ($h.node(d).type.name === "blockquote") {
      decos.push(Decoration.widget(start, syntaxWidget("> ", "md-syntax-quote"), { side: -2, key: "q" }));
      break;
    }
  }
  for (const r of markRuns(node, start)) {
    const text = MARK_SYNTAX[r.mark];
    decos.push(Decoration.widget(r.from, syntaxWidget(text, `md-syntax-${r.mark}`), { side: -1, key: `o${r.mark}${r.from}` }));
    decos.push(Decoration.widget(r.to, syntaxWidget(text, `md-syntax-${r.mark}`), { side: 1, key: `c${r.mark}${r.to}` }));
  }
  return DecorationSet.create(state.doc, decos);
}

/** The run of a syntax mark ending exactly at `pos` (Backspace) or starting there (Delete), in the caret's block. */
export function runAtBoundary(state, pos, which) {
  const cb = caretBlock(state);
  if (!cb) return null;
  const runs = markRuns(cb.node, cb.start);
  return runs.find((r) => (which === "end" ? r.to === pos : r.from === pos)) || null;
}

/** Index of the top-level block holding the caret. */
const topIndex = (state) => (state.selection.$head.depth > 0 ? state.selection.$head.index(0) : -1);

/**
 * A transaction that resolves raw markdown in `state` (docs/resolveMarkdown), leaving the top-level block `keep`
 * untouched so the caret's line is not rewritten under it. Null when nothing changes. The parts before and after
 * `keep` are replaced separately (after first), so positions before the caret stay valid.
 */
export function resolveTransaction(state, keep = -1, { dropEmptyTables = false } = {}) {
  const blocks = state.doc.content.content.map((n) => n.toJSON());
  const parts = keep >= 0 ? [[keep + 1, blocks.length], [0, keep]] : [[0, blocks.length]];
  let tr = null;
  for (const [a, b] of parts) {
    if (b <= a) continue;
    const slice = blocks.slice(a, b);
    const { blocks: next, changed } = resolveBlocks(slice, new Set(), { dropEmptyTables });
    if (!changed) continue;
    tr = tr || state.tr;
    let from = 0;
    for (let i = 0; i < a; i++) from += state.doc.child(i).nodeSize;
    let to = from;
    for (let i = a; i < b; i++) to += state.doc.child(i).nodeSize;
    const nodes = next.map((j) => state.schema.nodeFromJSON(j));
    tr.replaceWith(from, to, nodes);
  }
  return tr;
}

export const LiveMarkdown = Extension.create({
  name: "liveMarkdown",

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin({
        key: liveMarkdownKey,
        // Raw markdown that ARRIVED as text resolves: after a paste (the whole doc), when the caret leaves a line
        // (every line but the one it is on), and when the editor is left (everything).
        appendTransaction(trs, oldState, newState) {
          const ed = extension.editor;
          if (!ed?.isEditable || ed.view?.composing) return null;
          if (trs.some((t) => t.getMeta(liveMarkdownKey) === "resolved")) return null;
          const pasted = trs.some((t) => t.getMeta("paste") || t.getMeta("uiEvent") === "paste");
          const blurred = trs.some((t) => t.getMeta(liveMarkdownKey) === "blur");
          const moved = topIndex(oldState) !== topIndex(newState);
          if (!pasted && !blurred && !moved) return null;
          const tr = resolveTransaction(newState, pasted || blurred ? -1 : topIndex(newState), { dropEmptyTables: pasted });
          return tr ? tr.setMeta(liveMarkdownKey, "resolved") : null;
        },
        props: {
          // Rich text copied from another site pastes AS ITS TEXT (user, 2026-10-24: "the html should not resolve …
          // it should be pasted as is") — a web form's layout tables and boxes stay behind; markdown in that text then
          // resolves (appendTransaction). A copy from this app (ProseMirror's own slice) keeps its formatting.
          handlePaste(view, event) {
            const dt = event.clipboardData;
            if (!dt || !extension.editor?.isEditable) return false;
            const html = dt.getData("text/html");
            const text = dt.getData("text/plain");
            if (!html || !text || html.includes("data-pm-slice") || dt.files?.length) return false;
            const { schema } = view.state;
            const lines = text.replace(/\r\n?/g, "\n").split("\n");
            const nodes = lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : null));
            const tr = view.state.tr.replaceSelection(new SliceCtor(FragmentCtor.from(nodes), 1, 1));
            view.dispatch(tr.setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
            return true;
          },
          // Redraw on focus/blur (a pure blur dispatches nothing); leaving the editor resolves everything.
          handleDOMEvents: {
            focus: (view) => { view.dispatch(view.state.tr.setMeta(liveMarkdownKey, true)); return false; },
            blur: (view) => { view.dispatch(view.state.tr.setMeta(liveMarkdownKey, "blur")); return false; },
          },
          decorations(state) {
            if (!extension.editor?.isFocused || !extension.editor?.isEditable) return DecorationSet.empty;
            return decorationsFor(state);
          },
          handleKeyDown(view, event) {
            if (!extension.editor?.isEditable || event.metaKey || event.ctrlKey || event.altKey) return false;
            const { state } = view;
            const sel = state.selection;
            if (!sel.empty) return false;
            const $h = sel.$head;
            const block = $h.parent;
            // Headings: the `#`s are edited like characters.
            if (block.type.name === "heading" && $h.parentOffset === 0) {
              const level = block.attrs.level || 1;
              const at = $h.before();
              if (event.key === "Backspace") {
                const tr = level > 1
                  ? state.tr.setNodeMarkup(at, undefined, { ...block.attrs, level: level - 1 })
                  : state.tr.setNodeMarkup(at, state.schema.nodes.paragraph);
                view.dispatch(tr); return true;
              }
              if (event.key === "#" && level < MAX_HEADING) {
                view.dispatch(state.tr.setNodeMarkup(at, undefined, { ...block.attrs, level: level + 1 })); return true;
              }
            }
            // Marks: deleting the shown `**` (etc.) removes the mark from its run.
            if (event.key === "Backspace" || event.key === "Delete") {
              const run = runAtBoundary(state, sel.from, event.key === "Backspace" ? "end" : "start");
              if (run) {
                const type = state.schema.marks[run.mark];
                if (type) {
                  view.dispatch(state.tr.removeMark(run.from, run.to, type).setStoredMarks([]));
                  return true;
                }
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

export default LiveMarkdown;
