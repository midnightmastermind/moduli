// BoundBody — renders a textblock body from a JOIN binding. Type-aware:
//   - text target: live TipTap editor; edits write back to source.fields[target]
//     as TipTap JSON (debounced).
//   - other types: plain extracted text (read-only).
//
// Falls back to `children` when no source occurrence resolves or the target
// field is unknown — preserves the textblock's normal behavior for unbound
// content.
import React, { useContext, useMemo, useRef, useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { GridActionsContext } from "../GridActionsContext.js";
import { findLinkedOccurrence } from "../state/editorBindings.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const DEBOUNCE_MS = 500;

// Exported for unit testing. Produces a (nextValue) => void writer that
// commits an updateOccurrence on the source occurrence with the new
// field value spliced in (preserving the rest of `fields`).
export function makeFieldWriter({ source, binding, dispatch, socket }) {
  if (!source || !binding?.target || !dispatch || !socket) return () => {};
  return (nextValue) => {
    CommitHelpers.updateOccurrence({
      dispatch,
      socket,
      occurrence: {
        id: source.id,
        fields: {
          ...source.fields,
          [binding.target]: {
            ...(source.fields?.[binding.target] || {}),
            value: nextValue,
          },
        },
      },
      emit: true,
    });
  };
}

function normalizeToDoc(value) {
  if (value && typeof value === "object" && value.type === "doc") return value;
  if (typeof value === "string" && value.length > 0) {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
    };
  }
  return EMPTY_DOC;
}

export default function BoundBody({ hostOccurrence, binding, children }) {
  const { occurrencesById, fieldsById, dispatch, socket } = useContext(GridActionsContext) || {};
  const source = useMemo(
    () => findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }),
    [binding, hostOccurrence, occurrencesById]
  );
  const field = fieldsById?.[binding?.target];

  if (!source || !field) return children ?? null;

  const value = source.fields?.[binding.target]?.value;

  // Text fields get a live TipTap editor with write-back.
  if (field.type === "text") {
    return (
      <BoundTextEditor source={source} binding={binding} value={value} dispatch={dispatch} socket={socket} />
    );
  }

  // Anything else: plain inline.
  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return <div className="bound-body bound-body-text">{text}</div>;
}

function BoundTextEditor({ source, binding, value, dispatch, socket }) {
  const writeRef = useRef(() => {});
  writeRef.current = useMemo(
    () => makeFieldWriter({ source, binding, dispatch, socket }),
    [source, binding, dispatch, socket]
  );

  const initialDoc = useMemo(() => normalizeToDoc(value), [source?.id, binding?.target]);
  const debounceTimer = useRef(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Placeholder.configure({ placeholder: "Answer…" }),
      ],
      content: initialDoc,
      onUpdate: ({ editor }) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        const json = editor.getJSON();
        debounceTimer.current = setTimeout(() => {
          writeRef.current(json);
        }, DEBOUNCE_MS);
      },
    },
    // Re-create the editor when binding target changes (different occurrence
    // or different field). When only the value changes (server echo for the
    // SAME binding), the syncEffect below patches without remount.
    [source?.id, binding?.target]
  );

  // Server-side echo sync: when `value` changes from outside (e.g. a different
  // user, or this user's own write echoed back), update the editor content
  // only if it differs from what we already have.
  useEffect(() => {
    if (!editor) return;
    const incoming = normalizeToDoc(value);
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(incoming)) return;
    // Suppress the resulting onUpdate's write-back to avoid a write-loop.
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return (
    <div className="bound-body bound-body-text bound-body-editor">
      <EditorContent editor={editor} />
    </div>
  );
}

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}
