// ui/PastValuesDialog.jsx
// ============================================================
// The radial menu's "History": what this block said on other days.
//
// Replaced the transaction list (ui/TransactionHistory, removed 2026-09-25) —
// user: *"it shows all the transactions for that block but i dont want that. it
// should show a list of past fields"*. What a copy said is read straight from
// the store by helpers/pastValues, so it works after a reload and goes back as
// far as the copies do. Which field dates each entry is data (the block's join
// field, else what the grid filters on), never a hardcoded Date.
//
// Clicking an entry opens the page that copy lives on in the panel the dialog
// was opened from, the same way the panel header's search does.
// ============================================================

import React, { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import { buildPastValues } from "../helpers/pastValues";
import { openOccurrenceInPanel, panelOccurrenceFor } from "../helpers/openOccurrenceInPanel";
import { toast } from "../state/notificationStore";

export default function PastValuesDialog({ open, onOpenChange, occurrence }) {
  const { state, dispatch, socket, occurrencesById, modulesById, fieldsById, viewsById } = useGridActions();

  const { periodFields, entries } = useMemo(() => {
    if (!open || !occurrence) return { periodFields: [], entries: [] };
    return buildPastValues(occurrence, { occurrencesById, modulesById, fieldsById, grid: state?.grid });
  }, [open, occurrence, occurrencesById, modulesById, fieldsById, state?.grid]);

  const label = occurrence?.label || modulesById?.[occurrence?.moduleId]?.label || "this block";
  const keyNames = periodFields.map(fid => fieldsById?.[fid]?.name).filter(Boolean).join(" · ");

  const openCopy = (occId) => {
    const panelOccurrence = panelOccurrenceFor(occurrence?.id, occurrencesById);
    if (!panelOccurrence) { toast("Open this from a panel to jump to a past copy"); return; }
    const res = openOccurrenceInPanel({
      occId, panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket,
      onMissing: () => toast("Found it, but it's hidden by the current filter"),
    });
    if (!res.ok) { toast("That copy isn't on a page"); return; }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            History — {label}
          </DialogTitle>
          <div className="text-xs text-muted-foreground">
            {entries.length} other {entries.length === 1 ? "copy" : "copies"}
            {keyNames ? `, by ${keyNames}` : ", by when each was created"}
          </div>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No other copies of this block yet.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {entries.map(({ occurrence: o, period, lines }) => (
                <button
                  key={o.id}
                  type="button"
                  className="w-full text-left px-2 py-2 hover:bg-muted/30 rounded"
                  onClick={() => openCopy(o.id)}
                  title="Open this copy"
                >
                  <div className="text-xs font-medium text-foreground/80 mb-1">
                    {period || (o.createdAt ? new Date(o.createdAt).toLocaleString() : "Undated")}
                  </div>
                  {lines.length === 0 ? (
                    <div className="text-xs italic text-muted-foreground/60">Empty</div>
                  ) : lines.map(line => (
                    <div key={line.occurrenceId} style={{ paddingLeft: Math.max(0, line.depth - 1) * 10 }} className="text-xs">
                      {line.text && <div className="text-foreground/80">{line.text}</div>}
                      {line.values.map(v => (
                        <div key={v.fieldId} className="text-muted-foreground">
                          {v.name && <span className="text-muted-foreground/60">{v.name}: </span>}
                          <span className="text-foreground/80">{v.text}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
