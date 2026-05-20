// BoundBody — renders a textblock body from a JOIN binding instead of its
// own textmap. Read-only in this initial cut: extracts plain text from a
// TipTap JSON value (or stringifies primitives). Task 4 swaps this for a
// live TipTap editor that writes back to source.fields[binding.target].
import React, { useContext, useMemo } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import { findLinkedOccurrence } from "../state/editorBindings.js";

export default function BoundBody({ hostOccurrence, binding, children }) {
  const { occurrencesById, fieldsById } = useContext(GridActionsContext) || {};
  const source = useMemo(
    () => findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }),
    [binding, hostOccurrence, occurrencesById]
  );
  const field = fieldsById?.[binding?.target];

  if (!source || !field) return children ?? null;

  const value = source.fields?.[binding.target]?.value;
  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");

  return <div className="bound-body bound-body-text">{text}</div>;
}

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}
