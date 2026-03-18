import React, { useMemo } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import ModulePanel from "../modules/Panel";
import FormInput from "./FormInput";

export default function FullscreenOverlay({
  fullscreenPanelId,
  setFullscreenPanelId,
  panelsById,
  panelProps,
  cols,
  rows,
}) {
  // ✅ Memo first (no conditional hook usage)
const allPanels = useMemo(() => {
  const arr = Object.values(panelsById ?? {});
  arr.sort((a, b) => {
    // pick a consistent key (row/col then id)
    const ar = a?.row ?? 0, ac = a?.col ?? 0;
    const br = b?.row ?? 0, bc = b?.col ?? 0;
    if (ar !== br) return ar - br;
    if (ac !== bc) return ac - bc;
    return String(a?.id).localeCompare(String(b?.id));
  });
  return arr;
}, [panelsById]);

  const panel = panelsById?.[fullscreenPanelId];

  const panelIndex = useMemo(() => {
    if (!panel) return -1;
    return allPanels.findIndex((p) => p?.id === panel.id);
  }, [allPanels, panel]);

  // ✅ after hooks
  if (!panel) return null;

  const cycle = (dir) => {
    const n = allPanels.length;
    if (n <= 1) return;

    const idx = panelIndex >= 0 ? panelIndex : 0;
    const nextIdx = (idx + dir + n) % n;
    const nextId = allPanels[nextIdx]?.id;

    if (nextId) setFullscreenPanelId(nextId);
  };

  return (
    <div
      data-fullscreen-overlay="true"
      style={{
        position: "fixed",
        inset: 10,
        zIndex: 999999,
        pointerEvents: "auto", // ✅ ensure clickable even if someone re-adds a bad class
      }}
      // ✅ IMPORTANT: DO NOT use className="dnd-overlay"
    >
      {/* dim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          borderRadius: 12,
        }}
        onClick={() => setFullscreenPanelId(null)}
      />

      {/* content */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 12,
          overflow: "hidden",
          zIndex: 999999 + 1,
          pointerEvents: "auto",
        }}
      >
        {/* overlay top controls (GLOBAL panel cycle + dropdown) */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999999 + 3,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0px 8px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.45)",
            border: "1px solid var(--input-border)",
            pointerEvents: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cycle(-1);
            }}
            style={{
              padding: 8,
              borderRadius: 999,
              background: "transparent",
              color: "white",
            }}
            aria-label="Previous panel (global)"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div style={{ width: 220 }}>
            <FormInput
              value={{ activePanelId: panel.id }}
              onChange={(next) => {
                const id = next?.activePanelId;
                if (id) setFullscreenPanelId(id);
              }}
              schema={{
                type: "select",
                key: "activePanelId",
                placeholder: "Select panel…",
                options: allPanels.map((p, idx) => {
                  const name = (p?.layout?.name ?? "").trim();
                  return { value: p.id, label: name ? name : `Panel ${idx + 1}` };
                }),
                className: "text-[11px] font-mono",
                // ✅ open upward (since you docked it at the bottom)
                contentProps: { side: "top", sideOffset: 6, align: "center" },
              }}
            />
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cycle(1);
            }}
            style={{
              padding: 8,
              borderRadius: 999,
              background: "transparent",
              color: "white",
            }}
            aria-label="Next panel (global)"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* fullscreen Panel render */}
        <div style={{ position: "absolute", inset: 0, zIndex: 999999 + 1, pointerEvents: "auto" }}>
          <ModulePanel
            module={panel}
            cols={cols}
            rows={rows}
            {...panelProps}
            forceFullscreen
            fullscreenPanelId={fullscreenPanelId}
            setFullscreenPanelId={setFullscreenPanelId}
          />
        </div>
      </div>
    </div>
  );
}
