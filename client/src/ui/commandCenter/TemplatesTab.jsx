// commandCenter/TemplatesTab.jsx
import React, { useContext, useMemo, useState } from "react";
import { GridActionsContext } from "../../GridActionsContext";
import { rootFolderForTemplates, templateKindOf } from "../../helpers/templateHelpers";
import { commitApplyTemplate } from "../../helpers/CommitHelpers";

function walkTemplates(state, folderId, depth, acc) {
  Object.values(state?.occurrencesById || {})
    .filter(o => o.parentId === folderId && o.meta?.templateName)
    .forEach(o => acc.push({ kind: "tpl", occ: o, depth }));
  Object.values(state?.foldersById || {})
    .filter(f => f.parentId === folderId)
    .forEach(f => {
      acc.push({ kind: "folder", folder: f, depth });
      walkTemplates(state, f.id, depth + 1, acc);
    });
}

function targetCandidates(state, gridId, kindOrRole) {
  // Flat list of every occurrence in this grid (excluding templates manifest)
  // whose underlying module's role/kind makes it a valid apply target.
  // For templates of role "container", targets are page-role occurrences.
  // For templates of role "page",      targets are panel-role occurrences.
  // For templates of role "instance",  targets are container-role occurrences.
  const targetRoleByTemplateRole = {
    container: "page",
    page: "panel",
    instance: "container",
    textblock: "container",
    artifact: "container",
  };
  const targetRole = targetRoleByTemplateRole[kindOrRole];
  if (!targetRole) return [];
  const root = rootFolderForTemplates(state, gridId);
  const templatesRootId = root?.id;
  return Object.values(state?.occurrencesById || {})
    .filter(o => {
      // Exclude anything inside the templates manifest
      if (templatesRootId) {
        // Walk up parents — if any ancestor is the templates root folder, skip
        let cur = o;
        while (cur) {
          if (cur.parentId === templatesRootId) return false;
          cur = cur.parentId ? state.occurrencesById[cur.parentId] : null;
        }
      }
      const modId = o.moduleId || o.targetId;
      const mod = state?.modulesById?.[modId];
      const role = mod?.role;
      return role === targetRole;
    });
}

function labelFor(state, occ) {
  const modId = occ.moduleId || occ.targetId;
  return state?.modulesById?.[modId]?.label || "(unnamed)";
}

export default function TemplatesTab() {
  const ctx = useContext(GridActionsContext);
  const { socket, state } = ctx;
  const gridId = state?.grid?._id || state?.gridId;
  const root = rootFolderForTemplates(state, gridId);

  const [selectedId, setSelectedId] = useState(null);
  const [pickedTargetId, setPickedTargetId] = useState("");

  const rows = useMemo(() => {
    if (!root) return [];
    const acc = [];
    walkTemplates(state, root.id, 0, acc);
    return acc;
  }, [state, root?.id]);

  const selected = selectedId ? state?.occurrencesById?.[selectedId] : null;
  const selectedKind = selected ? templateKindOf(state, selected) : null;
  const candidates = useMemo(
    () => (selectedKind ? targetCandidates(state, gridId, selectedKind) : []),
    [state, gridId, selectedKind]
  );

  const apply = () => {
    if (!selectedId || !pickedTargetId) return;
    commitApplyTemplate(socket, {
      templateOccurrenceId: selectedId,
      targetOccurrenceId: pickedTargetId,
      mode: "append",
    });
  };

  const childCount = selected
    ? (selected.occurrences || []).length
    : 0;

  return (
    <div style={{ display: "flex", gap: 12, height: "100%", padding: 12, fontFamily: "var(--font-mono)" }}>
      {/* Left pane: templates tree */}
      <div style={{
        flex: "0 0 240px", overflowY: "auto",
        borderRight: "1px solid var(--border-default)", paddingRight: 8,
      }}>
        <div style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>
          Templates
        </div>
        {!root && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No templates manifest yet.</div>}
        {root && rows.length === 0 && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No templates saved yet.</div>}
        {rows.map((r, i) => r.kind === "folder"
          ? (
            <div key={r.folder.id} style={{ paddingLeft: r.depth * 12, fontSize: 10, color: "var(--text-faint)", marginTop: i ? 4 : 0 }}>
              📁 {r.folder.name}
            </div>
          )
          : (
            <div
              key={r.occ.id}
              onClick={() => { setSelectedId(r.occ.id); setPickedTargetId(""); }}
              style={{
                paddingLeft: r.depth * 12 + 4, padding: "3px 4px",
                cursor: "pointer", fontSize: 11,
                background: r.occ.id === selectedId ? "var(--accent-blue-bg, rgba(20,184,166,0.2))" : "transparent",
                color: "var(--text-primary)",
                borderRadius: 3,
              }}
            >
              📋 {r.occ.meta?.templateName || "(unnamed)"}
            </div>
          )
        )}
      </div>

      {/* Right pane: detail + apply */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!selected && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Select a template on the left.
          </div>
        )}
        {selected && (
          <div>
            <h3 style={{ marginTop: 0, color: "var(--text-primary)", fontSize: 14 }}>
              {selected.meta?.templateName}
            </h3>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
              kind: <code>{selectedKind || "?"}</code> · {childCount} top-level child{childCount === 1 ? "" : "ren"}
            </div>

            <div style={{ marginBottom: 8, fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase" }}>
              Apply to
            </div>
            <select
              value={pickedTargetId}
              onChange={(e) => setPickedTargetId(e.target.value)}
              style={{
                width: "100%", maxWidth: 320, fontSize: 11,
                background: "var(--input-bg)", color: "var(--text-primary)",
                border: "1px solid var(--border-default)", borderRadius: 4, padding: "4px 6px",
              }}
            >
              <option value="">— pick a target —</option>
              {candidates.map(c => (
                <option key={c.id} value={c.id}>{labelFor(state, c)}</option>
              ))}
            </select>
            <div style={{ marginTop: 10 }}>
              <button
                onClick={apply}
                disabled={!pickedTargetId}
                style={{
                  fontSize: 11, padding: "4px 12px", borderRadius: 4,
                  border: "1px solid var(--accent-blue-border)",
                  background: "var(--accent-blue-bg)", color: "var(--accent-blue-text)",
                  cursor: pickedTargetId ? "pointer" : "not-allowed",
                  opacity: pickedTargetId ? 1 : 0.5,
                }}
              >Apply</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
