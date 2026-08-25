// ui/TemplatesSection.jsx
// Renders inside HeaderDropdown's bottom half. Lets the user:
//   - Apply a kind-matched template into this occurrence
//   - Save the current subtree as a new template
//   - Save the current subtree over the template it was applied from (if any)

import React, { useMemo, useState } from "react";
import { useGridActions } from "../GridActionsContext";
import {
  templatesByKind, templatesFolderFor, templateKindOf, templateLabelOf,
} from "../helpers/templateHelpers";
import {
  commitApplyTemplate,
  commitCloneSubtreeAsTemplate,
  commitSaveOverTemplate,
} from "../helpers/CommitHelpers";

// Merge, not copy: structure flows from the template while the page keeps
// everything the user wrote, and re-applying tops it up instead of duplicating.
// Copy is the deliberate "stamp it once, then it's mine" choice — it clones the
// template's wrapper in as a child and never syncs again.
export const DEFAULT_APPLY_MODE = "merge";
export const APPLY_MODES = [
  { value: "merge", label: "Merge", hint: "Add what's missing; keep what you wrote" },
  { value: "append", label: "Copy", hint: "Stamp a detached copy in" },
];

/**
 * Only templates whose kind matches the host — see the spec's Compatibility
 * section. A board page's children are containers and a doc page's body is a
 * textmap of embeds, so applying one into the other has no sensible meaning;
 * it is not offered rather than offered and then failing.
 */
export function applicableTemplates(lookups, gridId, hostOccurrence) {
  const kind = templateKindOf(lookups, hostOccurrence);
  if (!kind) return [];
  return templatesByKind(lookups, gridId, kind)
    // A template is an ordinary page, so opening one shows this same section —
    // never offer it to itself.
    .filter(t => t.id !== hostOccurrence?.id);
}

export default function TemplatesSection({ occurrence }) {
  const ctx = useGridActions();
  const { socket, state, modulesById, occurrencesById, manifestsById, foldersById } = ctx;
  const gridId = state?.grid?._id || state?.gridId;
  const lookups = useMemo(
    () => ({ manifestsById, foldersById, occurrencesById, modulesById }),
    [manifestsById, foldersById, occurrencesById, modulesById]
  );

  const templates = useMemo(
    () => applicableTemplates(lookups, gridId, occurrence),
    [lookups, gridId, occurrence]
  );

  const root = templatesFolderFor(lookups, gridId);
  const appliedFrom = occurrence?.meta?.appliedFromTemplateId;
  const appliedFromName = appliedFrom
    ? templateLabelOf(lookups, occurrencesById?.[appliedFrom])
    : null;

  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState(DEFAULT_APPLY_MODE);
  const [saveName, setSaveName] = useState("");

  const apply = () => {
    if (!selectedId) return;
    commitApplyTemplate(socket, {
      templateOccurrenceId: selectedId,
      targetOccurrenceId: occurrence.id,
      mode,
    });
  };
  const saveNew = () => {
    const trimmed = saveName.trim();
    if (!trimmed || !root) return;
    commitCloneSubtreeAsTemplate(socket, {
      sourceOccurrenceId: occurrence.id,
      name: trimmed,
      parentFolderId: root.id,
    });
    setSaveName("");
  };
  const saveOver = () => {
    if (!appliedFrom) return;
    commitSaveOverTemplate(socket, {
      sourceOccurrenceId: occurrence.id,
      templateOccurrenceId: appliedFrom,
    });
  };

  return (
    <section style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--panel-border, #374151)" }}>
      <header style={{ fontSize: 11, opacity: 0.85, marginBottom: 6 }}>Templates</header>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {!root && (
          <div style={{ fontSize: 11, opacity: 0.5 }}>No Templates folder on this grid yet.</div>
        )}
        {root && templates.length === 0 && (
          <div style={{ fontSize: 11, opacity: 0.5 }}>No templates for this kind yet.</div>
        )}
        {templates.map(t => (
          <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="radio"
              name="tpl"
              checked={selectedId === t.id}
              onChange={() => setSelectedId(t.id)}
            />
            <span>{templateLabelOf(lookups, t)}</span>
          </label>
        ))}
      </div>

      {templates.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <button
            onClick={apply}
            disabled={!selectedId}
            style={{
              fontSize: 11,
              padding: "3px 10px", borderRadius: 4,
              border: "1px solid var(--panel-border, #374151)",
              background: "transparent", color: "inherit",
              cursor: selectedId ? "pointer" : "not-allowed",
              opacity: selectedId ? 1 : 0.5,
            }}
          >Apply</button>
          <div style={{ display: "flex", gap: 2 }}>
            {APPLY_MODES.map(m => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                title={m.hint}
                style={{
                  fontSize: 12, padding: "3px 8px", borderRadius: 4,
                  border: "1px solid var(--panel-border, #374151)",
                  background: mode === m.value ? "var(--accent-blue-bg, #1e3a5f)" : "transparent",
                  color: "inherit", cursor: "pointer",
                  opacity: mode === m.value ? 1 : 0.6,
                }}
              >{m.label}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Save as new template..."
          style={{
            flex: 1, fontSize: 11,
            background: "transparent", color: "inherit",
            border: "1px solid var(--panel-border, #374151)",
            borderRadius: 4, padding: "2px 6px",
          }}
        />
        <button
          onClick={saveNew}
          disabled={!saveName.trim() || !root}
          style={{
            fontSize: 11,
            padding: "2px 10px", borderRadius: 4,
            border: "1px solid var(--panel-border, #374151)",
            background: "transparent", color: "inherit",
            cursor: saveName.trim() && root ? "pointer" : "not-allowed",
            opacity: saveName.trim() && root ? 1 : 0.5,
          }}
        >Save</button>
      </div>

      {appliedFrom && (
        <button
          onClick={saveOver}
          style={{
            fontSize: 11, marginTop: 6,
            padding: "3px 10px", borderRadius: 4,
            border: "1px solid var(--panel-border, #374151)",
            background: "transparent", color: "inherit", cursor: "pointer",
          }}
        >
          Save over {appliedFromName ? `"${appliedFromName}"` : "template"}
        </button>
      )}
    </section>
  );
}
