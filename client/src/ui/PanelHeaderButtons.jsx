// ui/PanelHeaderButtons.jsx — Home, then the grid's own buttons, in every panel's header (2026-11-15).
//
// Home opens the root folder in that panel. The grid lists further buttons in `grid.meta.panelButtons`
// (`{ id, label, icon, operationId }`); each runs its operation for a press in this panel, so the operation can
// UPDATE_VIEW `$trigger.panelViewId` to show a page here (poms' "Glossary" opens the root glossary page).
// User: "a button for home (root) and a custom button for opening that page in the panels header (thats operation
// opens the root glossary. no customizable option needed in cc."
import React from "react";
import { Home, BookOpen, Star, Link as LinkIcon, Compass } from "lucide-react";

const ICONS = { BookOpen, Star, Link: LinkIcon, Compass, Home };

/** The grid's header buttons whose operation exists. Pure. */
export function panelButtonsFor(grid, operationsById) {
  const list = Array.isArray(grid?.meta?.panelButtons) ? grid.meta.panelButtons : [];
  return list.filter((b) => b && b.operationId && operationsById?.[b.operationId]);
}

const btnStyle = {
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  padding: "3px 5px", border: "none", borderRadius: 4, cursor: "pointer",
  background: "transparent", color: "var(--text-muted)",
};

export default function PanelHeaderButtons({ grid, operationsById, onHome, onRun }) {
  const buttons = panelButtonsFor(grid, operationsById);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); onHome?.(); }} title="Home" aria-label="Home" className="panel-home-btn" style={btnStyle}>
        <Home size={11} style={{ opacity: 0.8 }} />
      </button>
      {buttons.map((b) => {
        const Icon = ICONS[b.icon] || BookOpen;
        return (
          <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); onRun?.(operationsById[b.operationId]); }}
            title={b.label} aria-label={b.label} className="panel-grid-btn" style={btnStyle}>
            <Icon size={11} style={{ opacity: 0.8 }} />
          </button>
        );
      })}
    </>
  );
}
