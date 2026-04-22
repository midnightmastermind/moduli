// OperationLogPanel — renders the run history for an operation.
// Each row = one past run (newest first). Click a row to expand its entries.
// Click an entry to expand its raw JSON detail.

import React, { useState, useEffect, useContext, useCallback, useMemo } from "react";
import { Play, ChevronRight, ChevronDown } from "lucide-react";
import { GridActionsContext } from "../../GridActionsContext";
import {
  executePipeline,
  getOpRunHistory,
  subscribeToOpLog,
} from "../../helpers/operationExecutor";

const labelStyle = {
  fontSize: 10,
  color: "var(--text-muted)",
  fontFamily: "monospace",
};

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function fmtRelative(ms) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function shortId(id) {
  return id ? String(id).slice(-6) : "?";
}

function previewScalar(v) {
  if (v == null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 40) + "…" : v;
  return null;
}

// Compact human-readable summary — never raw JSON
function summarize(v) {
  const s = previewScalar(v);
  if (s !== null) return s;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "{}";
    const pairs = keys.slice(0, 2).map(k => {
      const vs = previewScalar(v[k]);
      return `${k}:${vs !== null ? vs : typeof v[k] === "object" ? "{…}" : "?"}`;
    });
    return keys.length > 2 ? `{${pairs.join(", ")}, …}` : `{${pairs.join(", ")}}`;
  }
  return "?";
}

// Render one operation effect as a readable row
function EffectRow({ r }) {
  const type = r?._effect || r?.type || "EFFECT";
  const fid = r?.fieldId ? `…${shortId(r.fieldId)}` : null;
  const occ = r?.occurrenceId ? `occ:…${shortId(r.occurrenceId)}` : null;
  const val = r?.value !== undefined ? summarize(r.value) : null;

  return (
    <div style={{ display: "flex", gap: 5, alignItems: "baseline", fontSize: 9, fontFamily: "monospace", color: "var(--text-faint)", marginTop: 1 }}>
      <span style={{ color: "var(--accent-purple-text)", fontWeight: 600 }}>{type}</span>
      {fid && <span>{fid}</span>}
      {val !== null && <span style={{ color: "var(--text-primary)" }}>= {val}</span>}
      {occ && <span style={{ color: "var(--text-faint)" }}>{occ}</span>}
    </div>
  );
}

