// ui/TransactionHistory.jsx
// ============================================================
// Transaction History Dialog
// Shows list of all transactions for the grid with filtering
// Undone transactions shown with strikethrough and red line
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useContext } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Equal,
  Clock,
  User,
  Package,
  Layers,
  Filter,
  RefreshCw,
  Undo2,
  Redo2,
  Check,
  X,
} from "lucide-react";
import { GridActionsContext, useGridActions } from "../GridActionsContext";
import { getTransactions, undoTransaction, redoTransaction } from "../helpers/TransactionHelpers";
import { pushTxNotification } from "../state/notificationStore";
import { formatDistanceToNow } from "date-fns";

// Transaction operation type icons and colors
const OP_CONFIG = {
  add: { icon: ArrowDown, color: "text-green-400", label: "Added" },
  remove: { icon: ArrowUp, color: "text-red-400", label: "Removed" },
  move: { icon: ArrowRight, color: "text-blue-400", label: "Moved" },
  copy: { icon: Package, color: "text-purple-400", label: "Copied" },
  reorder: { icon: Layers, color: "text-amber-400", label: "Reordered" },
  measure: { icon: Equal, color: "text-cyan-400", label: "Field Change" },
};

// State badges
const STATE_CONFIG = {
  applied: { label: "Applied", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  undone: { label: "Undone", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  redone: { label: "Redone", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

// Undo/redo temporarily disabled (broken server-side) — see TransactionRow.
const UNDO_REDO_ENABLED = false;

/**
 * Single transaction row
 */
function TransactionRow({
  transaction,
  instancesById,
  containersById,
  panelsById,
  fieldsById,
  onUndo,
  onRedo,
}) {
  const [expanded, setExpanded] = useState(false);

  const isUndone = transaction.state === "undone";
  const isRedone = transaction.state === "redone";
  // Undo/redo are DISABLED for now (2026-07-03, per user — "the undo and redo
  // don't even work right now so let's hide that"). History stays viewable;
  // flip UNDO_REDO_ENABLED when the server-side undo path is fixed.
  const canUndo = UNDO_REDO_ENABLED && (transaction.state === "applied" || transaction.state === "redone");
  const canRedo = UNDO_REDO_ENABLED && transaction.state === "undone";

  const timestamp = transaction.timestamp
    ? formatDistanceToNow(new Date(transaction.timestamp), { addSuffix: true })
    : "Unknown time";

  const undoneTimestamp = transaction.undoneAt
    ? formatDistanceToNow(new Date(transaction.undoneAt), { addSuffix: true })
    : null;

  // Get primary operation for summary
  const primaryOp = transaction.operations?.[0];
  const opAction = primaryOp?.occurrenceList?.action || primaryOp?.type || "unknown";
  const opConfig = OP_CONFIG[opAction] || OP_CONFIG.measure;
  const OpIcon = opConfig.icon;
  const stateConfig = STATE_CONFIG[transaction.state] || STATE_CONFIG.applied;

  // Build human-readable description
  const getDescription = useCallback(() => {
    if (!primaryOp) return "Unknown operation";

    if (primaryOp.type === "occurrence_list" && primaryOp.occurrenceList) {
      const ol = primaryOp.occurrenceList;
      const instance = instancesById[ol.instanceId];
      const fromContainer = containersById[ol.from?.containerId];
      const toContainer = containersById[ol.to?.containerId];
      const fromPanel = panelsById[ol.from?.panelId];
      const toPanel = panelsById[ol.to?.panelId];

      const instanceName = instance?.label || "Item";

      switch (ol.action) {
        case "add":
          return `${instanceName} added to ${toContainer?.label || toPanel?.label || "container"}`;
        case "remove":
          return `${instanceName} removed from ${fromContainer?.label || fromPanel?.label || "container"}`;
        case "move":
          return `${instanceName} moved from ${fromContainer?.label || "?"} to ${toContainer?.label || "?"}`;
        case "copy":
          return `${instanceName} copied to ${toContainer?.label || "?"}`;
        default:
          return `${ol.action} operation on ${instanceName}`;
      }
    }

    if (primaryOp.type === "measure" && primaryOp.measure) {
      const m = primaryOp.measure;
      const field = fieldsById[m.fieldId];
      const instance = instancesById[m.instanceId];
      const fieldName = field?.name || "Field";
      const instanceName = instance?.label || "Item";

      if (m.previousValue !== undefined && m.previousValue !== m.value) {
        return `${fieldName} on ${instanceName}: ${m.previousValue} → ${m.value}`;
      }
      return `${fieldName} on ${instanceName} set to ${m.value}`;
    }

    if (primaryOp.type === "entity" && primaryOp.entity) {
      const e = primaryOp.entity;
      return `${e.action} ${e.entityType}`;
    }

    return "Unknown operation";
  }, [primaryOp, instancesById, containersById, panelsById, fieldsById]);

  const handleUndo = (e) => {
    e.stopPropagation();
    onUndo?.(transaction.id);
  };

  const handleRedo = (e) => {
    e.stopPropagation();
    onRedo?.(transaction.id);
  };

  return (
    <div
      className={`
        transaction-row border-b border-border/50 py-2 px-3
        hover:bg-muted/30 cursor-pointer transition-colors
        ${expanded ? "bg-muted/20" : ""}
        ${isUndone ? "opacity-60" : ""}
      `}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Summary row */}
      <div className="flex items-center gap-3">
        {/* State indicator line */}
        <div className={`w-0.5 h-8 rounded-full ${isUndone ? "bg-red-500" : isRedone ? "bg-blue-500" : "bg-emerald-500"}`} />

        <div className={`p-1.5 rounded ${opConfig.color} bg-current/10`}>
          <OpIcon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-sm truncate ${isUndone ? "line-through text-muted-foreground" : ""}`}>
            {getDescription()}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{timestamp}</span>
            {isUndone && undoneTimestamp && (
              <span className="text-red-400">(undone {undoneTimestamp})</span>
            )}
          </div>
        </div>

        {/* State badge */}
        <div className={`text-[9px] px-1.5 py-0.5 rounded border ${stateConfig.color}`}>
          {stateConfig.label}
        </div>

        {/* Undo/Redo buttons */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canUndo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-amber-500/20"
              onClick={handleUndo}
              title="Undo this transaction"
            >
              <Undo2 className="w-3 h-3 text-amber-400" />
            </Button>
          )}
          {canRedo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-blue-500/20"
              onClick={handleRedo}
              title="Redo this transaction"
            >
              <Redo2 className="w-3 h-3 text-blue-400" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 ml-8 pl-4 border-l-2 border-border/50 text-xs space-y-1 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground/60">ID:</span>
            <code className="text-[10px] bg-muted px-1 rounded">{transaction.id}</code>
          </div>
          {transaction.operations?.length > 1 && (
            <div>{transaction.operations.length} operations in this transaction</div>
          )}
          {primaryOp?.type === "occurrence_list" && primaryOp.occurrenceList?.from && (
            <div className="flex items-center gap-2">
              <span>From:</span>
              <span className="text-foreground">
                {containersById[primaryOp.occurrenceList.from.containerId]?.label ||
                  panelsById[primaryOp.occurrenceList.from.panelId]?.label ||
                  "Unknown"}
              </span>
            </div>
          )}
          {primaryOp?.type === "occurrence_list" && primaryOp.occurrenceList?.to && (
            <div className="flex items-center gap-2">
              <span>To:</span>
              <span className="text-foreground">
                {containersById[primaryOp.occurrenceList.to.containerId]?.label ||
                  panelsById[primaryOp.occurrenceList.to.panelId]?.label ||
                  "Unknown"}
              </span>
            </div>
          )}
          {primaryOp?.type === "measure" && primaryOp.measure && (
            <>
              <div>Previous: {primaryOp.measure.previousValue ?? "none"}</div>
              <div>New: {primaryOp.measure.value}</div>
              <div>Flow: {primaryOp.measure.flow || "in"}</div>
            </>
          )}
          {isUndone && (
            <div className="flex items-center gap-2 text-red-400">
              <X className="w-3 h-3" />
              <span>Undone by {transaction.undoneBy || "user"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * TransactionHistory - Main dialog component
 */
export default function TransactionHistory({
  open,
  onOpenChange,
  gridId,
  moduleId,   // optional — when set, filters to transactions affecting this module
}) {
  const { socket, instancesById, containersById, panelsById, fieldsById } = useGridActions();

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    type: "all", // all, move, measure
    state: "all", // all, applied, undone
    search: "",
  });

  // Fetch transactions when dialog opens
  useEffect(() => {
    if (!open || !gridId || !socket) return;

    setLoading(true);
    getTransactions({ socket, gridId, includeUndone: true });

    const handleTransactions = ({ transactions: txs }) => {
      setTransactions(txs || []);
      setLoading(false);
    };

    socket.on("transactions", handleTransactions);

    return () => {
      socket.off("transactions", handleTransactions);
    };
  }, [open, gridId, socket]);

  // Refresh transactions
  const handleRefresh = useCallback(() => {
    if (!gridId || !socket) return;
    setLoading(true);
    getTransactions({ socket, gridId, includeUndone: true });
  }, [gridId, socket]);

  // Handle undo from row
  const handleUndoTransaction = useCallback((transactionId) => {
    if (!socket) return;
    undoTransaction({ socket, transactionId, gridId });
    pushTxNotification({ kind: "pending", label: "Undoing transaction…" });
  }, [socket, gridId]);

  // Handle redo from row
  const handleRedoTransaction = useCallback((transactionId) => {
    if (!socket) return;
    redoTransaction({ socket, transactionId, gridId });
    pushTxNotification({ kind: "pending", label: "Redoing transaction…" });
  }, [socket, gridId]);

  // Listen for undo/redo results + new transactions to refresh.
  // Only subscribe while the dialog is open — otherwise every operation-fire
  // broadcast queues another get_transactions, which on first load piles dozens
  // of Transaction.find() calls onto Mongo and fails them all together when the
  // Atlas pool monitor heartbeats time out.
  useEffect(() => {
    if (!open || !socket) return;

    const handleResult = () => { handleRefresh(); };

    socket.on("undo_result", handleResult);
    socket.on("redo_result", handleResult);
    socket.on("transaction_created", handleResult);

    return () => {
      socket.off("undo_result", handleResult);
      socket.off("redo_result", handleResult);
      socket.off("transaction_created", handleResult);
    };
  }, [open, socket, handleRefresh]);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // Per-module filter: only show transactions that reference this moduleId
      if (moduleId) {
        const affected = tx.operations?.some(op =>
          op.measure?.panelId === moduleId ||
          op.measure?.containerId === moduleId ||
          op.occurrence_list?.from?.containerId === moduleId ||
          op.occurrence_list?.to?.containerId === moduleId ||
          op.entity?.moduleId === moduleId
        );
        if (!affected) return false;
      }
      // State filter
      if (filter.state !== "all" && tx.state !== filter.state) {
        return false;
      }

      // Type filter
      if (filter.type !== "all") {
        const hasType = tx.operations?.some(op => {
          if (filter.type === "move") {
            return op.type === "occurrence_list" && ["move", "copy", "add", "remove"].includes(op.occurrenceList?.action);
          }
          if (filter.type === "measure") {
            return op.type === "measure";
          }
          return true;
        });
        if (!hasType) return false;
      }

      // Search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const matchesId = tx.id?.toLowerCase().includes(searchLower);
        if (!matchesId) return false;
      }

      return true;
    });
  }, [transactions, filter]);

  // Stats
  const stats = useMemo(() => {
    const applied = transactions.filter(tx => tx.state === "applied" || tx.state === "redone").length;
    const undone = transactions.filter(tx => tx.state === "undone").length;
    return { applied, undone, total: transactions.length };
  }, [transactions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            {moduleId ? "Module History" : "Transaction History"}
            <span className="text-xs font-normal text-muted-foreground ml-2">
              {stats.applied} active, {stats.undone} undone
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={filter.type} onValueChange={(v) => setFilter(f => ({ ...f, type: v }))}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="move">Moves</SelectItem>
                <SelectItem value="measure">Fields</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filter.state} onValueChange={(v) => setFilter(f => ({ ...f, state: v }))}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
                <SelectItem value="undone">Undone</SelectItem>
                <SelectItem value="redone">Redone</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Input
            type="text"
            placeholder="Search..."
            value={filter.search}
            onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))}
            className="h-7 text-xs flex-1"
          />

          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Transaction list */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading && transactions.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading transactions...
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Clock className="w-8 h-8 mb-2 opacity-50" />
              <div>No transactions found</div>
              <div className="text-xs mt-1">
                {filter.type !== "all" || filter.state !== "all" || filter.search
                  ? "Try adjusting your filters"
                  : "Transactions will appear here as you make changes"}
              </div>
            </div>
          ) : (
            <div>
              {filteredTransactions.map(tx => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  instancesById={instancesById}
                  containersById={containersById}
                  panelsById={panelsById}
                  fieldsById={fieldsById}
                  onUndo={handleUndoTransaction}
                  onRedo={handleRedoTransaction}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t text-xs text-muted-foreground">
          <span>
            {filteredTransactions.length} of {transactions.length} transactions
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
