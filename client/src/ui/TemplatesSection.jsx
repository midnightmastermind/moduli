// ui/TemplatesSection.jsx
// Renders inside HeaderDropdown's bottom half. Lets the user:
//   - Apply a kind-matched template into this occurrence
//   - Save the current subtree as a new template
//   - Save the current subtree over the template it was applied from (if any)

import React, { useMemo, useState } from "react";
import { useGridActions } from "../GridActionsContext";
import { templatesByKind, rootFolderForTemplates } from "../helpers/templateHelpers";
import {
  commitApplyTemplate,
  commitCloneSubtreeAsTemplate,
  commitSaveOverTemplate,
} from "../helpers/CommitHelpers";

export default function TemplatesSection({ occurrence }) {
  const ctx = useGridActions();
  const { socket, state, modulesById, occurrencesById, manifestsById, foldersById } = ctx;
  const gridId = state?.grid?._id || state?.gridId;
  const lookups = useMemo(
    () => ({ manifestsById, foldersById, occurrencesById, modulesById }),
    [manifestsById, foldersById, occurrencesById, modulesById]
  );

  const myModule = modulesById?.[occurrence?.moduleId];
  const myKind = myModule?.role || myModule?.kind || null;

  const templates = useMemo(
    () => (myKind ? templatesByKind(lookups, gridId, myKind) : []),
    [lookups, gridId, myKind]
  );

  const root = rootFolderForTemplates(lookups, gridId);
  const appliedFrom = occurrence?.meta?.appliedFromTemplateId;
  const appliedFromName = appliedFrom
    ? occurrencesById?.[appliedFrom]?.meta?.templateName
    : null;

  const [selectedId, setSelectedId] = useState(null);
  const [saveName, setSaveName] = useState("");

  const apply = () => {
    if (!selectedId) return;
    commitApplyTemplate(socket, {
      templateOccurrenceId: selectedId,
      targetOccurrenceId: occurrence.id,
      mode: "append",
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
      <header style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Templates</header>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {!root && (
          <div style={{ fontSize: 11, opacity: 0.5 }}>Templates manifest not yet available.</div>
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
            <span>{t.meta?.templateName || "(unnamed)"}</span>
          </label>
        ))}
      </div>

      {templates.length > 0 && (
        <button
          onClick={apply}
          disabled={!selectedId}
          style={{
            fontSize: 11, marginBottom: 8,
            padding: "3px 10px", borderRadius: 4,
            border: "1px solid var(--panel-border, #374151)",
            background: "transparent", color: "inherit",
            cursor: selectedId ? "pointer" : "not-allowed",
            opacity: selectedId ? 1 : 0.5,
          }}
        >Apply</button>
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
