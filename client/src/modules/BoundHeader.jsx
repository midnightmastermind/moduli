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
import React, { useMemo, useCallback } from "react";
import { ChevronDown, Dices, Link2, Unlink2 } from "lucide-react";
import { useGridActions } from "../GridActionsContext.js";
import AutoMarquee from "../ui/AutoMarquee";
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
        fontSize: 12,
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
  const ctx = useGridActions() || {};
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

  const value = hostOccurrence?.fields?.[binding?.selfField]?.value;

  // The text the control is currently showing. Declared BEFORE the early
  // return: a hook after a conditional return changes the hook COUNT the moment
  // hostOccurrence resolves, which is a React crash waiting for the first render
  // where this component mounts without one. It was already written that way;
  // moving it up is the whole fix.
  const selectedLabel = useMemo(() => {
    const hit = options.find((o) => (typeof o === "string" ? o : o.value) === value);
    if (hit) return typeof hit === "string" ? hit : (hit.label ?? hit.value);
    return value == null || value === "" ? "" : String(value);
  }, [options, value]);

  if (!hostOccurrence || !field) {
    return <span>{markdownPrefix}{label}</span>;
  }

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
        {/* The SELECT already displays the current value. Printing it beside the
            control too showed the whole question twice — and, being a header
            label, the long copy marquee-scrolled its own empty space (user
            2026-07-31: "make sure its not repeating the question next to it …
            it should say the question as the selection and daily question small
            next to it"). The field name lives in the badge at the end of the
            row, which is the "small next to it". Only the markdown prefix (the
            `#` heading marker) is printed here. */}
        {markdownPrefix ? <span>{markdownPrefix}</span> : null}
        {/* THE TEXT IS A REAL SPAN AND THE SELECT IS LAID OVER IT, TRANSPARENT.
            A native <select> truncates its selected option internally and cannot
            be made to marquee — AutoMarquee measures scrollWidth, and a select
            capped at max-width:100% never reports any overflow, so the marquee
            this module asks for (meta.labelOverflow) was inert by construction.
            The reveal was therefore hover-only, which means on TOUCH the rest of
            a long question was unreachable at all (measured 2026-08-11).
            The text layer overflows honestly, so it marquees / wraps / ellipses
            exactly as labelOverflow says, with no pointer required.

            The earlier attempt REPOSITIONED the select on hover and lost the
            row's stretched width plus the app's control chrome (user 2026-08-01:
            "a diff css version of select thats alot smaller and square border").
            Overlaying instead leaves the native control's geometry alone — it is
            simply invisible, and still opens its own picker on click or tap. */}
        <span className="bound-header-pick" title={selectedLabel || undefined}>
          {/* The empty-pool diagnostic (#47) used to be the select's only
              <option>, which an invisible select can no longer show — so it
              moves to the text layer. Dropping it would turn a misconfigured
              predicate back into a silently blank header. */}
          <span className="bound-header-text">
            <AutoMarquee>
              {selectedLabel || (hasOptions ? " " : "(no options — check pool predicate)")}
            </AutoMarquee>
          </span>
          {/* The caret is drawn by us because an invisible select cannot draw
              its own — without it there is nothing saying this is pickable. */}
          <ChevronDown className="bound-header-caret" size={12} aria-hidden="true" />
          <select
            className="bound-header-native"
            aria-label="bound select"
            value={value ?? ""}
            onChange={(e) => writeAndSync(e.target.value)}
            // NO inline fontSize. A hardcoded 11px here beat the heading size the
            // host span sets (the parent measured 13px while this stayed 11), so a
            // bound header never rendered at the level it declared — and it is an
            // INLINE style, which no stylesheet rule can override. That is the
            // fifth time this trap has been recorded in this codebase: when a size
            // or layout rule silently does nothing, look for an inline style
            // FIRST.
          >
            {hasOptions ? (
              <>
                {/* Empty, like every other field select — an unset question reads
                    as blank rather than announcing a placeholder. */}
                <option value=""></option>
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
        </span>
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

function extractPlainText(tiptap) {
  if (!tiptap || typeof tiptap !== "object") return "";
  if (tiptap.text) return tiptap.text;
  if (Array.isArray(tiptap.content)) return tiptap.content.map(extractPlainText).join(" ");
  return "";
}
