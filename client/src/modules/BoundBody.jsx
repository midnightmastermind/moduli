// BoundBody — renders/edits a HOST occurrence's own field value in the
// textblock body position. The binding declares { selfField, link }:
//   - selfField: the field on the host whose value IS the body content
//   - link:      OPTIONAL. JOIN identity for cross-occurrence sync (propagation
//                on write to siblings sharing host.fields[link].value). Omitted
//                means the body is PER-OCCURRENCE and never fans out — the
//                instance notes body, where a link would paste one row's note
//                onto every row sharing the link value.
//
// Type-dispatched:
//   - text selfField: live TipTap editor (StarterKit). Edits write back to
//     host.fields[selfField] as TipTap JSON, then fan out to linked siblings.
//   - other types:    plain extracted text (read-only — header binding handles
//     non-text cases via dropdown).
//
// Falls back to `children` when no field is resolvable.
import React, { useMemo, useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Link2, Unlink2 } from "lucide-react";
import { useGridActions } from "../GridActionsContext.js";
import { propagateBoundFieldWrite } from "../helpers/boundFieldSync.js";
import { findLinkedSiblings } from "../state/editorBindings.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

const LINK_PROBE = Symbol("link-probe");

// THREE states, not two. A binding that declares no `link` is per-occurrence
// BY DESIGN (the instance notes body) — reporting it as a "Broken link" would
// tell the user something is wrong with a body that is working exactly as
// authored. It still names the field, because the point of the badge is that
// this body is FIELD-BACKED rather than the occurrence's own textmap.
export function badgeState({ binding, isLinked }) {
  if (!binding?.link) return "unlinked";
  return isLinked ? "linked" : "broken";
}

function BindingBadge({ field, state }) {
  const Icon = state === "linked" ? Link2 : state === "broken" ? Unlink2 : null;
  const title =
    state === "linked" ? `Linked: ${field?.name || ""}`
    : state === "broken" ? `Broken link: ${field?.name || ""}`
    : field?.name || "";
  return (
    <span
      className="bound-binding-badge"
      title={title}
      style={{
        position: "absolute",
        top: 4,
        right: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 12,
        opacity: 0.65,
        color: state === "broken" ? "var(--text-faint, #b06a6a)" : "var(--text-muted, #888)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {Icon ? <Icon size={10} /> : null}
      <span>{field?.name || ""}</span>
    </span>
  );
}

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
  const { occurrencesById, fieldsById, dispatch, socket } = useGridActions() || {};
  const field = fieldsById?.[binding?.selfField];

  const isLinked = useMemo(() => {
    if (!binding?.link || !hostOccurrence || !occurrencesById) return false;
    if (hostOccurrence?.fields?.[binding.link]?.value == null) return false;
    return findLinkedSiblings({ binding, hostOccurrence, occurrencesById, nextValue: LINK_PROBE }).length > 0;
  }, [binding, hostOccurrence, occurrencesById]);

  if (!hostOccurrence || !field) return children ?? null;

  const value = hostOccurrence.fields?.[binding.selfField]?.value;

  const state = badgeState({ binding, isLinked });

  if (field.type === "text") {
    return (
      <BoundTextEditor
        host={hostOccurrence}
        binding={binding}
        value={value}
        field={field}
        badge={state}
        occurrencesById={occurrencesById}
        dispatch={dispatch}
        socket={socket}
      />
    );
  }

  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return (
    <div className="bound-body bound-body-text" style={{ position: "relative" }}>
      {text}
      <BindingBadge field={field} state={state} />
    </div>
  );
}

function BoundTextEditor({ host, binding, value, field, badge, occurrencesById, dispatch, socket }) {
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
        // Data-driven, so the notes field can prompt "Add notes..." while the
        // Daily Answer keeps its own wording. The seed already authors it.
        Placeholder.configure({ placeholder: field?.meta?.placeholder || "Answer…" }),
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
    <div className="bound-body bound-body-text bound-body-editor" style={{ position: "relative" }}>
      <EditorContent editor={editor} />
      <BindingBadge field={field} state={badge} />
    </div>
  );
}

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}
