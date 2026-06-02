// modules/GlobalTree.jsx
// Global content tree for CommandCenter EntityTreeTab.
// Shows Grid / Pages / Documents in three collapsible folder sections.
import { useContext, useMemo, useState } from "react";
import { LayoutPanelLeft } from "lucide-react";
import { GridActionsContext, useGridActions } from "../GridActionsContext.js";

const FOLDER_HEADER_STYLE = {
  padding: "4px 8px 2px 6px",
  fontSize: 9,
  opacity: 0.4,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  display: "flex",
  alignItems: "center",
  gap: 4,
  cursor: "pointer",
  userSelect: "none",
};

function kindGlyph(kind) {
  if (kind === "canvas") return "∿";
  if (kind === "doc") return "≋";
  if (kind === "display") return "□";
  return "≡";
}

export default function GlobalTree({ onNavigate }) {
  const ctx = useGridActions() || {};
  const { state, modulesById, occurrencesById, manifestsById, foldersById } = ctx;

  const [search, setSearch] = useState("");
  const [folderOpen, setFolderOpen] = useState({ grid: true, pages: true, docs: true });
  const sq = search.toLowerCase();

  const toggleFolder = (key) => setFolderOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // Grid folder: panels → containers → instances
  const gridPanels = useMemo(() => {
    const gridOccIds = state?.grid?.occurrences || [];
    return gridOccIds.map(panelOccId => {
      const panelOcc = occurrencesById?.[panelOccId];
      if (!panelOcc) return null;
      const panelMod = modulesById?.[panelOcc.moduleId];
      if (!panelMod) return null;
      const label = panelMod.label || panelMod.name || "Panel";

      const containers = (panelOcc.occurrences || []).map(cOccId => {
        const cOcc = occurrencesById?.[cOccId];
        if (!cOcc) return null;
        const cMod = modulesById?.[cOcc.moduleId];
        if (!cMod) return null;
        const instances = (cOcc.occurrences || []).map(iOccId => {
          const iOcc = occurrencesById?.[iOccId];
          if (!iOcc) return null;
          const iMod = modulesById?.[iOcc.moduleId];
          return iOcc && iMod ? { occId: iOccId, label: iMod.label || "Instance", mod: iMod } : null;
        }).filter(Boolean);
        return { occId: cOccId, label: cMod.label || "Container", mod: cMod, instances };
      }).filter(Boolean);

      return { panelOccId, label, mod: panelMod, containers };
    }).filter(Boolean);
  }, [state?.grid?.occurrences, occurrencesById, modulesById]);

  // Pages folder: modules with role === "page"
  const pageModules = useMemo(() => {
    return Object.values(modulesById || {})
      .filter(m => m.role === "page" && !m.trashed)
      .sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  }, [modulesById]);

  // Documents folder: artifact modules, grouped by folder
  const artifactsByFolder = useMemo(() => {
    const artifacts = Object.values(modulesById || {}).filter(m => m.kind === "artifact" && !m.trashed);
    const byFolder = {};
    for (const m of artifacts) {
      // Find the occurrence to get parentId (folderId)
      const occ = Object.values(occurrencesById || {}).find(o => o.moduleId === m.id);
      const folderId = occ?.parentId || "__none__";
      if (!byFolder[folderId]) byFolder[folderId] = [];
      byFolder[folderId].push({ mod: m, occ });
    }
    return byFolder;
  }, [modulesById, occurrencesById]);

  const folderEntries = useMemo(() => {
    return Object.entries(artifactsByFolder).map(([folderId, items]) => {
      const folder = foldersById?.[folderId];
      const folderLabel = folder?.name || (folderId === "__none__" ? "Unfiled" : folderId.slice(-6));
      return { folderId, folderLabel, items };
    }).sort((a, b) => a.folderLabel.localeCompare(b.folderLabel));
  }, [artifactsByFolder, foldersById]);

  const filteredGridPanels = sq
    ? gridPanels.filter(p =>
        p.label.toLowerCase().includes(sq) ||
        p.containers.some(c => c.label.toLowerCase().includes(sq) || c.instances.some(i => i.label.toLowerCase().includes(sq)))
      )
    : gridPanels;

  const filteredPageModules = sq
    ? pageModules.filter(m => (m.label || "").toLowerCase().includes(sq))
    : pageModules;

  const filteredFolderEntries = sq
    ? folderEntries.map(fe => ({
        ...fe,
        items: fe.items.filter(({ mod }) => (mod.label || "").toLowerCase().includes(sq)),
      })).filter(fe => fe.items.length > 0 || fe.folderLabel.toLowerCase().includes(sq))
    : folderEntries;

  const handleNavigate = (type, id) => {
    if (onNavigate) onNavigate(type, id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
      {/* Search */}
      <div style={{ padding: "6px 8px 4px 8px" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          style={{
            width: "100%", boxSizing: "border-box",
            height: 24, fontSize: 10,
            background: "var(--input-bg)", border: "1px solid var(--input-border)",
            borderRadius: 4, color: "var(--text-primary)", padding: "0 6px", outline: "none",
          }}
        />
      </div>

      {/* Grid folder */}
      <div
        style={FOLDER_HEADER_STYLE}
        onClick={() => toggleFolder("grid")}
      >
        <span>{folderOpen.grid ? "▾" : "▸"}</span>
        <span>Grid</span>
      </div>
      {folderOpen.grid && (
        <div>
          {filteredGridPanels.map(({ panelOccId, label, mod, containers }) => (
            <div key={panelOccId}>
              <div
                style={{ padding: "2px 8px 2px 14px", fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontWeight: 600 }}
                onClick={() => handleNavigate("panel_occ", panelOccId)}
              >
                <LayoutPanelLeft size={10} color="#60a5fa" style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
              </div>
              {containers.map(({ occId, label: cLabel, instances }) => (
                <div key={occId}>
                  <div
                    style={{ marginLeft: 20, padding: "1px 8px 1px 4px", display: "flex", alignItems: "center", cursor: "pointer" }}
                    onClick={() => handleNavigate("container_occ", occId)}
                  >
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      fontSize: 9, padding: "1px 5px", borderRadius: 10,
                      background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)",
                      color: "rgba(52,211,153,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120,
                    }}>
                      {cLabel}
                    </span>
                  </div>
                  {instances.map(({ occId: iOccId, label: iLabel }) => (
                    <div
                      key={iOccId}
                      style={{ marginLeft: 32, padding: "1px 8px 1px 4px", cursor: "pointer" }}
                      onClick={() => handleNavigate("instance_occ", iOccId)}
                    >
                      <span style={{
                        display: "inline-flex", alignItems: "center",
                        fontSize: 9, padding: "1px 4px", borderRadius: 8,
                        background: "rgba(167,139,250,0.10)", border: "1px solid rgba(167,139,250,0.25)",
                        color: "rgba(167,139,250,0.75)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110,
                      }}>
                        {iLabel}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {filteredGridPanels.length === 0 && (
            <div style={{ padding: "2px 14px 4px", fontSize: 10, opacity: 0.3 }}>{sq ? "No matches" : "No panels"}</div>
          )}
        </div>
      )}

      {/* Pages folder */}
      <div
        style={FOLDER_HEADER_STYLE}
        onClick={() => toggleFolder("pages")}
      >
        <span>{folderOpen.pages ? "▾" : "▸"}</span>
        <span>Pages</span>
      </div>
      {folderOpen.pages && (
        <div>
          {filteredPageModules.map(m => (
            <div
              key={m.id}
              style={{ padding: "2px 8px 2px 14px", fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
              onClick={() => handleNavigate("page_module", m.id)}
            >
              <span style={{ opacity: 0.4, fontSize: 10, flexShrink: 0 }}>{kindGlyph(m.kind)}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.label || "Untitled"}</span>
            </div>
          ))}
          {filteredPageModules.length === 0 && (
            <div style={{ padding: "2px 14px 4px", fontSize: 10, opacity: 0.3 }}>{sq ? "No matches" : "No pages"}</div>
          )}
        </div>
      )}

      {/* Documents folder */}
      <div
        style={FOLDER_HEADER_STYLE}
        onClick={() => toggleFolder("docs")}
      >
        <span>{folderOpen.docs ? "▾" : "▸"}</span>
        <span>Documents</span>
      </div>
      {folderOpen.docs && (
        <div>
          {filteredFolderEntries.map(({ folderId, folderLabel, items }) => (
            <div key={folderId}>
              <div style={{ padding: "2px 8px 2px 10px", fontSize: 10, opacity: 0.5, display: "flex", alignItems: "center", gap: 3 }}>
                <span>▸</span>
                <span>{folderLabel}</span>
              </div>
              {items.map(({ mod, occ }) => (
                <div
                  key={mod.id}
                  style={{ padding: "2px 8px 2px 20px", fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                  onClick={() => handleNavigate("panel_occ", occ?.id)}
                >
                  <span style={{ opacity: 0.35, fontSize: 9, flexShrink: 0 }}>›</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{mod.label || mod.fileRef || "Untitled"}</span>
                </div>
              ))}
            </div>
          ))}
          {filteredFolderEntries.length === 0 && (
            <div style={{ padding: "2px 14px 4px", fontSize: 10, opacity: 0.3 }}>{sq ? "No matches" : "No documents"}</div>
          )}
        </div>
      )}
    </div>
  );
}
