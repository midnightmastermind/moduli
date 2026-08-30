// OperationLogPanel — readable run history for an operation.
// Each row = one past run (newest first). Click a row to expand step-by-step.
// Each step is described in plain English; raw JSON is an expandable tree.
// Resolved variable values are shown next to the original expressions.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Play, ChevronRight, ChevronDown,
  Search, Plus, Pencil, Trash2,
  GitBranch, Repeat, Variable, Zap, AlertCircle, CheckCircle2,
  Eye, ArrowRight,
} from "lucide-react";
import { useGridActions } from "../../GridActionsContext";
import {
  runPipelineForLog,
  getOpRunHistory,
  subscribeToOpLog,
} from "../../helpers/operationExecutor";
import { labelForId } from "../../helpers/labelHelpers";

// ─── Formatters ─────────────────────────────────────────────────────────

function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
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

function resolveIdParts(id, maps) {
  if (!id) return [null, null];
  const r = labelForId(id, maps);
  if (r?.label) return [r.label, `…${r.shortId}`];
  return [null, `…${shortId(id)}`];
}

function NameRef({ id, maps }) {
  const [name, suffix] = resolveIdParts(id, maps);
  return (
    <span title={id || ""}>
      {name && <span style={{ color: "var(--text-primary)" }}>{name}</span>}
      {name ? " " : ""}
      <span style={{ color: "var(--text-faint)" }}>{suffix}</span>
    </span>
  );
}

// ─── Code-style inline value ───────────────────────────────────────────

const codeSt = {
  background: "var(--border-subtle)",
  color: "var(--text-primary)",
  padding: "0 4px",
  borderRadius: 2,
  fontFamily: "monospace",
  fontSize: "inherit",
  wordBreak: "break-word",
};

// Pretty-format a primitive for inline display.
// For arrays/objects, returns an expandable JsonNode so the whole tree is drillable.
function inlineLiteral(v, maps) {
  if (v == null) return <em style={{ color: "var(--text-faint)" }}>(empty)</em>;
  if (typeof v === "boolean") return <code style={codeSt}>{String(v)}</code>;
  if (typeof v === "number") return <code style={codeSt}>{String(v)}</code>;
  if (typeof v === "string") {
    if (maps && labelForId(v, maps)?.label) {
      return <NameRef id={v} maps={maps} />;
    }
    return <code style={codeSt}>"{v.length > 60 ? v.slice(0, 60) + "…" : v}"</code>;
  }
  // Arrays + objects render as expandable JsonNode trees inline.
  if (Array.isArray(v) || typeof v === "object") {
    return <JsonNode data={v} maps={maps} />;
  }
  return <code style={codeSt}>{String(v)}</code>;
}

// ─── JSON Tree (expandable nodes) ──────────────────────────────────────

