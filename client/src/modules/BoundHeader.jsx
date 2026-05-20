// BoundHeader — renders a container's header from a JOIN binding instead of
// the module label. Type-dispatched:
//   - select target: dropdown + (optional) dice button; rendered text is the
//     currently selected option's label/value, surrounded by `markdownPrefix`.
//   - text target:   plain inline text (TipTap JSON → extractPlainText).
//     Rich body editing happens in BoundBody — headers stay single-line.
//   - fallback:      `label` when no source occurrence resolves.
import React, { useContext, useMemo, useCallback } from "react";
import { Dices } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext.js";
import { findLinkedOccurrence } from "../state/editorBindings.js";
import { resolveOptions } from "../helpers/optionsResolver.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

export default function BoundHeader({ hostOccurrence, binding, markdownPrefix = "", label = "" }) {
  const ctx = useContext(GridActionsContext) || {};
  const { occurrencesById, fieldsById, modulesById, dispatch, socket } = ctx;
  const source = useMemo(
    () => findLinkedOccurrence({ binding, hostOccurrence, occurrencesById }),
    [binding, hostOccurrence, occurrencesById]
  );
  const field = fieldsById?.[binding?.target];

  const options = useMemo(() => {
    if (!field) return [];
    if (Array.isArray(field?.meta?._resolvedOptions)) return field.meta._resolvedOptions;
    const { options: opts } = resolveOptions(field, { modulesById, occurrencesById, fieldsById }) || {};
    return Array.isArray(opts) ? opts : [];
  }, [field, modulesById, occurrencesById, fieldsById]);

  const writeValueToSource = useCallback(
    (nextValue) => {
      if (!source || !dispatch || !socket) return;
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
    },
    [source, binding, dispatch, socket]
  );

  if (!source || !field) {
    return <span>{markdownPrefix}{label}</span>;
  }

  const value = source.fields?.[binding.target]?.value;

  if (field.type === "select") {
    const onDice = () => {
      if (!options.length) return;
      const pick = options[Math.floor(Math.random() * options.length)];
      writeValueToSource(typeof pick === "string" ? pick : pick.value);
    };
    return (
      <span
        className="bound-header bound-header-select"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span>{markdownPrefix}{stringifyValue(value, options)}</span>
        <select
          aria-label="bound select"
          value={value ?? ""}
          onChange={(e) => writeValueToSource(e.target.value)}
          style={{ fontSize: 11, padding: "2px 4px" }}
        >
          {options.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : (opt.label ?? opt.value);
            return (
              <option key={String(v)} value={v}>
                {l}
              </option>
            );
          })}
        </select>
        {field.meta?.randomizable && (
          <button
            data-testid="bound-header-dice"
            onClick={onDice}
            title="Randomize"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "inherit",
            }}
          >
            <Dices size={12} />
          </button>
        )}
      </span>
    );
  }

  // Text/other: header stays single-line. Strip TipTap JSON to plain text.
  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return <span>{markdownPrefix}{text}</span>;
}

function stringifyValue(value, options) {
  if (value == null) return "";
  if (Array.isArray(options)) {
    const match = options.find((o) => (typeof o === "string" ? o : o.value) === value);
    if (match) return typeof match === "string" ? match : (match.label ?? match.value);
  }
  return String(value);
}

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}
