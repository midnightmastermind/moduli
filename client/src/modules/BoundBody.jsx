// BoundBody — renders/edits a HOST occurrence's own field value in the
// textblock body position. The binding declares { selfField, link }:
//   - selfField: the field on the host whose value IS the body content
//   - link:      JOIN identity for cross-occurrence sync (propagation on
//                write to siblings sharing host.fields[link].value)
//
// Type-dispatched:
//   - text selfField: live TipTap editor (StarterKit). Edits write back to
//     host.fields[selfField] as TipTap JSON, then fan out to linked siblings.
//   - other types:    plain extracted text (read-only — header binding handles
//     non-text cases via dropdown).
//
// Falls back to `children` when no field is resolvable.
import React, { useContext, useMemo, useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { GridActionsContext } from "../GridActionsContext.js";
import { propagateBoundFieldWrite } from "../helpers/boundFieldSync.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const DEBOUNCE_MS = 500;

// Exported for unit testing. Returns a (nextValue) => void that commits an
// updateOccurrence to the HOST and fans out to linked siblings.
export function makeFieldWriter({ host, binding, occurrencesById, dispatch, socket }) {
  if (!host || !binding?.selfField || !dispatch || !socket) return () => {};
  return (nextValue) => {
    CommitHelpers.updateOccurrence({
      dispatch,
      socket,
      occurrence: {
        id: host.id,
        fields: {
          ...host.fields,
          [binding.selfField]: {
            ...(host.fields?.[binding.selfField] || {}),
            value: nextValue,
          },
        },
      },
      emit: true,
    });
    propagateBoundFieldWrite({
      hostOccurrence: host,
      binding,
      nextValue,
      occurrencesById,
      dispatch,
      socket,
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
  const field = fieldsById?.[binding?.selfField];

  if (!hostOccurrence || !field) return children ?? null;

  const value = hostOccurrence.fields?.[binding.selfField]?.value;

  if (field.type === "text") {
    return (
      <BoundTextEditor
        host={hostOccurrence}
        binding={binding}
        value={value}
        occurrencesById={occurrencesById}
        dispatch={dispatch}
        socket={socket}
      />
    );
  }

  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return <div className="bound-body bound-body-text">{text}</div>;
}

function BoundTextEditor({ host, binding, value, occurrencesById, dispatch, socket }) {
  const writeRef = useRef(() => {});
  writeRef.current = useMemo(
    () => makeFieldWriter({ host, binding, occurrencesById, dispatch, socket }),
    [host, binding, occurrencesById, dispatch, socket]
  );

  const initialDoc = useMemo(() => normalizeToDoc(value), [host?.id, binding?.selfField]);
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
    [host?.id, binding?.selfField]
  );

  useEffect(() => {
    if (!editor) return;
    const incoming = normalizeToDoc(value);
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(incoming)) return;
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