function JsonNode({ data, name, depth = 0, maps, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const isArray = Array.isArray(data);
  const isObject = data !== null && typeof data === "object" && !isArray;
  const isContainer = isArray || isObject;
  const indent = depth * 10;

  if (!isContainer) {
    return (
      <div style={{ paddingLeft: indent, fontSize: 10, fontFamily: "monospace", lineHeight: 1.55 }}>
        {name !== undefined && (
          <span style={{ color: "var(--text-muted)" }}>{name}: </span>
        )}
        {inlineLiteral(data, maps)}
      </div>
    );
  }

  const keys = isArray ? data.map((_, i) => i) : Object.keys(data);
  const headerLabel = isArray ? `Array(${keys.length})` : `Object{${keys.length}}`;

  return (
    <div style={{ paddingLeft: indent, fontSize: 10, fontFamily: "monospace", lineHeight: 1.55 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "inherit", fontFamily: "inherit", fontSize: "inherit",
        }}
      >
        {keys.length > 0
          ? (open
              ? <ChevronDown style={{ width: 9, height: 9, color: "var(--text-faint)" }} />
              : <ChevronRight style={{ width: 9, height: 9, color: "var(--text-faint)" }} />)
          : <span style={{ width: 9 }} />}
        {name !== undefined && (
          <span style={{ color: "var(--text-muted)" }}>{name}:</span>
        )}
        <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>{headerLabel}</span>
      </button>
      {open && (
        <div>
          {keys.map(k => (
            <JsonNode key={k} name={k} data={data[k]} depth={depth + 1} maps={maps} />
          ))}
        </div>
      )}
    </div>
  );
}

// Wrap any data in a labeled expandable node.
function JsonTree({ data, label = "raw data", maps, defaultOpen = false }) {
  if (data === undefined || data === null) return null;
  return (
    <details
      style={{ marginTop: 4 }}
      open={defaultOpen}
    >
      <summary style={{
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace",
        listStyle: "none",
      }}>
        <span>▸</span> {label}
      </summary>
      <div style={{
        marginTop: 3, padding: "5px 8px", borderRadius: 3,
        background: "var(--surface-card, var(--input-bg))",
        border: "1px solid var(--border-subtle)",
        maxHeight: 280, overflow: "auto",
      }}>
        <JsonNode data={data} maps={maps} defaultOpen />
      </div>
    </details>
  );
}

// ─── Variables snapshot (one expandable block per step) ────────────────

function VarsSnapshot({ vars, maps, label = "variables here" }) {
  if (!vars || Object.keys(vars).length === 0) return null;
  return (
    <details style={{ marginTop: 4 }}>
      <summary style={{
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace", listStyle: "none",
      }}>
        <Eye style={{ width: 9, height: 9 }} /> {label} ({Object.keys(vars).length})
      </summary>
      <div style={{
        marginTop: 3, padding: "5px 8px", borderRadius: 3,
        background: "var(--surface-card, var(--input-bg))",
        border: "1px solid var(--border-subtle)",
        maxHeight: 240, overflow: "auto",
      }}>
        {Object.keys(vars).sort().map(k => (
          <JsonNode key={k} name={k} data={vars[k]} maps={maps} />
        ))}
      </div>
    </details>
  );
}

// ─── Action verb + icon ────────────────────────────────────────────────

const ACTION_VERBS = {
  FIND:        { verb: "Look up",    icon: Search },
  FIND_OCCURRENCE: { verb: "Look up", icon: Search },
  FIND_MODULE: { verb: "Look up module", icon: Search },
  CREATE:      { verb: "Create",     icon: Plus },
  CREATE_OCCURRENCE_FOR_MODULE: { verb: "Create from", icon: Plus },
  UPDATE:      { verb: "Change",     icon: Pencil },
  DELETE:      { verb: "Remove",     icon: Trash2 },
  INIT_VAR:    { verb: "Set",        icon: Variable },
  SET_VAR:     { verb: "Set",        icon: Variable },
  ADD_TO_VAR:  { verb: "Add to",     icon: Variable },
  SUBTRACT_FROM_VAR: { verb: "Subtract from", icon: Variable },
  MULTIPLY_VAR:{ verb: "Multiply",   icon: Variable },
  DIV_VAR:     { verb: "Divide",     icon: Variable },
  INCREMENT_VAR: { verb: "Add 1 to", icon: Variable },
  DECREMENT_VAR: { verb: "Subtract 1 from", icon: Variable },
  PUSH_TO_VAR: { verb: "Push to",    icon: Variable },
  SHOW_VALUE:  { verb: "Show value", icon: Zap },
  SET_FIELD_VALUE: { verb: "Set field", icon: Pencil },
  AGGREGATE:   { verb: "Aggregate",  icon: Repeat },
  LINK_OCCURRENCE_TO_PARENT: { verb: "Link to parent", icon: Plus },
};

function actionVerb(actionType) {
  return ACTION_VERBS[actionType]?.verb || actionType;
}
function actionIcon(actionType) {
  return ACTION_VERBS[actionType]?.icon || Zap;
}

// Vertical row: a label cell + value cell stacked nicely.
const paramRowSt = {
  display: "grid",
  gridTemplateColumns: "minmax(70px, max-content) 1fr",
  gap: "2px 8px",
  alignItems: "baseline",
  fontSize: 10,
  lineHeight: 1.5,
};

function ParamRow({ label, children }) {
  return (
    <>
      <div style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 9 }}>
        {label}
      </div>
      <div style={{ minWidth: 0, wordBreak: "break-word" }}>
        {children}
      </div>
    </>
  );
}

// Render a resolved-vs-raw rule as one stacked block.
function RuleRow({ rule, maps }) {
  const { left, comparator, right, _leftValue, _rightValue } = rule;
  const showLeftResolved = left !== _leftValue && _leftValue !== undefined;
  const showRightResolved = right !== _rightValue && _rightValue !== undefined && _rightValue !== "";
  return (
    <div style={{
      padding: "3px 0",
      display: "flex", flexDirection: "column", gap: 2,
      borderLeft: "2px solid var(--border-subtle)", paddingLeft: 6,
    }}>
      <div style={{ fontSize: 10 }}>
        <code style={codeSt}>{left}</code>{" "}
        <span style={{ color: "var(--text-muted)" }}>{comparator}</span>{" "}
        <code style={codeSt}>{String(right ?? "")}</code>
      </div>
      {(showLeftResolved || showRightResolved) && (
        <div style={{ fontSize: 9, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 4 }}>
          <ArrowRight style={{ width: 8, height: 8, flexShrink: 0 }} />
          <span style={{ color: "var(--text-muted)" }}>resolves to:</span>
          {showLeftResolved ? inlineLiteral(_leftValue, maps) : <code style={codeSt}>{String(_leftValue ?? "")}</code>}
          <span style={{ color: "var(--text-muted)" }}>{comparator}</span>
          {showRightResolved ? inlineLiteral(_rightValue, maps) : <code style={codeSt}>{String(_rightValue ?? "")}</code>}
        </div>
      )}
    </div>
  );
}

