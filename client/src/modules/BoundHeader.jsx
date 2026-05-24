// BoundHeader — renders/edits a HOST occurrence's own field value in the
// container header position. The binding declares { selfField, link }:
//   - selfField: the field on the host occurrence whose value IS the header
//   - link:      JOIN identity for cross-occurrence sync (auto-propagates on
//                write to other occurrences sharing host.fields[link].value)
//
// Type-dispatched:
//   - select selfField: dropdown + optional dice (when randomizable)
//   - text/other:       plain inline (read-only — body editor handles edits)
//
// Falls back to the module label when the host doesn't yet have a value for
// the selfField AND the field has no resolvable options.
import React, { useContext, useMemo, useCallback } from "react";
import { Dices, Link2, Unlink2 } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext.js";
import { resolveOptions } from "../helpers/optionsResolver.js";
import { propagateBoundFieldWrite } from "../helpers/boundFieldSync.js";
import { findLinkedSiblings } from "../state/editorBindings.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

// Small inline badge: [link/broken-link icon] [field name]
// Sentinel break — never matches a real value, so findLinkedSiblings's
// loop-prevention skip-if-equal check doesn't drop matches.
const LINK_PROBE = Symbol("link-probe");
function BindingBadge({ field, isLinked }) {
  const Icon = isLinked ? Link2 : Unlink2;
  return (
    <span
      className="bound-binding-badge"
      title={isLinked ? `Linked: ${field?.name || ""}` : `Broken link: ${field?.name || ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginLeft: "auto",
        paddingLeft: 6,
        fontSize: 9,
        opacity: 0.65,
        color: isLinked ? "var(--text-muted, #888)" : "var(--text-faint, #b06a6a)",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={10} />
      <span>{field?.name || ""}</span>
    </span>
  );
}

export default function BoundHeader({ hostOccurrence, binding, markdownPrefix = "", label = "" }) {
  const ctx = useContext(GridActionsContext) || {};
  const { occurrencesById, fieldsById, modulesById, dispatch, socket } = ctx;
  const field = fieldsById?.[binding?.selfField];

  const options = useMemo(() => {
    if (!field) return [];
    if (Array.isArray(field?.meta?._resolvedOptions)) return field.meta._resolvedOptions;
    const { options: opts } = resolveOptions(field, { modulesById, occurrencesById, fieldsById }) || {};
    return Array.isArray(opts) ? opts : [];
  }, [field, modulesById, occurrencesById, fieldsById]);

  const isLinked = useMemo(() => {
    if (!binding || !hostOccurrence || !occurrencesById) return false;
    if (hostOccurrence?.fields?.[binding.link]?.value == null) return false;
    return findLinkedSiblings({ binding, hostOccurrence, occurrencesById, nextValue: LINK_PROBE }).length > 0;
  }, [binding, hostOccurrence, occurrencesById]);

  const writeAndSync = useCallback(
    (nextValue) => {
      if (!hostOccurrence || !dispatch || !socket) return;
      CommitHelpers.updateOccurrence({
        dispatch,
        socket,
        occurrence: {
          id: hostOccurrence.id,
          fields: {
            ...hostOccurrence.fields,
            [binding.selfField]: {
              ...(hostOccurrence.fields?.[binding.selfField] || {}),
              value: nextValue,
            },
          },
        },
        emit: true,
      });
      propagateBoundFieldWrite({
        hostOccurrence,
        binding,
        nextValue,
        occurrencesById,
        dispatch,
        socket,
      });
    },
    [hostOccurrence, binding, dispatch, socket, occurrencesById]
  );

  if (!hostOccurrence || !field) {
    return <span>{markdownPrefix}{label}</span>;
  }

  const value = hostOccurrence.fields?.[binding.selfField]?.value;
  // Render as a dropdown whenever options are available — covers select-type
  // fields AND text-type fields with an optionsSource (e.g. journalQuestion's
  // find-mode pool). Falls back to the text branch when no options resolve.
  const hasOptions = options.length > 0;
  // Any field with a configured optionsSource — render the dropdown UI
  // even when the predicate currently resolves zero options. Gives users
  // a visible affordance (instead of a silent text fallback) plus a
  // diagnostic empty-state placeholder when the pool is empty (#47).
  const wantsDropdown = field.type === "select"
    || hasOptions
    || !!field.meta?.optionsSource;

  if (wantsDropdown) {
    const onDice = () => {
      if (!options.length) return;
      const pick = options[Math.floor(Math.random() * options.length)];
      writeAndSync(typeof pick === "string" ? pick : pick.value);
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
          onChange={(e) => writeAndSync(e.target.value)}
          style={{ fontSize: 11, padding: "2px 4px" }}
        >
          {hasOptions ? (
            <>
              <option value="">— pick —</option>
              {options.map((opt) => {
                const v = typeof opt === "string" ? opt : opt.value;
                const l = typeof opt === "string" ? opt : (opt.label ?? opt.value);
                return (
                  <option key={String(v)} value={v}>
                    {l}
                  </option>
                );
              })}
            </>
          ) : (
            <option value="" disabled>(no options — check pool predicate)</option>
          )}
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
        <BindingBadge field={field} isLinked={isLinked} />
      </span>
    );
  }

  // Text/other types: header is single-line readout. Body bindings (BoundBody)
  // handle rich-content editing.
  const text = typeof value === "object" ? extractPlainText(value) : String(value ?? "");
  return (
    <span
      className="bound-header bound-header-text"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}
    >
      <span>{markdownPrefix}{text || label}</span>
      <BindingBadge field={field} isLinked={isLinked} />
    </span>
  );
}

function stringifyValue(value, options) {
  if (value == null || value === "") return "";
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