// Collapsible raw JSON expander
function RawDetail({ data }) {
  const [open, setOpen] = useState(false);
  const json = useMemo(() => {
    try { return JSON.stringify(data, null, 2); } catch { return "[unserializable]"; }
  }, [data]);

  return (
    <div style={{ marginTop: 3 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
      >
        {open ? <ChevronDown style={{ width: 8, height: 8, color: "var(--text-faint)" }} /> : <ChevronRight style={{ width: 8, height: 8, color: "var(--text-faint)" }} />}
        <span style={{ fontSize: 8, fontFamily: "monospace", color: "var(--text-faint)" }}>raw</span>
      </button>
      {open && (
        <pre style={{
          margin: "2px 0 0 12px", padding: "4px 6px", borderRadius: 3,
          background: "var(--border-subtle)", color: "var(--text-muted)",
          fontSize: 8, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
          maxHeight: 200, overflowY: "auto",
        }}>
          {json}
        </pre>
      )}
    </div>
  );
}

function LogEntry({ entry }) {
  const palette = {
    start: { bg: "var(--accent-blue-bg)", color: "var(--accent-blue-text)", label: "START" },
    sources: { bg: "var(--input-bg)", color: "var(--text-muted)", label: "SRC" },
    action: { bg: "var(--accent-purple-bg)", color: "var(--accent-purple-text)", label: "ACT" },
    if: { bg: "var(--input-bg)", color: "var(--text-muted)", label: "IF" },
    loop: { bg: "var(--input-bg)", color: "var(--text-muted)", label: "LOOP" },
    end: { bg: "var(--accent-green-bg)", color: "var(--accent-green-text)", label: "END" },
    error: { bg: "var(--danger-bg)", color: "var(--danger-text)", label: "ERR" },
  }[entry.kind] || { bg: "var(--input-bg)", color: "var(--text-faint)", label: entry.kind };

  let body = null;
  let rawTarget = null;

  if (entry.kind === "start") {
    body = (
      <span>
        <span style={{ color: "var(--text-muted)" }}>trigger:</span> {entry.transactionType ?? "onLoad"}
        {entry.trigger?.occurrenceId ? <> · <span style={{ color: "var(--text-muted)" }}>occ:</span> …{shortId(entry.trigger.occurrenceId)}</> : null}
        {entry.trigger?.fieldId ? <> · <span style={{ color: "var(--text-muted)" }}>field:</span> …{shortId(entry.trigger.fieldId)}</> : null}
      </span>
    );
    rawTarget = entry.trigger;
  } else if (entry.kind === "sources") {
    const keys = Object.keys(entry.vars || {}).filter(k => k !== "_log");
    body = keys.length === 0
      ? <span style={{ color: "var(--text-faint)" }}>(no vars)</span>
      : (
        <span>
          {keys.map(k => (
            <span key={k} style={{ marginRight: 8 }}>
              <span style={{ color: "var(--text-muted)" }}>{k}=</span>
              <span style={{ color: "var(--text-primary)" }}>{summarize(entry.vars[k])}</span>
            </span>
          ))}
        </span>
      );
    rawTarget = keys.length > 0 ? Object.fromEntries(keys.map(k => [k, entry.vars[k]])) : null;
  } else if (entry.kind === "action") {
    const results = entry.result || [];
    body = (
      <span>
        <span style={{ color: "var(--accent-purple-text)", fontWeight: 600 }}>{entry.actionType}</span>
        <span style={{ color: "var(--text-faint)", marginLeft: 5 }}>→ {entry.resultCount} effect{entry.resultCount === 1 ? "" : "s"}</span>
        {results.length > 0 && (
          <div style={{ marginTop: 2, paddingLeft: 8 }}>
            {results.slice(0, 4).map((r, i) => <EffectRow key={i} r={r} />)}
            {results.length > 4 && <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>… +{results.length - 4} more</div>}
          </div>
        )}
      </span>
    );
    rawTarget = results.length > 0 ? results : null;
  } else if (entry.kind === "if") {
    body = (
      <span style={{ color: entry.branch === "then" ? "var(--accent-green-text)" : "var(--text-faint)" }}>
        → {entry.branch}
      </span>
    );
  } else if (entry.kind === "loop") {
    body = (
      <span>
        <span style={{ color: "var(--text-muted)" }}>over:</span> {entry.over || "(typed)"} ·{" "}
        <span style={{ color: "var(--text-muted)" }}>as:</span> {entry.as} ·{" "}
        <span style={{ color: "var(--text-primary)" }}>{entry.itemCount} item{entry.itemCount === 1 ? "" : "s"}</span>
      </span>
    );
  } else if (entry.kind === "end") {
    const updates = entry.updates || [];
    body = (
      <span>
        <span style={{ color: "var(--text-primary)" }}>{updates.length} update{updates.length === 1 ? "" : "s"}</span>
        <span style={{ color: "var(--text-faint)", marginLeft: 5 }}>· {entry.durationMs}ms</span>
        {updates.length > 0 && (
          <div style={{ marginTop: 2, paddingLeft: 8 }}>
            {updates.slice(0, 3).map((r, i) => <EffectRow key={i} r={r} />)}
            {updates.length > 3 && <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>… +{updates.length - 3} more</div>}
          </div>
        )}
      </span>
    );
    rawTarget = updates.length > 0 ? updates : null;
  } else if (entry.kind === "error") {
    body = <span style={{ color: "var(--danger-text)" }}>{entry.message}</span>;
    rawTarget = entry.stack ? { stack: entry.stack } : null;
  } else {
    body = <span style={{ color: "var(--text-faint)" }}>{summarize(entry)}</span>;
  }

  return (
    <div style={{ padding: "3px 0", borderBottom: "1px solid var(--border-subtle)", fontFamily: "monospace", fontSize: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <span style={{ background: palette.bg, color: palette.color, padding: "1px 5px", borderRadius: 3, fontSize: 8, fontWeight: 600, minWidth: 40, textAlign: "center", flexShrink: 0, marginTop: 1 }}>
          {palette.label}
        </span>
        <div style={{ flex: 1, minWidth: 0, color: "var(--text-primary)", wordBreak: "break-word" }}>{body}</div>
      </div>
      {rawTarget && <RawDetail data={rawTarget} />}
    </div>
  );
}

function RunRow({ run, expanded, onToggle, isLatest }) {
  const startEntry = run.entries.find(e => e.kind === "start");
  const endEntry = run.entries.find(e => e.kind === "end");
  const errorEntry = run.entries.find(e => e.kind === "error");
  const trigger = startEntry?.transactionType ?? "onLoad";
  const updates = endEntry?.updates?.length ?? 0;

  const statusColor = errorEntry ? "var(--danger-text)" : "var(--accent-green-text)";
  const statusBg    = errorEntry ? "var(--danger-bg)"   : "var(--accent-green-bg)";
  const statusLabel = errorEntry ? "ERR" : `${updates}`;

  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "5px 6px", background: isLatest ? "var(--accent-blue-bg)" : "transparent",
          border: "none", borderLeft: isLatest ? "2px solid var(--accent-blue-border)" : "2px solid transparent",
          color: "var(--text-primary)", cursor: "pointer", fontFamily: "monospace", fontSize: 10, textAlign: "left",
        }}
      >
        {expanded ? <ChevronDown style={{ width: 9, height: 9, flexShrink: 0 }} /> : <ChevronRight style={{ width: 9, height: 9, flexShrink: 0 }} />}
        <span style={{ background: statusBg, color: statusColor, padding: "1px 5px", borderRadius: 3, fontSize: 8, fontWeight: 600, minWidth: 28, textAlign: "center", flexShrink: 0 }}>
          {statusLabel}
        </span>
        <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{fmtTime(run.runAt)}</span>
        <span style={{ color: "var(--text-faint)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trigger} · {fmtRelative(run.runAt)}
        </span>
        <span style={{ color: "var(--text-faint)", fontSize: 9, flexShrink: 0 }}>{run.durationMs}ms</span>
      </button>
      {expanded && (
        <div style={{ padding: "4px 8px 6px 22px", background: "var(--surface-card)" }}>
          {run.entries.map((e, i) => <LogEntry key={i} entry={e} />)}
        </div>
      )}
    </div>
  );
}

export default function OperationLogPanel({ operation }) {
  const { state, fieldsById, occurrencesById, operationsById } = useContext(GridActionsContext);
  const opId = operation?.id;
  const [history, setHistory] = useState(() => (opId ? getOpRunHistory(opId) : []));
  const [expandedIdx, setExpandedIdx] = useState(0);

  useEffect(() => {
    if (!opId) return;
    setHistory(getOpRunHistory(opId));
    setExpandedIdx(0);
    return subscribeToOpLog(opId, (next) => setHistory([...next]));
  }, [opId]);

  const handleLiveRun = useCallback(() => {
    if (!operation?.pipeline) return;
    const context = {
      state,
      fieldsById: fieldsById || {},
      occurrencesById: occurrencesById || {},
      operationsById: operationsById || {},
    };
    const trigger = { type: "manual", source: "editor-live-run", timestamp: Date.now() };
    try { executePipeline(operation, context, trigger); } catch { /* logged in run */ }
    setExpandedIdx(0);
  }, [operation, state, fieldsById, occurrencesById, operationsById]);

  const summary = useMemo(() => {
    if (history.length === 0) return "no runs yet";
    const latest = history[0];
    return `${history.length} run${history.length === 1 ? "" : "s"} · last ${fmtRelative(latest.runAt)}`;
  }, [history]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      padding: "8px 10px", borderRadius: 5,
      background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
      minHeight: 200, maxHeight: "calc(100vh - 180px)", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 4, borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ ...labelStyle, fontWeight: 600, color: "var(--text-primary)" }}>Run History</span>
        <span style={{ ...labelStyle, fontStyle: "italic" }}>{summary}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleLiveRun}
          title="Run pipeline now and append to history"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 4, fontSize: 10, fontFamily: "monospace",
            background: "var(--accent-green-bg)", border: "1px solid var(--accent-green-border)",
            color: "var(--accent-green-text)", cursor: "pointer",
          }}
        >
          <Play style={{ width: 9, height: 9 }} /> Run
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {history.length === 0 ? (
          <div style={{ padding: 14, textAlign: "center", color: "var(--text-faint)", fontSize: 10, fontFamily: "monospace", fontStyle: "italic" }}>
            No runs yet. Click <strong>Run</strong> for a live preview, or wait for a trigger to fire.
          </div>
        ) : (
          history.map((run, i) => (
            <RunRow
              key={`${run.runAt}-${i}`}
              run={run}
              expanded={expandedIdx === i}
              isLatest={i === 0}
              onToggle={() => setExpandedIdx(prev => prev === i ? -1 : i)}
            />
          ))
        )}
      </div>
    </div>
  );
}