// Per-record breakdown for FIND. `data` is { rules, candidates, totalIterated }.
// FIND iterates many records — even with no match, the user wants to see what
// each record's left-paths actually held when compared against the right side.
// Collapsed by default; clicking expands the list. Each candidate row is
// itself expandable to show every rule's leftValue/rightValue/✓✗.
function FindCandidates({ data, matched, maps }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const { candidates = [], totalIterated = 0 } = data || {};
  if (!candidates.length) return null;
  const headerLabel = matched
    ? `show all ${totalIterated} comparisons`
    : `not found · show all ${totalIterated} comparisons`;
  const moreCount = totalIterated > candidates.length ? totalIterated - candidates.length : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 10, color: matched ? "var(--text-muted)" : "var(--text-faint)",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "1px 2px", textAlign: "left",
        }}
      >
        {open
          ? <ChevronDown style={{ width: 10, height: 10, flexShrink: 0 }} />
          : <ChevronRight style={{ width: 10, height: 10, flexShrink: 0 }} />}
        <span>{headerLabel}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12 }}>
          {candidates.map((c, i) => {
            const isExpanded = expandedId === c.id;
            const matchPct = c.total > 0 ? c.score / c.total : 0;
            const badgeColor = c.score === c.total
              ? "var(--accent-green-text)"
              : matchPct >= 0.5 ? "var(--accent-amber-text, #c79b3c)" : "var(--text-faint)";
            return (
              <div key={c.id || i} style={{ borderLeft: c.isMatched ? "2px solid var(--accent-green-text)" : "1px solid var(--border-subtle)", paddingLeft: 6 }}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 10, color: "var(--text-primary)",
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "1px 2px", textAlign: "left", width: "100%",
                  }}
                >
                  {isExpanded
                    ? <ChevronDown style={{ width: 9, height: 9, flexShrink: 0 }} />
                    : <ChevronRight style={{ width: 9, height: 9, flexShrink: 0 }} />}
                  <NameRef id={c.id} maps={maps} />
                  {Array.isArray(c.ancestorLabels) && c.ancestorLabels.length > 0 && (
                    <span style={{ fontSize: 9, color: "var(--text-faint)", fontStyle: "italic" }}>
                      {c.ancestorLabels.join(" › ")}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 9, color: badgeColor, fontFamily: "monospace" }}>
                    {c.score}/{c.total}{c.isMatched ? " ✓" : ""}
                  </span>
                </button>
                {isExpanded && (
                  <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                    {c.ruleEvals.map((re, ri) => (
                      <div key={ri} style={{ fontSize: 10, lineHeight: 1.5 }}>
                        <span style={{ color: re.matched ? "var(--accent-green-text)" : "var(--text-faint)", marginRight: 4 }}>
                          {re.matched ? "✓" : "✗"}
                        </span>
                        <code style={codeSt}>{String(re.left)}</code>
                        {": "}
                        {inlineLiteral(re.leftValue, maps)}
                        <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>{re.comparator}</span>
                        {inlineLiteral(re.rightValue, maps)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {moreCount > 0 && (
            <div style={{ fontSize: 9, color: "var(--text-faint)", paddingLeft: 6 }}>
              …and {moreCount} more not shown (capped to keep log small)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupRows({ group, maps }) {
  if (!group?.rules || group.rules.length === 0) {
    return <div style={{ fontSize: 10, color: "var(--text-faint)" }}>(no conditions — matches anything)</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {group.rules.map((r, i) => (
        <React.Fragment key={r.id || i}>
          {i > 0 && (
            <div style={{ fontSize: 9, color: "var(--text-muted)", paddingLeft: 8 }}>
              {group.operator || "AND"}
            </div>
          )}
          {r.rules
            ? <div style={{ paddingLeft: 8 }}><GroupRows group={r} maps={maps} /></div>
            : <RuleRow rule={r} maps={maps} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Action body — vertical, stacked params ────────────────────────────

function ActionBody({ actionType, cfg = {}, resolvedConfig, resolvedPredicate, result = [], boundVars, candidates, maps }) {
  const rows = [];

  // Variable assignments
  if (actionType === "INIT_VAR" || actionType === "SET_VAR") {
    rows.push(<ParamRow key="name" label="name">{<code style={codeSt}>{cfg.name}</code>}</ParamRow>);
    if (cfg.arrayOf !== undefined) {
      rows.push(<ParamRow key="arr" label="array of">
        <code style={codeSt}>{`[${cfg.arrayOf?.length ?? 0} items]`}</code>
        <JsonTree data={cfg.arrayOf} label="array contents" maps={maps} />
      </ParamRow>);
    } else if (cfg.expr !== undefined) {
      rows.push(<ParamRow key="expr" label="value">
        <code style={codeSt}>{String(cfg.expr ?? "")}</code>
        {resolvedConfig?.expr !== undefined && cfg.expr !== resolvedConfig.expr && (
          <div style={{ fontSize: 9, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 4 }}>
            <ArrowRight style={{ width: 8, height: 8 }} /> {inlineLiteral(resolvedConfig.expr, maps)}
          </div>
        )}
      </ParamRow>);
    } else if (cfg.value !== undefined) {
      rows.push(<ParamRow key="val" label="value">{inlineLiteral(cfg.value, maps)}</ParamRow>);
    }
  } else if (actionType === "ADD_TO_VAR" || actionType === "SUBTRACT_FROM_VAR" || actionType === "MULTIPLY_VAR" || actionType === "PUSH_TO_VAR") {
    rows.push(<ParamRow key="n" label="name">{<code style={codeSt}>{cfg.name}</code>}</ParamRow>);
    rows.push(<ParamRow key="e" label="by">
      <code style={codeSt}>{String(cfg.expr ?? cfg.value ?? "")}</code>
      {resolvedConfig?.expr !== undefined && cfg.expr !== resolvedConfig.expr && (
        <div style={{ fontSize: 9, color: "var(--text-faint)" }}>→ {inlineLiteral(resolvedConfig.expr, maps)}</div>
      )}
    </ParamRow>);
  } else if (actionType === "INCREMENT_VAR" || actionType === "DECREMENT_VAR") {
    rows.push(<ParamRow key="n" label="name">{<code style={codeSt}>{cfg.name}</code>}</ParamRow>);
    rows.push(<ParamRow key="b" label="by">{<code style={codeSt}>{String(cfg.by ?? 1)}</code>}</ParamRow>);
  } else if (actionType === "DIV_VAR") {
    rows.push(<ParamRow key="n" label="name">{<code style={codeSt}>{cfg.name}</code>}</ParamRow>);
    rows.push(<ParamRow key="b" label="divide by">{<code style={codeSt}>{String(cfg.by ?? 1)}</code>}</ParamRow>);
  }

  // FIND family
  else if (actionType === "FIND" || actionType === "FIND_OCCURRENCE" || actionType === "FIND_MODULE") {
    const predicate = resolvedPredicate || cfg.predicate;
    rows.push(<ParamRow key="where" label="where">
      <GroupRows group={predicate} maps={maps} />
    </ParamRow>);
    if (cfg.itemIdVar) rows.push(<ParamRow key="iidv" label="result id →">{<code style={codeSt}>{cfg.itemIdVar}</code>}</ParamRow>);
    if (cfg.itemVar)   rows.push(<ParamRow key="iv" label="result item →">{<code style={codeSt}>{cfg.itemVar}</code>}</ParamRow>);
    // FIND doesn't push to `result`; the executor logs the bound vars on the
    // entry (see executeSteps boundVars capture). Prefer those over `result`.
    let foundId = null;
    let foundCount = 0;
    const itemBound = cfg.itemVar ? boundVars?.[cfg.itemVar] : undefined;
    const idBound = cfg.itemIdVar ? boundVars?.[cfg.itemIdVar] : undefined;
    if (Array.isArray(itemBound)) {
      foundCount = itemBound.length;
      foundId = itemBound[0]?.id ?? null;
    } else if (itemBound && typeof itemBound === "object" && itemBound.id) {
      foundCount = 1;
      foundId = itemBound.id;
    } else if (Array.isArray(idBound)) {
      foundCount = idBound.length;
      foundId = idBound[0] ?? null;
    } else if (typeof idBound === "string" && idBound) {
      foundCount = 1;
      foundId = idBound;
    } else if (result?.[0]?.id) {
      foundCount = result.length;
      foundId = result[0].id;
    }
    if (foundCount > 1) {
      rows.push(<ParamRow key="r" label="found">
        <span style={{ color: "var(--accent-green-text)" }}>
          ✓ {foundCount} matches{foundId ? <> · <NameRef id={foundId} maps={maps} /> + {foundCount - 1} more</> : null}
        </span>
      </ParamRow>);
    } else if (foundId) {
      rows.push(<ParamRow key="r" label="found">
        <span style={{ color: "var(--accent-green-text)" }}>✓ <NameRef id={foundId} maps={maps} /></span>
      </ParamRow>);
    } else if (cfg.itemIdVar || cfg.itemVar) {
      rows.push(<ParamRow key="r" label="found"><span style={{ color: "var(--text-faint)" }}>(no match)</span></ParamRow>);
    }
    if (candidates && Array.isArray(candidates.candidates) && candidates.candidates.length > 0) {
      rows.push(<ParamRow key="cand" label="comparisons">
        <FindCandidates data={candidates} matched={!!foundId} maps={maps} />
      </ParamRow>);
    }
  }

  // CREATE
  else if (actionType === "CREATE") {
    rows.push(<ParamRow key="name" label="name">
      <code style={codeSt}>{String(cfg.name ?? "")}</code>
      {resolvedConfig?.name !== undefined && cfg.name !== resolvedConfig.name && (
        <div style={{ fontSize: 9, color: "var(--text-faint)" }}>→ {inlineLiteral(resolvedConfig.name, maps)}</div>
      )}
    </ParamRow>);
    rows.push(<ParamRow key="role" label="role">{<code style={codeSt}>{cfg.role || "container"}</code>}</ParamRow>);
    rows.push(<ParamRow key="kind" label="kind">{<code style={codeSt}>{cfg.kind || "board"}</code>}</ParamRow>);
    if (cfg.parent) {
      rows.push(<ParamRow key="parent" label="parent">
        <code style={codeSt}>{cfg.parent}</code>
        {resolvedConfig?.parent !== undefined && cfg.parent !== resolvedConfig.parent && (
          <div style={{ fontSize: 9, color: "var(--text-faint)" }}>→ {inlineLiteral(resolvedConfig.parent, maps)}</div>
        )}
      </ParamRow>);
    }
    if (cfg.fields && Object.keys(cfg.fields).length > 0) {
      rows.push(<ParamRow key="fields" label="fields">
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {Object.entries(cfg.fields).map(([fid, expr]) => (
            <div key={fid} style={{ fontSize: 10 }}>
              <NameRef id={fid} maps={maps} /> = <code style={codeSt}>{String(expr)}</code>
              {resolvedConfig?.fields?.[fid] !== undefined && resolvedConfig.fields[fid] !== expr && (
                <span style={{ color: "var(--text-faint)" }}> → {inlineLiteral(resolvedConfig.fields[fid], maps)}</span>
              )}
            </div>
          ))}
        </div>
      </ParamRow>);
    }
    if (cfg.date?.fieldId) {
      rows.push(<ParamRow key="date" label="date">
        <span style={{ fontSize: 10 }}>
          <NameRef id={cfg.date.fieldId} maps={maps} /> = <code style={codeSt}>{String(cfg.date.value)}</code>
        </span>
      </ParamRow>);
    }
  }

  // UPDATE
  else if (actionType === "UPDATE") {
    rows.push(<ParamRow key="path" label="path">{<code style={codeSt}>{cfg.path}</code>}</ParamRow>);
    rows.push(<ParamRow key="value" label="value">{inlineLiteral(cfg.value, maps)}</ParamRow>);
  }

  // DELETE
  else if (actionType === "DELETE") {
    rows.push(<ParamRow key="id" label="item id">{<code style={codeSt}>{cfg.itemIdExpr}</code>}</ParamRow>);
  }

  // SHOW_VALUE / SET_FIELD_VALUE
  else if (actionType === "SHOW_VALUE" || actionType === "SET_FIELD_VALUE") {
    if (cfg.targetFieldId) rows.push(<ParamRow key="f" label="field"><NameRef id={cfg.targetFieldId} maps={maps} /></ParamRow>);
    if (cfg.fieldId)       rows.push(<ParamRow key="ff" label="field"><NameRef id={cfg.fieldId} maps={maps} /></ParamRow>);
    rows.push(<ParamRow key="v" label="value">
      <code style={codeSt}>{cfg.sourceExpr ?? cfg.valueExpr ?? cfg.value}</code>
    </ParamRow>);
  }

  // Generic fallback — show all known cfg keys vertically
  else {
    Object.keys(cfg).filter(k => k !== "type").slice(0, 8).forEach(k => {
      rows.push(<ParamRow key={k} label={k}>{inlineLiteral(cfg[k], maps)}</ParamRow>);
    });
  }

  // Outcomes (the actual changes this action produced)
  if (result.length > 0) {
    rows.push(
      <ParamRow key="out" label={result.length === 1 ? "produced" : `produced (${result.length})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {result.slice(0, 5).map((r, i) => <OutcomeLine key={i} effect={r} maps={maps} />)}
          {result.length > 5 && (
            <div style={{ fontSize: 9, color: "var(--text-faint)" }}>…and {result.length - 5} more</div>
          )}
        </div>
      </ParamRow>
    );
  }

  return <div style={paramRowSt}>{rows}</div>;
}

const OUTCOME_LABELS = {
  CREATE_ITEM: "Created item",
  UPDATE_ITEM_FIELD: "Updated field",
  UPDATE_ITEM_PARENT: "Moved item",
  UPDATE_ITEM_META: "Updated meta",
  UPDATE_ITEM_TEXTMAP: "Updated text",
  DELETE_ITEM: "Deleted item",
  REMOVE_OCCURRENCE: "Removed",
  LINK_OCCURRENCE_TO_PARENT: "Linked to parent",
  CREATE_OCCURRENCE_FOR_MODULE: "Created occurrence",
  CREATE_OCCURRENCE: "Created occurrence",
  CREATE_MODULE: "Created module",
  UPDATE_MODULE: "Updated module",
  UPDATE_VIEW: "Updated view",
  SHOW_VALUE: "Showed value",
};

function OutcomeLine({ effect, maps }) {
  const type = effect?._effect || "result";
  const label = OUTCOME_LABELS[type] || type;
  return (
    <div style={{ fontSize: 10, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "baseline" }}>
      <CheckCircle2 style={{ width: 9, height: 9, color: "var(--accent-green-text)", flexShrink: 0 }} />
      <span style={{ color: "var(--accent-green-text)", fontWeight: 600 }}>{label}</span>
      {effect?.fieldId && <NameRef id={effect.fieldId} maps={maps} />}
      {effect?.value !== undefined && <span style={{ color: "var(--text-primary)" }}>= {String(effect.value)}</span>}
      {effect?.occurrenceId && <span><span style={{ color: "var(--text-muted)" }}>on</span> <NameRef id={effect.occurrenceId} maps={maps} /></span>}
      {effect?.parentId && <span><span style={{ color: "var(--text-muted)" }}>under</span> <NameRef id={effect.parentId} maps={maps} /></span>}
      {effect?.instance?.parentId && <span><span style={{ color: "var(--text-muted)" }}>under</span> <NameRef id={effect.instance.parentId} maps={maps} /></span>}
    </div>
  );
}

// ─── Trigger-match readout ─────────────────────────────────────────────

const SUBJECT_LABELS = { field: "Field", filterNav: "Filter", grid: "Grid", module: "Module" };
function fmtMatchedTrigger(matched, maps) {
  if (!matched) return null;
  const subj = matched.subjectRole
    ? matched.subjectRole.charAt(0).toUpperCase() + matched.subjectRole.slice(1)
    : (SUBJECT_LABELS[matched.subjectType] || matched.subjectType || "?");
  const r = matched.targetId ? labelForId(matched.targetId, maps) : null;
  const target = !matched.targetId ? "Any" : (r?.label ?? `…${r?.shortId ?? shortId(matched.targetId)}`);
  return `${matched.eventType} · ${subj} · ${target}`;
}

// ─── One log entry (full vertical layout) ──────────────────────────────

function StepBadge({ label, icon: Icon, bg, color }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      background: bg, color, padding: "2px 6px", borderRadius: 3,
      fontSize: 9, fontWeight: 700, flexShrink: 0,
      whiteSpace: "nowrap",
    }}>
      {Icon && <Icon style={{ width: 9, height: 9 }} />}
      {label}
    </span>
  );
}

function StepRow({ children }) {
  return (
    <div style={{
      padding: "6px 0",
      borderBottom: "1px solid var(--border-subtle)",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      {children}
    </div>
  );
}

function StepHeader({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {children}
    </div>
  );
}

function LogEntry({ entry, maps }) {
  if (entry.kind === "start") {
    const matchedLabel = fmtMatchedTrigger(entry.matchedTriggerObject, maps);
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label="START" icon={Play} bg="var(--accent-blue-bg)" color="var(--accent-blue-text)" />
          <span style={{ fontSize: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>triggered by </span>
            <strong style={{ color: "var(--accent-blue-text)" }}>{entry.transactionType ?? "onLoad (page load)"}</strong>
          </span>
          {matchedLabel && (
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>matched: <em>{matchedLabel}</em></span>
          )}
        </StepHeader>
        {entry.trigger && (entry.trigger.occurrenceId || entry.trigger.fieldId || entry.trigger.date) && (
          <div style={paramRowSt}>
            {entry.trigger.date && <ParamRow label="date">{<code style={codeSt}>{entry.trigger.date}</code>}</ParamRow>}
            {entry.trigger.occurrenceId && <ParamRow label="occurrence"><NameRef id={entry.trigger.occurrenceId} maps={maps} /></ParamRow>}
            {entry.trigger.fieldId && <ParamRow label="field"><NameRef id={entry.trigger.fieldId} maps={maps} /></ParamRow>}
          </div>
        )}
        {entry.trigger && <JsonTree data={entry.trigger} label="trigger details" maps={maps} />}
      </StepRow>
    );
  }

  if (entry.kind === "sources") {
    const keys = Object.keys(entry.vars || {}).filter(k => !k.startsWith("_"));
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label="VARS" icon={Variable} bg="var(--input-bg)" color="var(--text-muted)" />
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {keys.length === 0 ? "(no source vars)" : `${keys.length} source variable${keys.length === 1 ? "" : "s"}`}
          </span>
        </StepHeader>
        {keys.length > 0 && (
          <div style={paramRowSt}>
            {keys.map(k => (
              <ParamRow key={k} label={k}>{inlineLiteral(entry.vars[k], maps)}</ParamRow>
            ))}
          </div>
        )}
        {keys.length > 0 && <JsonTree data={Object.fromEntries(keys.map(k => [k, entry.vars[k]]))} label="all source variables" maps={maps} />}
      </StepRow>
    );
  }

  if (entry.kind === "action") {
    const Icon = actionIcon(entry.actionType);
    const verb = actionVerb(entry.actionType);
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label={verb} icon={Icon} bg="var(--accent-purple-bg)" color="var(--accent-purple-text)" />
          <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "monospace" }}>{entry.actionType}</span>
          {entry.resultCount > 0 && (
            <span style={{ fontSize: 9, color: "var(--accent-green-text)" }}>
              · {entry.resultCount} change{entry.resultCount === 1 ? "" : "s"}
            </span>
          )}
        </StepHeader>
        <ActionBody
          actionType={entry.actionType}
          cfg={entry.config}
          resolvedConfig={entry.resolvedConfig}
          resolvedPredicate={entry.resolvedPredicate}
          result={entry.result || []}
          boundVars={entry.boundVars}
          candidates={entry.candidates}
          maps={maps}
        />
        <VarsSnapshot vars={entry.varsBefore} maps={maps} label="variables when this ran" />
        <JsonTree data={{ config: entry.config, result: entry.result }} label="step JSON" maps={maps} />
      </StepRow>
    );
  }

  if (entry.kind === "if") {
    const taken = entry.branch === "then";
    return (
      <StepRow>
        <StepHeader>
          <StepBadge
            label={taken ? "IF · YES" : "IF · NO"}
            icon={GitBranch}
            bg={taken ? "var(--accent-green-bg)" : "var(--input-bg)"}
            color={taken ? "var(--accent-green-text)" : "var(--text-muted)"}
          />
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            went into <strong style={{ color: "var(--text-primary)" }}>{entry.branch}</strong> branch
          </span>
        </StepHeader>
        {entry.resolvedCondition?.rules?.length > 0 && (
          <div style={paramRowSt}>
            <ParamRow label="condition">
              <GroupRows group={entry.resolvedCondition} maps={maps} />
            </ParamRow>
          </div>
        )}
        <VarsSnapshot vars={entry.varsBefore} maps={maps} label="variables when this ran" />
      </StepRow>
    );
  }

  if (entry.kind === "loop") {
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label="LOOP" icon={Repeat} bg="var(--input-bg)" color="var(--text-muted)" />
          <span style={{ fontSize: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>over </span>
            <code style={codeSt}>{entry.over || "(typed)"}</code>
            <span style={{ color: "var(--text-muted)" }}> as </span>
            <code style={codeSt}>{entry.as}</code>
          </span>
          <span style={{ fontSize: 10, color: "var(--text-primary)", fontWeight: 600 }}>
            {entry.itemCount} iteration{entry.itemCount === 1 ? "" : "s"}
          </span>
        </StepHeader>
      </StepRow>
    );
  }

  if (entry.kind === "loop_iter") {
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label={`#${entry.index + 1}/${entry.total}`} icon={Repeat} bg="var(--input-bg)" color="var(--text-muted)" />
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            <code style={codeSt}>{entry.as}</code> = {inlineLiteral(entry.item, maps)}
          </span>
        </StepHeader>
        {entry.item && typeof entry.item === "object" && (
          <JsonTree data={entry.item} label="iteration value" maps={maps} />
        )}
      </StepRow>
    );
  }

  if (entry.kind === "end") {
    const updates = entry.updates || [];
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label="DONE" icon={CheckCircle2} bg="var(--accent-green-bg)" color="var(--accent-green-text)" />
          <span style={{ fontSize: 10 }}>
            <strong style={{ color: "var(--text-primary)" }}>
              {updates.length} change{updates.length === 1 ? "" : "s"} produced
            </strong>
            <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>· {entry.durationMs}ms</span>
          </span>
        </StepHeader>
        {updates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {updates.slice(0, 6).map((r, i) => <OutcomeLine key={i} effect={r} maps={maps} />)}
            {updates.length > 6 && (
              <div style={{ fontSize: 9, color: "var(--text-faint)" }}>…and {updates.length - 6} more</div>
            )}
          </div>
        )}
        {updates.length > 0 && <JsonTree data={updates} label="all changes" maps={maps} />}
      </StepRow>
    );
  }

  if (entry.kind === "error") {
    return (
      <StepRow>
        <StepHeader>
          <StepBadge label="ERROR" icon={AlertCircle} bg="var(--danger-bg)" color="var(--danger-text)" />
          <span style={{ fontSize: 10, color: "var(--danger-text)" }}>{entry.message}</span>
        </StepHeader>
        {entry.stack && <JsonTree data={{ stack: entry.stack }} label="stack trace" maps={maps} />}
      </StepRow>
    );
  }

  return (
    <StepRow>
      <StepHeader>
        <StepBadge label={String(entry.kind || "?")} bg="var(--input-bg)" color="var(--text-faint)" />
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{JSON.stringify(entry).slice(0, 80)}</span>
      </StepHeader>
    </StepRow>
  );
}

// ─── One run row ───────────────────────────────────────────────────────

function RunRow({ run, expanded, onToggle, isLatest, maps }) {
  const startEntry = run.entries.find(e => e.kind === "start");
  const endEntry = run.entries.find(e => e.kind === "end");
  const errorEntry = run.entries.find(e => e.kind === "error");
  const matchedLabel = fmtMatchedTrigger(startEntry?.matchedTriggerObject, maps);
  const triggerLabel = matchedLabel || startEntry?.transactionType || "onLoad";
  const updates = endEntry?.updates?.length ?? 0;

  const status = errorEntry
    ? { label: "FAILED", bg: "var(--danger-bg)", color: "var(--danger-text)" }
    : updates === 0
      ? { label: "no-op", bg: "var(--input-bg)", color: "var(--text-muted)" }
      : { label: `${updates} change${updates === 1 ? "" : "s"}`, bg: "var(--accent-green-bg)", color: "var(--accent-green-text)" };

  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px",
          background: isLatest ? "var(--accent-blue-bg)" : "transparent",
          border: "none",
          borderLeft: isLatest ? "2px solid var(--accent-blue-border)" : "2px solid transparent",
          color: "var(--text-primary)", cursor: "pointer", fontSize: 11, textAlign: "left",
        }}
      >
        {expanded ? <ChevronDown style={{ width: 11, height: 11, flexShrink: 0 }} /> : <ChevronRight style={{ width: 11, height: 11, flexShrink: 0 }} />}
        <span style={{
          background: status.bg, color: status.color,
          padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700,
          flexShrink: 0, minWidth: 56, textAlign: "center",
        }}>
          {status.label}
        </span>
        <span style={{ color: "var(--text-muted)", flexShrink: 0, fontSize: 10, fontFamily: "monospace" }}>
          {fmtTime(run.runAt)}
        </span>
        <span style={{ color: "var(--text-faint)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }}>
          {triggerLabel} · {fmtRelative(run.runAt)}
        </span>
        <span style={{ color: "var(--text-faint)", fontSize: 10, flexShrink: 0, fontFamily: "monospace" }}>
          {run.durationMs}ms
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "4px 10px 10px 22px", background: "var(--surface-card, var(--input-bg))" }}>
          {run.entries.map((e, i) => <LogEntry key={i} entry={e} maps={maps} />)}
        </div>
      )}
    </div>
  );
}

// ─── Top-level panel ───────────────────────────────────────────────────

const labelStyle = { fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" };

export default function OperationLogPanel({ operation }) {
  const { state, fieldsById, occurrencesById, modulesById, operationsById } = useGridActions();
  const opId = operation?.id;
  const [history, setHistory] = useState(() => (opId ? getOpRunHistory(opId) : []));
  const [expandedIdx, setExpandedIdx] = useState(0);
  const maps = useMemo(
    () => ({ fieldsById: fieldsById || {}, modulesById: modulesById || {}, occurrencesById: occurrencesById || {} }),
    [fieldsById, modulesById, occurrencesById],
  );

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
    try { runPipelineForLog(operation, context, trigger); } catch { /* recorded in the run log */ }
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 5, borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ ...labelStyle, fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>Run history</span>
        <span style={{ ...labelStyle, fontStyle: "italic" }}>{summary}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleLiveRun}
          title="Run pipeline now and append to history"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 9px", borderRadius: 4, fontSize: 11, fontFamily: "monospace",
            background: "var(--accent-green-bg)", border: "1px solid var(--accent-green-border)",
            color: "var(--accent-green-text)", cursor: "pointer",
          }}
        >
          <Play style={{ width: 10, height: 10 }} /> Run now
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {history.length === 0 ? (
          <div style={{ padding: 14, textAlign: "center", color: "var(--text-faint)", fontSize: 11, fontStyle: "italic" }}>
            No runs yet. Click <strong>Run now</strong> for a live preview, or trigger the operation by interacting with the app.
          </div>
        ) : (
          history.map((run, i) => (
            <RunRow
              key={`${run.runAt}-${i}`}
              run={run}
              expanded={expandedIdx === i}
              isLatest={i === 0}
              maps={maps}
              onToggle={() => setExpandedIdx(prev => prev === i ? -1 : i)}
            />
          ))
        )}
      </div>
    </div>
  );
}
