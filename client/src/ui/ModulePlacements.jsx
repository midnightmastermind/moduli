// ui/ModulePlacements.jsx
// "This module is in N places" + one row per place with its ancestry, in an occurrence's Settings
// (instances, containers, files). The rule for what counts lives in helpers/modulePlaces.
import React, { useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { useGridActions } from "../GridActionsContext";
import { modulePlaces } from "../helpers/modulePlaces";
import { getLastPanelId } from "../helpers/lastPanel";
import { isUploadedFile } from "../helpers/fileHome";

/** Opens a place through the panel's own navigation (ModulePanel listens for `moduli:goto-occurrence`). */
function goTo(occId) {
  const panel = getLastPanelId() || document.querySelector("[data-panel-id]")?.getAttribute("data-panel-id");
  window.dispatchEvent(new CustomEvent("moduli:goto-occurrence", { detail: { occId, panelModuleId: panel || null } }));
}

export function placementsHeading(count, isFile) {
  const where = count === 1 ? "1 place" : `${count} places`;
  return isFile ? `This file is in ${where} (not counting Files)` : `This module is in ${where}`;
}

export default function ModulePlacements({ moduleId, currentOccId }) {
  const { occurrencesById, modulesById, foldersById } = useGridActions();
  const places = useMemo(
    () => modulePlaces(moduleId, { occurrencesById, modulesById, foldersById }),
    [moduleId, occurrencesById, modulesById, foldersById],
  );
  if (!moduleId) return null;
  const isFile = isUploadedFile(modulesById?.[moduleId]);
  return (
    <>
      <Separator />
      <div className="py-2" data-testid="module-placements">
        <h4 className="text-xs font-semibold text-foreground/70 mb-2">{placementsHeading(places.length, isFile)}</h4>
        <div className="space-y-1">
          {places.map((p, i) => {
            const here = p.occId === currentOccId && p.jumpId === currentOccId;
            return (
              <button
                key={`${p.occId}:${p.jumpId}:${i}`}
                type="button"
                onClick={() => goTo(p.jumpId)}
                title="Go there"
                className="w-full text-left flex items-center gap-2 text-[12px] text-muted-foreground px-1 py-0.5 rounded bg-muted/20 hover:bg-muted/40"
              >
                <span className="text-muted-foreground/50">&#x2192;</span>
                <span className="truncate">{p.path.length ? p.path.join(" › ") : "(not placed anywhere)"}</span>
                {here && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">this one</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
